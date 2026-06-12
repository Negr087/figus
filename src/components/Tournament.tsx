"use client";

import { useEffect, useState, useCallback } from "react";
import { requestOrderInvoice, tryPayInvoice } from "@/lib/order";
import type { Identity } from "@/lib/identity";

// ── Types (mirror issuer/tournament.ts) ───────────────────────────────────────

type TournamentStatus = "registering" | "group_stage" | "finished";

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

function KickStrip({ kicks, player }: { kicks: KickResult[]; player: 1 | 2 }) {
  // Regular kicks (first 10 = 5 per player, golden kick excluded via slice)
  const regular = kicks.filter(k => k.player === player).slice(0, 5);
  return (
    <span style={{ letterSpacing: 2, fontSize: 14 }}>
      {regular.map((k, i) => (
        <span key={i} title={k.goal ? "Gol" : "Atajado"}>
          {k.goal ? "⚽" : "❌"}
        </span>
      ))}
    </span>
  );
}

function MatchCard({ match, expanded, onToggle }: { match: Match; expanded: boolean; onToggle: () => void }) {
  const goldenKick = match.kicks.slice(10);
  const hasGolden = goldenKick.length > 0;

  return (
    <div style={{
      background: "rgba(255,255,255,.03)", borderRadius: 8,
      border: "1px solid rgba(255,255,255,.08)", overflow: "hidden",
    }}>
      <button
        onClick={onToggle}
        style={{
          width: "100%", background: "none", border: "none", padding: "10px 14px",
          display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
          color: "var(--ink)", fontFamily: "var(--condensed)",
        }}
      >
        <span style={{ flex: 1, textAlign: "left", fontSize: 11, color: "var(--muted)" }}>
          {short(match.player1)}
        </span>
        <span style={{ fontWeight: 900, fontSize: 15, color: "var(--gold)", minWidth: 40, textAlign: "center" }}>
          {match.score1} – {match.score2}
        </span>
        <span style={{ flex: 1, textAlign: "right", fontSize: 11, color: "var(--muted)" }}>
          {short(match.player2)}
        </span>
        <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: 6 }}>{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div style={{ padding: "8px 14px 12px", borderTop: "1px solid rgba(255,255,255,.06)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: "var(--muted)", width: 72, overflow: "hidden", textOverflow: "ellipsis" }}>
              {short(match.player1)}
            </span>
            <KickStrip kicks={match.kicks} player={1} />
            <span style={{ fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 13, color: match.winner === match.player1 ? "var(--gold)" : "var(--muted)", marginLeft: "auto" }}>
              {match.score1}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: hasGolden ? 6 : 0 }}>
            <span style={{ fontSize: 10, color: "var(--muted)", width: 72, overflow: "hidden", textOverflow: "ellipsis" }}>
              {short(match.player2)}
            </span>
            <KickStrip kicks={match.kicks} player={2} />
            <span style={{ fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 13, color: match.winner === match.player2 ? "var(--gold)" : "var(--muted)", marginLeft: "auto" }}>
              {match.score2}
            </span>
          </div>
          {hasGolden && (
            <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--condensed)", marginTop: 6, fontStyle: "italic" }}>
              Golden kick → ganó {short(match.winner)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StandingsTable({ standings, group }: { standings: Standing[]; group: string }) {
  const medals = ["🥇", "🥈", "  ", "  "];
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 12, letterSpacing: 1, color: "var(--gold)", marginBottom: 8 }}>
        GRUPO {group}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto auto", gap: "4px 12px", fontSize: 11, fontFamily: "var(--condensed)" }}>
        <span style={{ color: "var(--muted)", fontWeight: 700 }}>Jugador</span>
        <span style={{ color: "var(--muted)", fontWeight: 700, textAlign: "right" }}>GF</span>
        <span style={{ color: "var(--muted)", fontWeight: 700, textAlign: "right" }}>GC</span>
        <span style={{ color: "var(--muted)", fontWeight: 700, textAlign: "right" }}>GD</span>
        <span style={{ color: "var(--muted)", fontWeight: 700, textAlign: "right" }}>Pts</span>
        {standings.map((s, i) => (
          <>
            <span key={s.pubkey + "n"} style={{ color: i < 2 ? "var(--ink)" : "var(--muted)", overflow: "hidden", textOverflow: "ellipsis" }}>
              {medals[i]} {short(s.pubkey)}
            </span>
            <span key={s.pubkey + "gf"} style={{ textAlign: "right", color: "var(--muted)" }}>{s.gf}</span>
            <span key={s.pubkey + "ga"} style={{ textAlign: "right", color: "var(--muted)" }}>{s.ga}</span>
            <span key={s.pubkey + "gd"} style={{ textAlign: "right", color: s.gd >= 0 ? "#4ade80" : "#f87171" }}>
              {s.gd > 0 ? "+" : ""}{s.gd}
            </span>
            <span key={s.pubkey + "pts"} style={{ textAlign: "right", fontWeight: 900, color: i < 2 ? "var(--gold)" : "var(--muted)" }}>{s.pts}</span>
          </>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function Tournament({ identity }: { identity: Identity | null }) {
  const [data,       setData]       = useState<TournamentData | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [busy,       setBusy]       = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tab,        setTab]        = useState<"groups" | "bracket" | "matches">("groups");

  const fetchTournament = useCallback(async () => {
    try {
      const r = await fetch("/api/tournament");
      if (r.ok) { setData(await r.json()); setError(null); }
      else setError("No se pudo cargar el torneo");
    } catch { setError("No se pudo cargar el torneo"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchTournament();
    const iv = setInterval(fetchTournament, 15_000);
    return () => clearInterval(iv);
  }, [fetchTournament]);

  async function handleRegister() {
    if (!identity || busy) return;
    setBusy(true);
    try {
      const { invoice } = await requestOrderInvoice({
        action: "tournament-register" as any,
        signerMode: identity.mode,
      });
      const paid = await tryPayInvoice(invoice);
      if (!paid) { setError("No se pudo procesar el pago"); return; }
      // Poll until our pubkey appears in registrations
      for (let i = 0; i < 12; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const r = await fetch("/api/tournament");
        if (r.ok) {
          const t: TournamentData = await r.json();
          setData(t);
          if (t.registrations.some(reg => reg.pubkey === identity.pubkey)) break;
        }
      }
    } catch (e: any) {
      setError(e?.message ?? "Error al inscribirse");
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
            fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 13, color: "var(--gold)", letterSpacing: 0.5,
          }}>
            🥇 CAMPEÓN: {short(data.champion)}
            {data.champion === myPubkey && " · ¡Sos vos! 🎉"}
          </div>
        )}
      </div>

      {/* ── Registered players list ───────────────────────────────── */}
      {data.status === "registering" && data.registrations.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {data.registrations.map(r => (
            <div key={r.pubkey} style={{
              background: r.pubkey === myPubkey ? "rgba(74,222,128,.15)" : "rgba(255,255,255,.04)",
              border: `1px solid ${r.pubkey === myPubkey ? "rgba(74,222,128,.4)" : "rgba(255,255,255,.1)"}`,
              borderRadius: 99, padding: "3px 10px",
              fontSize: 10, fontFamily: "var(--condensed)", fontWeight: 700,
              color: r.pubkey === myPubkey ? "#4ade80" : "var(--muted)",
            }}>
              {short(r.pubkey)}
            </div>
          ))}
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
              <StandingsTable standings={data.standings.A} group="A" />
              <StandingsTable standings={data.standings.B} group="B" />
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
                  <MatchCard match={data.semi1} expanded={expandedId === "semi1"} onToggle={() => setExpandedId(v => v === "semi1" ? null : "semi1")} />
                  <MatchCard match={data.semi2} expanded={expandedId === "semi2"} onToggle={() => setExpandedId(v => v === "semi2" ? null : "semi2")} />
                </div>
              </div>
              <div>
                <div style={{ fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 11, letterSpacing: 1, color: "var(--gold)", marginBottom: 8 }}>
                  FINAL
                </div>
                <MatchCard match={data.final} expanded={expandedId === "final"} onToggle={() => setExpandedId(v => v === "final" ? null : "final")} />
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
                      <MatchCard key={m.id} match={m} expanded={expandedId === m.id} onToggle={() => setExpandedId(v => v === m.id ? null : m.id)} />
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
    </div>
  );
}
