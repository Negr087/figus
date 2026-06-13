"use client";

import { useEffect, useState, useCallback } from "react";
import { requestOrderInvoice, tryPayInvoice } from "@/lib/order";
import { list } from "@/lib/pool";
import type { Identity } from "@/lib/identity";
import { InvoiceModal } from "./InvoiceModal";

interface NostrProfile { name: string; picture: string; }

// ── Types (mirror issuer/tournament.ts) ───────────────────────────────────────

type TournamentStatus = "registering" | "group_stage" | "finished" | "none";

interface Registration { pubkey: string; registeredAt: number; strength: number; }
interface KickResult { player: 1 | 2; goal: boolean; }
interface Match {
  id: string; phase: "group" | "semi" | "final"; group?: "A" | "B";
  player1: string; player2: string;
  kicks: KickResult[]; score1: number; score2: number; winner: string;
}
interface Standing { pubkey: string; pts: number; w: number; d: number; l: number; gf: number; ga: number; gd: number; }
interface TournamentData {
  id: string; status: TournamentStatus; maxPlayers: number; entrySats: number;
  prizePool: number; registrations: Registration[];
  groups: { A: string[]; B: string[] } | null;
  matches: Match[];
  standings: { A: Standing[]; B: Standing[] } | null;
  semi1: Match | null; semi2: Match | null; final: Match | null;
  champion: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const short = (pk: string) => pk.slice(0, 8) + "…";

function Avatar({ pubkey, profiles, size = 24 }: { pubkey: string; profiles: Map<string, NostrProfile>; size?: number }) {
  const p = profiles.get(pubkey);
  const name = p?.name || short(pubkey);
  return p?.picture ? (
    <img src={p.picture} alt={name} width={size} height={size}
      style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "1.5px solid var(--line)" }}
      onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
    />
  ) : (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: "var(--panel2)", border: "1.5px solid var(--line)",
      display: "grid", placeItems: "center",
      fontSize: size * 0.45, color: "var(--muted)", fontWeight: 900, fontFamily: "var(--condensed)",
    }}>
      {name[0]?.toUpperCase() || "?"}
    </div>
  );
}

function PlayerName({ pubkey, profiles }: { pubkey: string; profiles: Map<string, NostrProfile> }) {
  const p = profiles.get(pubkey);
  return <>{p?.name || short(pubkey)}</>;
}

function KickStrip({ kicks, player }: { kicks: KickResult[]; player: 1 | 2 }) {
  const regular = kicks.filter(k => k.player === player).slice(0, 5);
  return (
    <span style={{ letterSpacing: 2, fontSize: 14 }}>
      {regular.map((k, i) => (
        <span key={i} title={k.goal ? "Gol" : "Atajado"}>{k.goal ? "⚽" : "❌"}</span>
      ))}
    </span>
  );
}

