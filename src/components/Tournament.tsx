"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { requestOrderInvoice, tryPayInvoice } from "@/lib/order";
import { list } from "@/lib/pool";
import type { Identity } from "@/lib/identity";
import { ISSUER_PUBKEY } from "@/lib/constants";
import { InvoiceModal } from "./InvoiceModal";
import { TournamentMatchPanel } from "./TournamentMatchPanel";
import type { InteractiveKick, LiveTournamentMatch } from "./TournamentMatchPanel";

interface NostrProfile { name: string; picture: string; }

// ── Types (mirror issuer/tournament.ts) ───────────────────────────────────────

type TournamentStatus = "registering" | "group_stage" | "semi" | "final" | "finished" | "none";

interface Registration { pubkey: string; registeredAt: number; strength: number; }

interface TournamentMatch {
  id: string;
  phase: "group" | "semi" | "final";
  group?: "A" | "B";
  player1: string;
  player2: string;
  status: "pending" | "active" | "complete" | "timeout";
  matchCoord: string;
  kicks: InteractiveKick[];
  score1: number;
  score2: number;
  winner: string | null;
  completedAt: number | null;
  currentRound: number;
  actionPhase: "waiting_commit" | "waiting_block" | "waiting_reveal" | null;
  currentKicker: string | null;
  currentGoalkeeper: string | null;
  lastActionAt: number | null;
  pendingCommitEventId: string | null;
}

interface Standing {
  pubkey: string; pts: number; w: number; d: number; l: number;
  gf: number; ga: number; gd: number;
}