function MatchCard({ match, profiles, expanded, onToggle }: { match: Match; profiles: Map<string, NostrProfile>; expanded: boolean; onToggle: () => void }) {
  const hasGolden = match.kicks.length > 10;
  return (
    <div style={{ background: "rgba(255,255,255,.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,.08)", overflow: "hidden" }}>
      <button onClick={onToggle} style={{ width: "100%", background: "none", border: "none", padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: "var(--ink)", fontFamily: "var(--condensed)" }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
          <Avatar pubkey={match.player1} profiles={profiles} size={20} />
          <span style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 80 }}>
            <PlayerName pubkey={match.player1} profiles={profiles} />
          </span>
        </div>
        <span style={{ fontWeight: 900, fontSize: 15, color: "var(--gold)", minWidth: 40, textAlign: "center" }}>
          {match.score1} – {match.score2}
        </span>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
          <span style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 80 }}>
            <PlayerName pubkey={match.player2} profiles={profiles} />
          </span>
          <Avatar pubkey={match.player2} profiles={profiles} size={20} />
        </div>
        <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: 6 }}>{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div style={{ padding: "8px 14px 12px", borderTop: "1px solid rgba(255,255,255,.06)" }}>
          {([1, 2] as const).map(p => {
            const pk = p === 1 ? match.player1 : match.player2;
            const score = p === 1 ? match.score1 : match.score2;
            const won = match.winner === pk;
            return (
              <div key={p} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <Avatar pubkey={pk} profiles={profiles} size={18} />
                <span style={{ fontSize: 10, color: "var(--muted)", width: 64, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <PlayerName pubkey={pk} profiles={profiles} />
                </span>
                <KickStrip kicks={match.kicks} player={p} />
                <span style={{ fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 13, color: won ? "var(--gold)" : "var(--muted)", marginLeft: "auto" }}>
                  {score}
                </span>
              </div>
            );
          })}
          {hasGolden && (
            <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--condensed)", marginTop: 4, fontStyle: "italic" }}>
              Golden kick → ganó <PlayerName pubkey={match.winner} profiles={profiles} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StandingsTable({ standings, group, profiles }: { standings: Standing[]; group: string; profiles: Map<string, NostrProfile> }) {
  const medals = ["🥇", "🥈", "  ", "  "];
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 12, letterSpacing: 1, color: "var(--gold)", marginBottom: 8 }}>
        GRUPO {group}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto auto", gap: "5px 12px", fontSize: 11, fontFamily: "var(--condensed)", alignItems: "center" }}>
        <span style={{ color: "var(--muted)", fontWeight: 700 }}>Jugador</span>
        <span style={{ color: "var(--muted)", fontWeight: 700, textAlign: "right" }}>GF</span>
        <span style={{ color: "var(--muted)", fontWeight: 700, textAlign: "right" }}>GC</span>
        <span style={{ color: "var(--muted)", fontWeight: 700, textAlign: "right" }}>GD</span>
        <span style={{ color: "var(--muted)", fontWeight: 700, textAlign: "right" }}>Pts</span>
        {standings.map((s, i) => (
          <>
            <div key={s.pubkey + "n"} style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
              <span style={{ fontSize: 13 }}>{medals[i]}</span>
              <Avatar pubkey={s.pubkey} profiles={profiles} size={22} />
              <span style={{ color: i < 2 ? "var(--ink)" : "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <PlayerName pubkey={s.pubkey} profiles={profiles} />
              </span>
            </div>
            <span key={s.pubkey + "gf"} style={{ textAlign: "right", color: "var(--muted)" }}>{s.gf}</span>
            <span key={s.pubkey + "ga"} style={{ textAlign: "right", color: "var(--muted)" }}>{s.ga}</span>
            <span key={s.pubkey + "gd"} style={{ textAlign: "right", color: s.gd >= 0 ? "#4ade80" : "#f87171" }}>{s.gd > 0 ? "+" : ""}{s.gd}</span>
            <span key={s.pubkey + "pts"} style={{ textAlign: "right", fontWeight: 900, color: i < 2 ? "var(--gold)" : "var(--muted)" }}>{s.pts}</span>
          </>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function Tournament({ identity, notify = () => {} }: { identity: Identity | null; notify?: (msg: string) => void }) {
  const [data,           setData]           = useState<TournamentData | null>(null);
  const [profiles,       setProfiles]       = useState<Map<string, NostrProfile>>(new Map());
  const [loading,        setLoading]        = useState(true);
  const [busy,           setBusy]           = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [expandedId,     setExpandedId]     = useState<string | null>(null);
  const [tab,            setTab]            = useState<"groups" | "bracket" | "matches">("groups");
  const [pendingInvoice, setPendingInvoice] = useState<string | null>(null);
  const [pendingAmount,  setPendingAmount]  = useState<number>(0);

  const fetchProfiles = useCallback(async (pubkeys: string[]) => {
    if (!pubkeys.length) return;
    try {
      const evs = await list([{ kinds: [0], authors: pubkeys }]);
      const map = new Map<string, NostrProfile>();
      for (const ev of evs as { pubkey: string; content: string }[]) {
        try {
          const m = JSON.parse(ev.content);
          map.set(ev.pubkey, { name: m.display_name || m.name || "", picture: m.picture || "" });
        } catch {}
      }
      setProfiles(map);
    } catch {}
  }, []);

  const fetchTournament = useCallback(async () => {
    try {
      const r = await fetch("/api/tournament");
      if (r.ok) {
        const t: TournamentData = await r.json();
        // "none" means no tournament exists yet — treat as a fresh registering state
        if (t.status === "none") {
          setData({ ...t, status: "registering", maxPlayers: 8, entrySats: 5, prizePool: 0, registrations: [], groups: null, matches: [], standings: null, semi1: null, semi2: null, final: null, champion: null });
        } else {
          setData(t);
        }
        setError(null);
        const pubkeys = (t.registrations ?? []).map(r => r.pubkey);
        if (pubkeys.length) fetchProfiles(pubkeys);
      } else setError("No se pudo cargar el torneo");
    } catch { setError("No se pudo cargar el torneo"); }
    finally { setLoading(false); }
  }, [fetchProfiles]);

  useEffect(() => {
    fetchTournament();
    const iv = setInterval(fetchTournament, 15_000);
    return () => clearInterval(iv);
  }, [fetchTournament]);

  async function pollForRegistration() {
    if (!identity) return;
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const r = await fetch("/api/tournament");
      if (r.ok) {
        const t: TournamentData = await r.json();
        setData(t);
        if (t.registrations.some(reg => reg.pubkey === identity.pubkey)) break;
      }
    }
  }

  async function handleRegister() {
    if (!identity || busy) return;
    setBusy(true);
    try {
      // Fetch fresh data to catch already-registered state before hitting issuer
      const check = await fetch("/api/tournament");
      if (check.ok) {
        const fresh: TournamentData = await check.json();
        setData(fresh);
        if (fresh.registrations.some(r => r.pubkey === identity.pubkey)) return;
        if (fresh.status !== "registering") { setError("El torneo ya comenzó"); return; }
        if (fresh.registrations.length >= fresh.maxPlayers) { setError("El torneo está lleno"); return; }
      }

      const { invoice, amountSats } = await requestOrderInvoice({
        action: "tournament-register" as any,
        signerMode: identity.mode,
      });
      const paid = await tryPayInvoice(invoice);
      if (!paid) {
        // No auto-payment available — show QR modal so player can pay manually
        setPendingInvoice(invoice);
        setPendingAmount(amountSats || data?.entrySats || 5);
        return;
      }
      await pollForRegistration();
    } catch (e: any) {
      setError(e?.message ?? "Error al inscribirse");
      fetchTournament(); // refresh so UI reflects current registration state
    } finally {
      setBusy(false);
    }
  }

  if (loading) return (
    <div style={{ textAlign: "center", padding: 24, color: "var(--muted)", fontSize: 12, fontFamily: "var(--condensed)" }}>
      Cargando torneo…
    </div>
  );

  if (error || !data) return (
    <div style={{ textAlign: "center", padding: 24, color: "var(--muted)", fontSize: 12, fontFamily: "var(--condensed)" }}>
      {error ?? "Torneo no disponible"}
    </div>
  );

  const myPubkey = identity?.pubkey ?? "";
  const registered = data.registrations.some(r => r.pubkey === myPubkey);
  const filled = data.registrations.length;
  const pct = (filled / data.maxPlayers) * 100;

  const headerGrad = "linear-gradient(135deg, rgba(232,185,35,.08) 0%, rgba(245,158,11,.04) 100%)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Header ───────────────────────────────────────────────── */}
      <div style={{
        background: headerGrad,
        border: "1px solid rgba(232,185,35,.25)",
        borderRadius: 14,
        padding: "18px 18px 16px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 32, lineHeight: 1 }}>🏆</div>
          <div>
            <div style={{ fontFamily: "var(--display)", fontSize: 17, color: "var(--gold)", letterSpacing: 0.5 }}>
              TORNEO DE PENALES
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
              {data.status === "registering"
                ? `Inscripción abierta · ${data.entrySats} sats · ${filled}/${data.maxPlayers} jugadores`
                : data.champion
                ? `Campeón: ${short(data.champion)}`
                : "En curso"}
            </div>
          </div>
        </div>

        {/* Progress bar (registering only) */}
        {data.status === "registering" && (
          <>
            <div style={{ height: 6, background: "rgba(255,255,255,.08)", borderRadius: 99, overflow: "hidden", marginBottom: 14 }}>
              <div style={{ height: "100%", width: `${pct}%`, background: "var(--gold)", borderRadius: 99, transition: "width .4s ease" }} />
            </div>
            {/* Register button */}
            {identity ? (
              registered ? (
                <div style={{ fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 12, color: "#4ade80", letterSpacing: 0.5 }}>
                  ✓ INSCRIPTO — esperando más jugadores…
                </div>
              ) : (
                <button
                  onClick={handleRegister}
                  disabled={busy}
                  style={{
                    background: busy ? "rgba(232,185,35,.1)" : "linear-gradient(135deg,var(--gold),#d4920a)",
                    color: busy ? "var(--muted)" : "#030b18",
                    border: busy ? "1px solid rgba(232,185,35,.3)" : "none",
                    padding: "10px 20px", borderRadius: 8,
                    fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 13, letterSpacing: 0.5,
                    cursor: busy ? "default" : "pointer",
                  }}
                >
                  {busy ? "Procesando…" : `⚡ INSCRIBIRSE · ${data.entrySats} sats`}
                </button>
              )
            ) : (
              <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--condensed)" }}>
                Conectate para inscribirte
              </div>
            )}
          </>
        )}

        {/* Champion banner */}
        {data.champion && (
          <div style={{
            background: "rgba(232,185,35,.15)", border: "1px solid rgba(232,185,35,.4)",
            borderRadius: 10, padding: "10px 14px", marginTop: 4,
            display: "flex", alignItems: "center", gap: 10,
            fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 13, color: "var(--gold)", letterSpacing: 0.5,
          }}>
            <Avatar pubkey={data.champion} profiles={profiles} size={28} />
            🥇 CAMPEÓN: <PlayerName pubkey={data.champion} profiles={profiles} />
            {data.champion === myPubkey && " · ¡Sos vos! 🎉"}
          </div>
        )}
      </div>

      {/* ── Registered players list ───────────────────────────────── */}
      {data.status === "registering" && data.registrations.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {data.registrations.map(r => {
            const isMe = r.pubkey === myPubkey;
            return (
              <div key={r.pubkey} style={{
                background: isMe ? "rgba(74,222,128,.15)" : "rgba(255,255,255,.04)",
                border: `1px solid ${isMe ? "rgba(74,222,128,.4)" : "rgba(255,255,255,.1)"}`,
                borderRadius: 99, padding: "4px 10px 4px 6px",
                fontSize: 11, fontFamily: "var(--condensed)", fontWeight: 700,
                color: isMe ? "#4ade80" : "var(--muted)",
                display: "flex", alignItems: "center", gap: 6,
              }}>
                <Avatar pubkey={r.pubkey} profiles={profiles} size={20} />
                <PlayerName pubkey={r.pubkey} profiles={profiles} />
              </div>
            );
          })}
        </div>
      )}

      {/* ── Results (finished) ────────────────────────────────────── */}
      {data.status === "finished" && data.standings && (
        <>
          {/* Tab strip */}
          <div style={{ display: "flex", gap: 4 }}>
            {(["groups", "bracket", "matches"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                background: tab === t ? "var(--gold)" : "transparent",
                color: tab === t ? "#030b18" : "var(--muted)",
                border: tab === t ? "none" : "1px solid var(--line)",
                padding: "5px 12px", borderRadius: 6,
                fontSize: 10, fontWeight: 900, fontFamily: "var(--condensed)", letterSpacing: 0.5,
                cursor: "pointer",
              }}>
                {t === "groups" ? "GRUPOS" : t === "bracket" ? "LLAVES" : "PARTIDOS"}
              </button>
            ))}
          </div>

          {/* Groups tab */}
          {tab === "groups" && (
            <div>
              <StandingsTable standings={data.standings.A} group="A" profiles={profiles} />
              <StandingsTable standings={data.standings.B} group="B" profiles={profiles} />
            </div>
          )}

          {/* Bracket tab */}
          {tab === "bracket" && data.semi1 && data.semi2 && data.final && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <div style={{ fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 11, letterSpacing: 1, color: "var(--muted)", marginBottom: 8 }}>
                  SEMIFINALES
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <MatchCard match={data.semi1} profiles={profiles} expanded={expandedId === "semi1"} onToggle={() => setExpandedId(v => v === "semi1" ? null : "semi1")} />
                  <MatchCard match={data.semi2} profiles={profiles} expanded={expandedId === "semi2"} onToggle={() => setExpandedId(v => v === "semi2" ? null : "semi2")} />
                </div>
              </div>
              <div>
                <div style={{ fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 11, letterSpacing: 1, color: "var(--gold)", marginBottom: 8 }}>
                  FINAL
                </div>
                <MatchCard match={data.final} profiles={profiles} expanded={expandedId === "final"} onToggle={() => setExpandedId(v => v === "final" ? null : "final")} />
              </div>
            </div>
          )}

          {/* Matches tab */}
          {tab === "matches" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {["A", "B"].map(g => (
                <div key={g}>
                  <div style={{ fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 11, letterSpacing: 1, color: "var(--muted)", marginBottom: 6 }}>
                    GRUPO {g}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {data.matches.filter(m => m.group === g).map(m => (
                      <MatchCard key={m.id} match={m} profiles={profiles} expanded={expandedId === m.id} onToggle={() => setExpandedId(v => v === m.id ? null : m.id)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {error && (
        <div style={{ fontSize: 11, color: "#f87171", fontFamily: "var(--condensed)", textAlign: "center" }}>
          {error}
        </div>
      )}

      {pendingInvoice && (
        <InvoiceModal
          invoice={pendingInvoice}
          amountSats={pendingAmount}
          onClose={() => setPendingInvoice(null)}
          onNwcPaid={() => {
            setPendingInvoice(null);
            setBusy(false);
            pollForRegistration();
          }}
          notify={notify}
        />
      )}
    </div>
  );
}