interface TournamentData {
  id: string;
  status: TournamentStatus;
  maxPlayers: number;
  entrySats: number;
  prizePool: number;
  registrations: Registration[];
  groups: { A: string[]; B: string[] } | null;
  matches: TournamentMatch[];
  standings: { A: Standing[]; B: Standing[] } | null;
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

function KickStrip({ kicks, playerPubkey }: { kicks: InteractiveKick[]; playerPubkey: string }) {
  const playerKicks = kicks.filter(k => k.kicker === playerPubkey);
  return (
    <span style={{ letterSpacing: 2, fontSize: 13 }}>
      {playerKicks.map((k, i) => (
        <span key={i} title={k.timedOut ? "Timeout" : k.goal ? "Gol" : "Atajado"}>
          {k.timedOut ? "⏱" : k.goal ? "⚽" : "❌"}
        </span>
      ))}
    </span>
  );
}

function MatchCard({
  match, profiles, expanded, onToggle,
}: {
  match: TournamentMatch;
  profiles: Map<string, NostrProfile>;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isComplete = match.status === "complete" || match.status === "timeout";
  const isSuddenDeath = match.kicks.length > 6;
  return (
    <div style={{ background: "rgba(255,255,255,.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,.08)", overflow: "hidden" }}>
      <button onClick={onToggle} style={{ width: "100%", background: "none", border: "none", padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: "var(--ink)", fontFamily: "var(--condensed)" }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
          <Avatar pubkey={match.player1} profiles={profiles} size={20} />
          <span style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 80 }}>
            <PlayerName pubkey={match.player1} profiles={profiles} />
          </span>
        </div>
        <span style={{ fontWeight: 900, fontSize: 15, color: isComplete ? "var(--gold)" : "var(--muted)", minWidth: 40, textAlign: "center" }}>
          {isComplete ? `${match.score1} – ${match.score2}` : "vs"}
        </span>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
          <span style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 80 }}>
            <PlayerName pubkey={match.player2} profiles={profiles} />
          </span>
          <Avatar pubkey={match.player2} profiles={profiles} size={20} />
        </div>
        <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: 6 }}>{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && isComplete && (
        <div style={{ padding: "8px 14px 12px", borderTop: "1px solid rgba(255,255,255,.06)" }}>
          {([match.player1, match.player2] as const).map((pk) => {
            const score = pk === match.player1 ? match.score1 : match.score2;
            const won = match.winner === pk;
            return (
              <div key={pk} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <Avatar pubkey={pk} profiles={profiles} size={18} />
                <span style={{ fontSize: 10, color: "var(--muted)", width: 64, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <PlayerName pubkey={pk} profiles={profiles} />
                </span>
                <KickStrip kicks={match.kicks} playerPubkey={pk} />
                <span style={{ fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 13, color: won ? "var(--gold)" : "var(--muted)", marginLeft: "auto" }}>
                  {score}
                </span>
              </div>
            );
          })}
          {isSuddenDeath && (
            <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--condensed)", marginTop: 4, fontStyle: "italic" }}>
              Muerte súbita → ganó <PlayerName pubkey={match.winner!} profiles={profiles} />
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
  const [resetting,      setResetting]      = useState(false);

  const isIssuer = !!identity && identity.pubkey === ISSUER_PUBKEY;
  const [expandedId,     setExpandedId]     = useState<string | null>(null);
  const [tab,            setTab]            = useState<"groups" | "bracket" | "matches">("groups");
  const [pendingInvoice, setPendingInvoice] = useState<string | null>(null);
  const [pendingAmount,  setPendingAmount]  = useState<number>(0);

  // Keep a ref to the latest data for use in callbacks without re-creating intervals
  const dataRef = useRef<TournamentData | null>(null);
  dataRef.current = data;

  const myPubkey = identity?.pubkey ?? "";

  const fetchProfiles = useCallback(async (pubkeys: string[]) => {
    if (!pubkeys.length) return;
    try {
      const evs = await list([{ kinds: [0], authors: pubkeys }]);
      const fetched = new Map<string, NostrProfile>();
      for (const ev of evs as { pubkey: string; content: string }[]) {
        try {
          const m = JSON.parse(ev.content);
          fetched.set(ev.pubkey, { name: m.display_name || m.name || "", picture: m.picture || "" });
        } catch {}
      }
      setProfiles(prev => new Map([...prev, ...fetched]));
    } catch {}
  }, []);

  const fetchTournament = useCallback(async () => {
    try {
      const r = await fetch("/api/tournament");
      if (r.ok) {
        const t: TournamentData = await r.json();
        if (t.status === "none") {
          setData({ ...t, status: "registering", maxPlayers: 8, entrySats: 5, prizePool: 0, registrations: [], groups: null, matches: [], standings: null, champion: null });
        } else {
          setData(t);
        }
        setError(null);

        // Collect all pubkeys from registrations + match players for profile fetching
        const pkSet = new Set<string>();
        (t.registrations ?? []).forEach(r => pkSet.add(r.pubkey));
        (t.matches ?? []).forEach(m => { pkSet.add(m.player1); pkSet.add(m.player2); });
        if (t.champion) pkSet.add(t.champion);
        if (pkSet.size) fetchProfiles([...pkSet]);
      } else {
        setError("No se pudo cargar el torneo");
      }
    } catch {
      setError("No se pudo cargar el torneo");
    } finally {
      setLoading(false);
    }
  }, [fetchProfiles]);

  // Poll faster during active tournament phases (5s vs 15s)
  useEffect(() => {
    fetchTournament();
    const isLive = data?.status === "group_stage" || data?.status === "semi" || data?.status === "final";
    const iv = setInterval(fetchTournament, isLive ? 5000 : 15000);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchTournament, data?.status]);

  async function pollForRegistration() {
    if (!identity) return;
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const r = await fetch("/api/tournament");
      if (r.ok) {
        const t: TournamentData = await r.json();
        setData(t);
        if (t.status === "registering" && t.registrations.some(reg => reg.pubkey === identity.pubkey)) break;
      }
    }
  }

  async function handleReset() {
    if (!isIssuer || resetting) return;
    if (!window.confirm("¿Finalizar y cancelar el torneo actual? Esta acción no se puede deshacer.")) return;
    setResetting(true);
    setError(null);
    try {
      const r = await fetch("/api/tournament", { method: "DELETE" });
      if (!r.ok) {
        const d = await r.json() as { error?: string };
        setError(d.error ?? "No se pudo cancelar el torneo");
      } else {
        await fetchTournament();
      }
    } catch {
      setError("No se pudo conectar con el servidor");
    } finally {
      setResetting(false);
    }
  }

  async function handleRegister() {
    if (!identity || busy) return;
    setBusy(true);
    try {
      // Pre-check: skip guard when tournament is finished (new one starts on issuer)
      const check = await fetch("/api/tournament");
      if (check.ok) {
        const fresh: TournamentData = await check.json();
        setData(fresh);
        if (fresh.status !== "finished" && fresh.status !== "none") {
          if (fresh.registrations.some(r => r.pubkey === identity.pubkey)) return;
          const activePhases: TournamentStatus[] = ["group_stage", "semi", "final"];
          if (activePhases.includes(fresh.status)) { setError("El torneo está en curso"); return; }
          if (fresh.registrations.length >= fresh.maxPlayers) { setError("El torneo está lleno"); return; }
        }
      }

      const { invoice, amountSats } = await requestOrderInvoice({
        action: "tournament-register" as any,
        signerMode: identity.mode,
      });
      const paid = await tryPayInvoice(invoice);
      if (!paid) {
        setPendingInvoice(invoice);
        setPendingAmount(amountSats || data?.entrySats || 5);
        return;
      }
      await pollForRegistration();
    } catch (e: any) {
      setError(e?.message ?? "Error al inscribirse");
      fetchTournament();
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

  const registered = data.registrations.some(r => r.pubkey === myPubkey);
  const filled = data.registrations.length;
  const pct = (filled / data.maxPlayers) * 100;

  const isLivePhase = data.status === "group_stage" || data.status === "semi" || data.status === "final";
  const headerGrad = "linear-gradient(135deg, rgba(232,185,35,.08) 0%, rgba(245,158,11,.04) 100%)";

  // Derived match lists
  const myMatches = data.matches.filter(m => m.player1 === myPubkey || m.player2 === myPubkey);
  const myActiveMatches = myMatches.filter(m => m.status !== "complete" && m.status !== "timeout");

  // Determine current phase label
  const phaseLabel = data.status === "group_stage" ? "Fase de Grupos"
    : data.status === "semi" ? "Semifinales"
    : data.status === "final" ? "Gran Final"
    : "";

  // For results bracket
  const semi1 = data.matches.find(m => m.id === "semi1") ?? null;
  const semi2 = data.matches.find(m => m.id === "semi2") ?? null;
  const finalMatch = data.matches.find(m => m.id === "final") ?? null;

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
                : isLivePhase
                ? `${phaseLabel} · Premio: ${data.prizePool} sats`
                : data.champion
                ? `Campeón: ${profiles.get(data.champion)?.name || short(data.champion)}`
                : "Torneo finalizado"}
            </div>
          </div>
        </div>

        {/* Progress bar + register button (registering only) */}
        {data.status === "registering" && (
          <>
            <div style={{ height: 6, background: "rgba(255,255,255,.08)", borderRadius: 99, overflow: "hidden", marginBottom: 14 }}>
              <div style={{ height: "100%", width: `${pct}%`, background: "var(--gold)", borderRadius: 99, transition: "width .4s ease" }} />
            </div>
            {identity ? (
              registered ? (
                <div style={{ fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 12, color: "#4ade80", letterSpacing: 0.5 }}>
                  ✓ INSCRIPTO — esperando más jugadores…
                </div>
              ) : (
                <button onClick={handleRegister} disabled={busy} style={{
                  background: busy ? "rgba(232,185,35,.1)" : "linear-gradient(135deg,var(--gold),#d4920a)",
                  color: busy ? "var(--muted)" : "#030b18",
                  border: busy ? "1px solid rgba(232,185,35,.3)" : "none",
                  padding: "10px 20px", borderRadius: 8,
                  fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 13, letterSpacing: 0.5,
                  cursor: busy ? "default" : "pointer",
                }}>
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

        {/* New tournament button (after finished) */}
        {data.status === "finished" && identity && (
          <button onClick={handleRegister} disabled={busy} style={{
            marginTop: 12,
            background: busy ? "rgba(255,255,255,.05)" : "rgba(232,185,35,.15)",
            color: busy ? "var(--muted)" : "var(--gold)",
            border: "1px solid rgba(232,185,35,.35)",
            padding: "9px 18px", borderRadius: 8,
            fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 12, letterSpacing: 0.5,
            cursor: busy ? "default" : "pointer",
          }}>
            {busy ? "Procesando…" : "⚽ INSCRIBIRSE A NUEVO TORNEO"}
          </button>
        )}

        {/* Admin: cancel active tournament */}
        {isIssuer && data.status !== "finished" && data.status !== "none" && (
          <button onClick={handleReset} disabled={resetting} style={{
            marginTop: 10,
            background: "transparent",
            color: resetting ? "var(--muted)" : "rgba(255,80,80,.7)",
            border: "1px solid rgba(255,80,80,.25)",
            padding: "7px 14px", borderRadius: 8,
            fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 11, letterSpacing: 0.5,
            cursor: resetting ? "default" : "pointer",
          }}>
            {resetting ? "Cancelando…" : "✕ FINALIZAR TORNEO"}
          </button>
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

      {/* ── Live tournament: active match panels ─────────────────── */}
      {isLivePhase && identity && myActiveMatches.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 11, letterSpacing: 1, color: "var(--gold)" }}>
            TUS PARTIDOS
          </div>
          {myActiveMatches.map(m => (
            <TournamentMatchPanel
              key={m.id}
              match={m as LiveTournamentMatch}
              identity={identity}
              profiles={profiles}
              onActionDone={fetchTournament}
            />
          ))}
        </div>
      )}

      {/* ── Live tournament: all matches ──────────────────────────── */}
      {isLivePhase && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Group stage */}
          {data.status === "group_stage" && (
            <>
              {(["A", "B"] as const).map(g => {
                const groupMatches = data.matches.filter(m => m.group === g);
                const otherMatches = groupMatches.filter(m => m.player1 !== myPubkey && m.player2 !== myPubkey);
                return (
                  <div key={g}>
                    <div style={{ fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 11, letterSpacing: 1, color: "var(--muted)", marginBottom: 6 }}>
                      GRUPO {g}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {otherMatches.map(m => (
                        <MatchCard key={m.id} match={m} profiles={profiles}
                          expanded={expandedId === m.id}
                          onToggle={() => setExpandedId(v => v === m.id ? null : m.id)}
                        />
                      ))}
                      {otherMatches.length === 0 && (
                        <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--condensed)", padding: "4px 0" }}>
                          Todos tus partidos en este grupo se muestran arriba
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* Semi / Final phase: show all matches */}
          {(data.status === "semi" || data.status === "final") && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {data.matches
                .filter(m => m.phase !== "group")
                .filter(m => m.player1 !== myPubkey && m.player2 !== myPubkey)
                .map(m => (
                  <MatchCard key={m.id} match={m} profiles={profiles}
                    expanded={expandedId === m.id}
                    onToggle={() => setExpandedId(v => v === m.id ? null : m.id)}
                  />
                ))}
            </div>
          )}
        </div>
      )}

      {/* ── Partial group standings (during group stage) ──────────── */}
      {data.status === "group_stage" && data.groups && (
        <div>
          <div style={{ fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 11, letterSpacing: 1, color: "var(--muted)", marginBottom: 8 }}>
            CLASIFICACIÓN PARCIAL
          </div>
          {data.standings ? (
            <>
              <StandingsTable standings={data.standings.A} group="A" profiles={profiles} />
              <StandingsTable standings={data.standings.B} group="B" profiles={profiles} />
            </>
          ) : (
            // Derive from completed group matches
            (() => {
              const groupA = data.groups!.A;
              const groupB = data.groups!.B;
              const standA = computePartialStandings(groupA, data.matches.filter(m => m.group === "A"));
              const standB = computePartialStandings(groupB, data.matches.filter(m => m.group === "B"));
              return (
                <>
                  <StandingsTable standings={standA} group="A" profiles={profiles} />
                  <StandingsTable standings={standB} group="B" profiles={profiles} />
                </>
              );
            })()
          )}
        </div>
      )}

      {/* ── Results (finished) ────────────────────────────────────── */}
      {data.status === "finished" && (
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

          {tab === "groups" && data.standings && (
            <div>
              <StandingsTable standings={data.standings.A} group="A" profiles={profiles} />
              <StandingsTable standings={data.standings.B} group="B" profiles={profiles} />
            </div>
          )}

          {tab === "bracket" && semi1 && semi2 && finalMatch && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <div style={{ fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 11, letterSpacing: 1, color: "var(--muted)", marginBottom: 8 }}>
                  SEMIFINALES
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <MatchCard match={semi1} profiles={profiles} expanded={expandedId === "semi1"} onToggle={() => setExpandedId(v => v === "semi1" ? null : "semi1")} />
                  <MatchCard match={semi2} profiles={profiles} expanded={expandedId === "semi2"} onToggle={() => setExpandedId(v => v === "semi2" ? null : "semi2")} />
                </div>
              </div>
              <div>
                <div style={{ fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 11, letterSpacing: 1, color: "var(--gold)", marginBottom: 8 }}>
                  FINAL
                </div>
                <MatchCard match={finalMatch} profiles={profiles} expanded={expandedId === "final"} onToggle={() => setExpandedId(v => v === "final" ? null : "final")} />
              </div>
            </div>
          )}

          {tab === "matches" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(["A", "B"] as const).map(g => (
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

// Derive partial standings from completed matches (used during group stage before
// the issuer computes final standings)
function computePartialStandings(players: string[], matches: TournamentMatch[]): Standing[] {
  const map = new Map<string, Standing>(
    players.map(p => [p, { pubkey: p, pts: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0 }])
  );
  for (const m of matches) {
    if (m.status !== "complete" && m.status !== "timeout") continue;
    const s1 = map.get(m.player1);
    const s2 = map.get(m.player2);
    if (!s1 || !s2) continue;
    s1.gf += m.score1; s1.ga += m.score2; s1.gd = s1.gf - s1.ga;
    s2.gf += m.score2; s2.ga += m.score1; s2.gd = s2.gf - s2.ga;
    if (m.score1 > m.score2) { s1.pts += 3; s1.w++; s2.l++; }
    else if (m.score1 < m.score2) { s2.pts += 3; s2.w++; s1.l++; }
    else { s1.pts++; s2.pts++; s1.d++; s2.d++; }
  }
  return [...map.values()].sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
}
