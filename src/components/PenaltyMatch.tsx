"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { nip19, nip05 } from "nostr-tools";
import type { Identity } from "@/lib/identity";
import { useProfile } from "@/hooks/useProfile";
import { ARROWS } from "@/lib/penalty";
import type { MatchState, Round } from "@/lib/penalty";
import type { PenaltyMatch as PenaltyMatchType } from "@/lib/penalty";
import { usePenaltyMatch, useTurnMap, createMatch, cancelMatch } from "@/hooks/usePenaltyMatch";
import type { EventTemplate, Event as NostrEvent } from "nostr-tools";
import { signEvent } from "@/lib/identity";
import { list, subscribe, getPool, getRelays, searchProfiles } from "@/lib/pool";
import { KIND, ISSUER_PUBKEY } from "@/lib/constants";
import { CATALOG, RARITY_META, TEAMS, teamName } from "@/lib/catalog";
import { StickerFace } from "@/components/StickerCard";
import { useLang } from "@/contexts/LangContext";
import { ShareButton } from "@/components/ShareButton";
import { SITE_URL } from "@/lib/share";
import { Scene3DErrorBoundary, Scene2DFallback } from "@/components/Scene3DErrorBoundary";

const PenaltyScene3D = dynamic(() => import("@/components/PenaltyScene3D"), {
  ssr: false,
  loading: () => (
    <div style={{ height: 320, background: "#0d1a0d", borderRadius: 14 }} />
  ),
});

async function fetchNostrMeta(pubkey: string): Promise<{ name?: string; picture?: string }> {
  try {
    const { list: listEvs } = await import("@/lib/pool");
    const evs = await listEvs([{ kinds: [0], authors: [pubkey], limit: 1 }]);
    if (!evs.length) return {};
    const m = JSON.parse(evs[0].content);
    return { name: m.name || m.display_name || m.username, picture: m.picture };
  } catch { return {}; }
}

// ─── Aim grid: el pateador elige zona ─────────────────────────────────────────

export function AimGrid({ onKick, disabled }: { onKick: (zone: number) => void; disabled: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const { t } = useLang();
  const labels = [t.pm_left, t.pm_center, t.pm_right];

  return (
    <div>
      <div style={{ fontSize: 9.5, color: "rgba(255,255,255,.45)", textAlign: "center", marginBottom: 6, letterSpacing: 1.5, fontWeight: 700 }}>
        {t.pm_choose_zone}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 4 }}>
        {labels.map((label, i) => (
          <button
            key={i}
            disabled={disabled}
            onClick={() => onKick(i)}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            style={{
              background: hover === i ? "rgba(255,255,255,.22)" : "rgba(255,255,255,.07)",
              border: `1px solid ${hover === i ? "rgba(255,255,255,.6)" : "rgba(255,255,255,.15)"}`,
              borderRadius: 6, height: 44,
              cursor: disabled ? "not-allowed" : "pointer",
              color: "rgba(255,255,255,.7)", fontSize: 10,
              fontFamily: "var(--condensed)", fontWeight: 900,
              letterSpacing: 0.3,
              transition: "background .1s, border-color .1s",
              opacity: disabled ? 0.4 : 1,
            }}
          >{label}</button>
        ))}
      </div>
    </div>
  );
}

// ─── Keeper grid: el arquero elige columna ─────────────────────────────────────

export function KeeperGrid({ onBlock, disabled }: { onBlock: (col: number) => void; disabled: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const { t } = useLang();
  const labels = [t.pm_left, t.pm_center, t.pm_right];

  return (
    <div>
      <div style={{ fontSize: 9.5, color: "rgba(255,255,255,.45)", textAlign: "center", marginBottom: 6, letterSpacing: 1.5, fontWeight: 700 }}>
        {t.pm_dive_side}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 4 }}>
        {labels.map((label, col) => (
          <button
            key={col}
            disabled={disabled}
            onClick={() => onBlock(col)}
            onMouseEnter={() => setHover(col)}
            onMouseLeave={() => setHover(null)}
            style={{
              background: hover === col ? "rgba(255,255,255,.22)" : "rgba(255,255,255,.07)",
              border: `1px solid ${hover === col ? "rgba(255,255,255,.6)" : "rgba(255,255,255,.15)"}`,
              borderRadius: 6, height: 44,
              cursor: disabled ? "not-allowed" : "pointer",
              color: "rgba(255,255,255,.7)", fontSize: 10,
              fontFamily: "var(--condensed)", fontWeight: 900,
              letterSpacing: 0.3,
              transition: "background .1s, border-color .1s",
              opacity: disabled ? 0.4 : 1,
            }}
          >{label}</button>
        ))}
      </div>
    </div>
  );
}

// ─── Marcador ─────────────────────────────────────────────────────────────────

function Scoreboard({
  state,
  myPubkey,
}: {
  state: MatchState;
  myPubkey: string;
}) {
  const { match, score, rounds, currentRound, suddenDeath } = state;
  const { t } = useLang();
  const isChallenger = myPubkey === match.challenger;
  const challengerProfile = useProfile(match.challenger);
  const challengedProfile = useProfile(match.challenged);
  const challengerName = challengerProfile?.name || (match.challenger.slice(0, 8) + "…");
  const challengedName = challengedProfile?.name || (match.challenged.slice(0, 8) + "…");

  function PlayerSide({ picture, name, score: s, isMe }: { picture?: string; name: string; score: number; isMe: boolean }) {
    return (
      <div style={{ textAlign: "center", flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginBottom: 4 }}>
          {picture ? (
            <img src={picture} alt="" style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover", border: "1.5px solid var(--gold)", flexShrink: 0 }}
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <div style={{ width: 26, height: 26, borderRadius: "50%", background: "rgba(255,255,255,.08)", border: "1.5px solid rgba(255,255,255,.2)", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 900, color: "rgba(255,255,255,.5)", flexShrink: 0, fontFamily: "var(--condensed)" }}>
              {name[0]?.toUpperCase() || "?"}
            </div>
          )}
          <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.7)", fontFamily: "var(--condensed)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {name}
          </div>
        </div>
        {isMe && <div style={{ fontSize: 8, color: "rgba(255,255,255,.3)", fontFamily: "var(--condensed)", letterSpacing: 1, marginBottom: 2 }}>{t.pm_you}</div>}
        <div style={{ fontSize: 32, fontWeight: 900, color: "var(--gold)", lineHeight: 1 }}>{s}</div>
      </div>
    );
  }

  return (
    <div style={{
      background: "rgba(0,0,0,.35)", borderRadius: 10,
      padding: "10px 14px", marginBottom: 10,
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
    }}>
      <PlayerSide picture={challengerProfile?.picture} name={challengerName} score={score.challenger} isMe={isChallenger} />

      <div style={{ textAlign: "center", flexShrink: 0 }}>
        {suddenDeath ? (
          <div style={{ fontSize: 9, color: "#f59e0b", fontFamily: "var(--condensed)", fontWeight: 900, letterSpacing: 0.5, marginBottom: 2 }}>
            {t.pm_sudden_death}
          </div>
        ) : (
          <div style={{ fontSize: 10, color: "rgba(255,255,255,.4)", fontFamily: "var(--condensed)", letterSpacing: 1 }}>
            {t.pm_round} {Math.min(currentRound, match.rounds)}/{match.rounds}
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 2, maxWidth: 80 }}>
          {rounds.map(r => (
            <span key={r.number} style={{
              display: "inline-block", width: 10, height: 10,
              borderRadius: "50%",
              background: r.result === "goal" ? "var(--gold)"
                : r.result === "saved" ? "rgba(255,255,255,.2)"
                : r.result === "cheat" ? "#cc2244"
                : "rgba(255,255,255,.1)",
              border: `1px solid ${r.number > match.rounds ? "rgba(245,158,11,.5)" : "rgba(255,255,255,.2)"}`,
            }} />
          ))}
        </div>
      </div>

      <PlayerSide picture={challengedProfile?.picture} name={challengedName} score={score.challenged} isMe={!isChallenger} />
    </div>
  );
}

// ─── Tarjeta de figurita robada/perdida ──────────────────────────────────────

function StolenStickerCard({ num, won }: { num: number; won: boolean }) {
  const { t, lang } = useLang();
  const s = CATALOG[num];
  const r = s ? RARITY_META[s.rarity] : null;
  const team = s ? TEAMS[s.team] : null;
  const borderColor = won ? "rgba(82,183,136,.6)" : "rgba(255,100,100,.5)";
  const glowColor   = won ? "rgba(82,183,136,.25)" : "rgba(255,100,100,.15)";
  const labelColor  = won ? "#52b788" : "rgba(255,130,130,.9)";
  const label       = won ? t.pm_steal_won : t.pm_steal_lost;

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
      animation: "pop .4s cubic-bezier(.34,1.56,.64,1) both",
    }}>
      <div style={{
        fontSize: 10, fontWeight: 900, letterSpacing: 1.5,
        color: labelColor, fontFamily: "var(--condensed)",
      }}>
        {label}
      </div>
      <div style={{
        width: 130, height: 172, borderRadius: 10,
        border: `2px solid ${borderColor}`,
        boxShadow: `0 0 24px ${glowColor}, 0 8px 24px rgba(0,0,0,.5)`,
        overflow: "hidden", flexShrink: 0,
      }}>
        <StickerFace num={num} />
      </div>
      {s && r && team && (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontWeight: 900, fontSize: 14, color: "var(--ink)", fontFamily: "var(--condensed)" }}>
            {s.name}
          </div>
          <div style={{ fontSize: 11, color: r.ring, fontWeight: 700, fontFamily: "var(--condensed)" }}>
            {r.label.toUpperCase()} · {teamName(s.team, lang)}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function PenaltyMatchView({
  match,
  identity,
  onBack,
}: {
  match: PenaltyMatchType;
  identity: Identity;
  onBack: () => void;
}) {
  const myPubkey = identity.pubkey;
  const isChallenger = myPubkey === match.challenger;
  const { t } = useLang();
  const { state, publishing, publishError, publishCommit, publishBlock, publishReveal } = usePenaltyMatch(match, identity);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [canceling, setCanceling] = useState(false);

  async function handleCancel() {
    if (!cancelConfirm) { setCancelConfirm(true); return; }
    setCanceling(true);
    try {
      await cancelMatch(identity, match);
      onBack();
    } catch {
      setCanceling(false);
      setCancelConfirm(false);
    }
  }

  // 3D scene state
  const [scenePhase, setScenePhase] = useState<"aim" | "flying" | "result">("aim");
  const [sceneZone, setSceneZone] = useState<number | null>(null);
  const [sceneKeeperCol, setSceneKeeperCol] = useState(1);
  const [sceneIsGoal, setSceneIsGoal] = useState(false);

  const { phase, rounds } = state ?? { phase: "waiting_commit" as const, rounds: [] };
  const completedRounds = rounds.filter(r => r.result !== null);
  const lastCompleted   = completedRounds[completedRounds.length - 1] ?? null;

  // Trigger 3D animation when a round completes
  useEffect(() => {
    if (!lastCompleted?.reveal) {
      setScenePhase("aim");
      setSceneZone(null);
      return;
    }
    setSceneZone(lastCompleted.reveal.zone);
    setSceneKeeperCol(lastCompleted.block?.col ?? 1);
    setSceneIsGoal(lastCompleted.result === "goal");
    setScenePhase("flying");
    const t = setTimeout(() => setScenePhase("result"), 900);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastCompleted?.number]);

  // Reset to aim when new round starts
  useEffect(() => {
    if (phase === "waiting_commit" && lastCompleted) {
      const t = setTimeout(() => {
        setScenePhase("aim");
        setSceneZone(null);
      }, 1800);
      return () => clearTimeout(t);
    }
  }, [phase, lastCompleted?.number]);

  // Persist finished match ID so the lobby can show the "FINALIZADO" badge
  useEffect(() => {
    if (state?.phase !== "finished") return;
    try {
      const key = "figus_finished_matches";
      const stored: string[] = JSON.parse(localStorage.getItem(key) || "[]");
      if (!stored.includes(match.id)) {
        localStorage.setItem(key, JSON.stringify([...stored, match.id]));
      }
    } catch {}
  }, [state?.phase, match.id]);

  // ── Robo de figurita ─────────────────────────────────────────────────────────
  const lsKey     = `figus_steal_${match.d}`;
  const lsLostKey = `figus_lost_${match.d}`;
  const [stealPhase, setStealPhase] = useState<"idle" | "claiming" | "done" | "error">(() => {
    try { return localStorage.getItem(lsKey) ? "done" : "idle"; } catch { return "idle"; }
  });
  const [stolenNum, setStolenNum] = useState<number | null>(() => {
    try { const v = localStorage.getItem(lsKey); return v ? Number(v) : null; } catch { return null; }
  });
  // Sticker que te robaron (perspectiva del perdedor)
  const [lostNum, setLostNum] = useState<number | null>(() => {
    try { const v = localStorage.getItem(lsLostKey); return v ? Number(v) : null; } catch { return null; }
  });
  const stealCleanupRef = useRef<(() => void) | null>(null);
  const stolenCardRef   = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => { stealCleanupRef.current?.(); }, []);

  // Escuchar si alguien nos roba una figurita (perspectiva del perdedor)
  useEffect(() => {
    if (!state || state.phase !== "finished" || state.winner === myPubkey || state.winner === null) return;
    if (lostNum !== null) return; // ya tenemos el resultado
    const coord = `${KIND.PENALTY_MATCH}:${match.challenger}:${match.d}`;
    const since = Math.floor(Date.now() / 1000) - 120;
    const filter = {
      kinds: [KIND.SETTLEMENT],
      "#a": [coord],
      ...(ISSUER_PUBKEY ? { authors: [ISSUER_PUBKEY] } : {}),
      since,
    };
    const unsub = subscribe([filter], (ev: NostrEvent) => {
      if (ev.tags.find(t => t[0] === "figus-action")?.[1] !== "penalty-steal") return;
      const stickerTag = ev.tags.find(t => t[0] === "sticker")?.[1];
      if (!stickerTag) return;
      const num = Number(stickerTag.split(":")[1]);
      if (!num) return;
      setLostNum(num);
      try { localStorage.setItem(lsLostKey, String(num)); } catch {}
    });
    return unsub;
  }, [state?.phase, state?.winner, myPubkey, match, lostNum, lsLostKey]);

  const claimSteal = useCallback(async () => {
    if (!state || state.winner !== myPubkey) return;
    setStealPhase("claiming");

    const coord = `${KIND.PENALTY_MATCH}:${match.challenger}:${match.d}`;
    const loser = myPubkey === match.challenger ? match.challenged : match.challenger;
    const since = Math.floor(Date.now() / 1000);
    let resolved = false;

    let unsubFn: (() => void) | null = null;
    let pollIv: ReturnType<typeof setInterval> | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      unsubFn?.();
      if (pollIv) clearInterval(pollIv);
      if (timeoutId) clearTimeout(timeoutId);
      stealCleanupRef.current = null;
    };

    const handleSettlement = (ev: NostrEvent) => {
      if (ev.tags.find(t => t[0] === "figus-action")?.[1] !== "penalty-steal") return;
      const stickerTag = ev.tags.find(t => t[0] === "sticker")?.[1];
      if (!stickerTag) return;
      const num = Number(stickerTag.split(":")[1]);
      if (!num) return;
      resolved = true;
      cleanup();
      setStolenNum(num);
      setStealPhase("done");
      try { localStorage.setItem(lsKey, String(num)); } catch {}
    };

    try {
      const tmpl: EventTemplate = {
        kind: KIND.STEAL_CLAIM,
        created_at: since,
        content: "",
        tags: [["a", coord], ["p", loser]],
      };
      const signed = await signEvent(tmpl, identity.mode);
      await Promise.any(getPool().publish(getRelays(), signed));
    } catch {
      setStealPhase("error");
      return;
    }

    const baseFilter = {
      kinds: [KIND.SETTLEMENT],
      "#p": [myPubkey],
      "#a": [coord],
      since: since - 5,
    };
    const filter = ISSUER_PUBKEY ? { ...baseFilter, authors: [ISSUER_PUBKEY] } : baseFilter;

    unsubFn = subscribe([filter], handleSettlement);

    pollIv = setInterval(async () => {
      if (resolved) return;
      const evs = await list([filter]);
      evs.forEach(handleSettlement);
    }, 5000);

    timeoutId = setTimeout(() => {
      if (!resolved) setStealPhase("error");
      cleanup();
    }, 30000);

    stealCleanupRef.current = cleanup;
  }, [match, identity, myPubkey, state, lsKey]);

  const handleKick = useCallback(async (zone: number) => {
    await publishCommit(zone);
  }, [publishCommit]);

  const handleBlock = useCallback(async (col: number) => {
    const commitId = state?.rounds[state.currentRound - 1]?.commit?.id;
    if (!commitId) return;
    await publishBlock(col, commitId);
  }, [state, publishBlock]);

  const handleReveal = useCallback(async () => {
    const round = state?.rounds[state.currentRound - 1];
    if (!round?.commit) return;
    await publishReveal(round.commit.id);
  }, [state, publishReveal]);

  if (!state) {
    return (
      <div style={{ textAlign: "center", color: "var(--muted)", padding: 32, fontFamily: "var(--condensed)" }}>
        {t.pm_loading}
      </div>
    );
  }

  const currentRound = rounds[state.currentRound - 1];
  const iAmKicker     = myPubkey === currentRound?.kicker;
  const iAmGoalkeeper = myPubkey === currentRound?.goalkeeper;

  return (
    <div style={{ fontFamily: "var(--condensed)" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <button
          onClick={onBack}
          style={{ background: "transparent", border: "1px solid var(--line)", color: "var(--muted)", padding: "5px 10px", borderRadius: 7, fontSize: 11, cursor: "pointer" }}
        >
          {t.pm_back}
        </button>
        <div style={{ fontSize: 16, fontWeight: 900, color: "var(--ink)", flex: 1 }}>
          {t.pm_pvp_title} · {match.rounds / 2} {t.pm_rounds_label} c/u
        </div>
        {phase !== "finished" && (
          <button
            onClick={handleCancel}
            disabled={canceling}
            style={{
              background: cancelConfirm ? "rgba(255,60,60,0.15)" : "transparent",
              border: `1px solid ${cancelConfirm ? "rgba(255,60,60,0.5)" : "var(--line)"}`,
              color: cancelConfirm ? "rgba(255,100,100,0.9)" : "var(--muted)",
              padding: "5px 10px", borderRadius: 7, fontSize: 11,
              cursor: canceling ? "default" : "pointer",
              opacity: canceling ? 0.5 : 1,
              flexShrink: 0,
              fontFamily: "var(--condensed)", fontWeight: 700,
            }}
          >
            {canceling ? "…" : cancelConfirm ? "¿Confirmar?" : "ABANDONAR"}
          </button>
        )}
      </div>

      {/* 3D Scene */}
      <div style={{ borderRadius: 14, overflow: "hidden", boxShadow: "0 8px 28px rgba(0,0,0,.55)", marginBottom: 10 }}>
        <Scene3DErrorBoundary fallback={<Scene2DFallback phase={scenePhase} isGoal={sceneIsGoal} />}>
          <PenaltyScene3D
            phase={scenePhase}
            zone={sceneZone}
            keeperCol={sceneKeeperCol}
            isGoal={sceneIsGoal}
          />
        </Scene3DErrorBoundary>
      </div>

      {/* Marcador */}
      <Scoreboard state={state} myPubkey={myPubkey} />

      {/* Resultado de última ronda */}
      {lastCompleted && scenePhase !== "aim" && (
        <div style={{
          textAlign: "center", padding: "8px 0 4px",
          animation: "pop .35s cubic-bezier(.34,1.56,.64,1) both",
        }}>
          {lastCompleted.result === "cheat" ? (
            <div style={{ fontSize: 14, fontWeight: 900, color: "#cc2244", fontFamily: "var(--condensed)" }}>
              {t.pm_cheat}
            </div>
          ) : lastCompleted.result === "goal" ? (
            <div style={{ fontSize: 22, fontWeight: 900, color: "#fff", textShadow: "0 0 20px rgba(255,255,200,.8)", fontFamily: "var(--condensed)" }}>
              {t.pm_goal}
            </div>
          ) : (
            <div style={{ fontSize: 22, fontWeight: 900, color: "#ff8a80", fontFamily: "var(--condensed)" }}>
              {t.pm_saved}
            </div>
          )}
        </div>
      )}

      {/* Controles de ronda activa */}
      {phase !== "finished" && (
        <div style={{
          background: "linear-gradient(175deg, #1b5e20 0%, #2e7d32 45%, #388e3c 100%)",
          borderRadius: 14, padding: "12px 14px",
          marginTop: 8,
          border: "2px solid rgba(255,255,255,0.12)",
          boxShadow: "inset 0 -4px 0 rgba(0,0,0,.35)",
        }}>
          {phase === "waiting_commit" && iAmKicker && (
            <AimGrid onKick={handleKick} disabled={publishing} />
          )}
          {phase === "waiting_commit" && !iAmKicker && (
            <div style={{ textAlign: "center", color: "rgba(255,255,255,.5)", fontSize: 12, padding: "10px 0", fontFamily: "var(--condensed)", fontWeight: 700 }}>
              {t.pm_waiting_kicker}
            </div>
          )}

          {phase === "waiting_block" && iAmGoalkeeper && (
            <KeeperGrid onBlock={(col) => handleBlock(col)} disabled={publishing} />
          )}
          {phase === "waiting_block" && !iAmGoalkeeper && (
            <div style={{ textAlign: "center", color: "rgba(255,255,255,.5)", fontSize: 12, padding: "10px 0", fontFamily: "var(--condensed)", fontWeight: 700 }}>
              {t.pm_waiting_keeper}
            </div>
          )}

          {phase === "waiting_reveal" && iAmKicker && (
            <div style={{ textAlign: "center", padding: "8px 0" }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,.5)", marginBottom: 8, fontFamily: "var(--condensed)" }}>
                {t.pm_keeper_chose}
              </div>
              <button
                onClick={handleReveal}
                disabled={publishing}
                style={{
                  background: "var(--gold)", color: "#030b18",
                  border: "none", padding: "10px 24px", borderRadius: 8,
                  fontWeight: 900, fontSize: 13, fontFamily: "var(--condensed)",
                  cursor: publishing ? "not-allowed" : "pointer",
                  opacity: publishing ? 0.6 : 1,
                }}
              >
                {publishing ? t.pm_publishing : t.pm_reveal_zone}
              </button>
            </div>
          )}
          {phase === "waiting_reveal" && !iAmKicker && (
            <div style={{ textAlign: "center", color: "rgba(255,255,255,.5)", fontSize: 12, padding: "10px 0", fontFamily: "var(--condensed)", fontWeight: 700 }}>
              {t.pm_waiting_reveal}
            </div>
          )}

          {/* Error de publicación — visible en cualquier fase */}
          {publishError && (
            <div style={{
              marginTop: 8,
              padding: "8px 12px",
              background: "rgba(255,60,60,0.12)",
              border: "1px solid rgba(255,60,60,0.35)",
              borderRadius: 8,
              fontSize: 11,
              color: "rgba(255,120,120,0.95)",
              fontFamily: "var(--condensed)",
              textAlign: "center",
            }}>
              ⚠ {publishError}
            </div>
          )}
        </div>
      )}

      {/* Resultado final */}
      {phase === "finished" && (
        <div style={{
          textAlign: "center", padding: "20px 0",
          animation: "pop .35s cubic-bezier(.34,1.56,.64,1) both",
        }}>
          {state.winner === null ? (
            <div style={{ fontSize: 24, fontWeight: 900, color: "var(--muted)" }}>{t.pm_draw}</div>
          ) : state.winner === myPubkey ? (
            <div style={{ fontSize: 26, fontWeight: 900, color: "var(--gold)", textShadow: "0 0 24px rgba(232,185,35,.5)" }}>
              {t.pm_win}
            </div>
          ) : (
            <div style={{ fontSize: 24, fontWeight: 900, color: "rgba(255,100,100,.8)" }}>
              {t.pm_lose}
            </div>
          )}

          {/* Robo de figurita — ganador */}
          {state.winner === myPubkey && (
            <div style={{ marginTop: 14, marginBottom: 4 }}>
              {stealPhase === "idle" && (
                <button
                  onClick={claimSteal}
                  style={{
                    background: "linear-gradient(135deg, rgba(232,185,35,.15), rgba(232,185,35,.06))",
                    border: "1px solid rgba(232,185,35,.4)",
                    color: "var(--gold)",
                    padding: "11px 28px", borderRadius: 10,
                    fontWeight: 900, fontSize: 14,
                    fontFamily: "var(--condensed)",
                    cursor: "pointer", letterSpacing: 0.5,
                  }}
                >
                  {t.pm_steal_btn}
                </button>
              )}
              {stealPhase === "claiming" && (
                <div style={{ color: "var(--muted)", fontSize: 12, fontFamily: "var(--condensed)", padding: "8px 0" }}>
                  {t.pm_steal_sending}
                </div>
              )}
              {stealPhase === "done" && stolenNum !== null && (
                <div>
                  <div ref={stolenCardRef}>
                    <StolenStickerCard num={stolenNum} won />
                  </div>
                  {(() => {
                    const s = CATALOG[stolenNum];
                    const opponentPubkey = isChallenger ? match.challenged : match.challenger;
                    const opponentNpub = nip19.npubEncode(opponentPubkey);
                    const content = `⚽ ¡Le robé la #${stolenNum} ${s.name} a nostr:${opponentNpub} ganando una tanda de penales en el álbum del Mundial 2026!\n\nJugá en ${SITE_URL} 🎴 #FIFAWorldCup2026 #Figus`;
                    return (
                      <ShareButton
                        content={content}
                        identity={identity}
                        tags={[["p", opponentPubkey]]}
                        cardRef={stolenCardRef}
                        style={{ marginTop: 8, width: "100%" }}
                      />
                    );
                  })()}
                </div>
              )}
              {stealPhase === "error" && (
                <div>
                  <div style={{ fontSize: 11, color: "rgba(255,100,100,.7)", marginBottom: 6, fontFamily: "var(--condensed)" }}>
                    {t.pm_issuer_error}
                  </div>
                  <button
                    onClick={() => setStealPhase("idle")}
                    style={{
                      background: "transparent", border: "1px solid rgba(255,100,100,.3)",
                      color: "rgba(255,100,100,.7)", padding: "5px 14px",
                      borderRadius: 7, fontSize: 10, fontFamily: "var(--condensed)",
                      fontWeight: 700, cursor: "pointer",
                    }}
                  >
                    {t.pm_retry}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Figurita perdida — perdedor */}
          {state.winner !== null && state.winner !== myPubkey && lostNum !== null && (
            <div style={{ marginTop: 14, marginBottom: 4 }}>
              <StolenStickerCard num={lostNum} won={false} />
            </div>
          )}

          <button
            onClick={onBack}
            style={{
              marginTop: 16, background: "var(--panel2)", border: "1px solid var(--line)",
              color: "var(--muted)", padding: "9px 20px", borderRadius: 8,
              fontSize: 12, fontFamily: "var(--condensed)", fontWeight: 700, cursor: "pointer",
            }}
          >
            {t.pm_back_lobby}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Tarjetas de partido (usan useProfile para avatar + nombre) ───────────────

function IncomingMatchCard({
  match, myTurn, isFinished, onEnterMatch, onChallenge, onDismiss,
}: {
  match: PenaltyMatchType;
  myTurn: boolean | null;
  isFinished: boolean;
  onEnterMatch: (m: PenaltyMatchType) => void;
  onChallenge: (pubkey: string) => void;
  onDismiss?: () => void;
}) {
  const { t } = useLang();
  const profile = useProfile(match.challenger);
  const name = profile?.name || (match.challenger.slice(0, 8) + "…");
  const picture = profile?.picture;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      background: myTurn ? "rgba(82,183,136,.1)" : isFinished ? "rgba(82,183,136,.04)" : "var(--panel)",
      border: `1px solid ${myTurn ? "rgba(82,183,136,.6)" : isFinished ? "rgba(82,183,136,.3)" : "var(--line)"}`,
      borderRadius: 10, padding: "10px 12px",
      boxShadow: myTurn ? "0 0 0 1px rgba(82,183,136,.25)" : "none",
      transition: "all .2s",
    }}>
      {picture ? (
        <img src={picture} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", border: "1.5px solid var(--line)", flexShrink: 0 }}
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
      ) : (
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--panel2)", border: "1.5px solid var(--line)", display: "grid", placeItems: "center", fontSize: 14, color: "var(--muted)", fontWeight: 900, flexShrink: 0, fontFamily: "var(--condensed)" }}>
          {name[0]?.toUpperCase() || "?"}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {name}
        </div>
        <div style={{ fontSize: 10, marginTop: 2, color: myTurn ? "rgb(82,183,136)" : "var(--muted)", fontWeight: myTurn ? 900 : 400 }}>
          {myTurn ? "⚡ TU TURNO" : isFinished ? t.pm_finished_short : "esperando…"}
        </div>
      </div>
      {isFinished ? (
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <button
            onClick={() => onChallenge(match.challenger)}
            style={{ background: "transparent", color: "var(--gold)", border: "1px solid rgba(232,185,35,.4)", padding: "6px 10px", borderRadius: 7, fontWeight: 900, fontSize: 10, cursor: "pointer", fontFamily: "var(--condensed)" }}
          >{t.pm_rechallenge}</button>
          {onDismiss && (
            <button
              onClick={onDismiss}
              style={{ background: "transparent", color: "var(--muted)", border: "1px solid var(--line)", width: 28, borderRadius: 7, fontWeight: 900, fontSize: 12, cursor: "pointer", lineHeight: 1 }}
            >×</button>
          )}
        </div>
      ) : (
        <button
          onClick={() => onEnterMatch(match)}
          style={{
            background: myTurn ? "rgb(82,183,136)" : "var(--panel2)",
            color: myTurn ? "#030b18" : "var(--muted)",
            border: myTurn ? "none" : "1px solid var(--line)",
            padding: "7px 14px", borderRadius: 7, fontWeight: 900, fontSize: 11,
            cursor: "pointer", flexShrink: 0, fontFamily: "var(--condensed)",
          }}
        >{myTurn ? t.pm_play : t.pm_view}</button>
      )}
    </div>
  );
}

function OutgoingMatchCard({
  match, myTurn, isFinished, onEnterMatch, onCancel, onChallenge, onDismiss,
}: {
  match: PenaltyMatchType;
  myTurn: boolean | null;
  isFinished: boolean;
  onEnterMatch: (m: PenaltyMatchType) => void;
  onCancel: (m: PenaltyMatchType) => void;
  onChallenge: (pubkey: string) => void;
  onDismiss?: () => void;
}) {
  const { t } = useLang();
  const profile = useProfile(match.challenged);
  const name = profile?.name || (match.challenged.slice(0, 8) + "…");
  const picture = profile?.picture;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      background: myTurn ? "rgba(82,183,136,.1)" : "var(--panel)",
      border: `1px solid ${myTurn ? "rgba(82,183,136,.6)" : isFinished ? "rgba(82,183,136,.3)" : "var(--line)"}`,
      borderRadius: 10, padding: "10px 12px",
      boxShadow: myTurn ? "0 0 0 1px rgba(82,183,136,.25)" : "none",
      transition: "all .2s",
    }}>
      {picture ? (
        <img src={picture} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", border: "1.5px solid var(--line)", flexShrink: 0 }}
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
      ) : (
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--panel2)", border: "1.5px solid var(--line)", display: "grid", placeItems: "center", fontSize: 14, color: "var(--muted)", fontWeight: 900, flexShrink: 0, fontFamily: "var(--condensed)" }}>
          {name[0]?.toUpperCase() || "?"}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {name}
        </div>
        <div style={{ fontSize: 10, marginTop: 2, color: myTurn ? "rgb(82,183,136)" : "var(--muted)", fontWeight: myTurn ? 900 : 400 }}>
          {myTurn ? "⚡ TU TURNO" : isFinished ? t.pm_finished_short : "esperando rival…"}
        </div>
      </div>
      {isFinished ? (
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <button
            onClick={() => onChallenge(match.challenged)}
            style={{ background: "transparent", color: "var(--gold)", border: "1px solid rgba(232,185,35,.4)", padding: "6px 10px", borderRadius: 7, fontWeight: 900, fontSize: 10, cursor: "pointer", fontFamily: "var(--condensed)" }}
          >{t.pm_rechallenge}</button>
          {onDismiss && (
            <button
              onClick={onDismiss}
              style={{ background: "transparent", color: "var(--muted)", border: "1px solid var(--line)", width: 28, borderRadius: 7, fontWeight: 900, fontSize: 12, cursor: "pointer", lineHeight: 1 }}
            >×</button>
          )}
        </div>
      ) : (
        <>
          <button
            onClick={() => onEnterMatch(match)}
            style={{
              background: myTurn ? "rgb(82,183,136)" : "var(--panel2)",
              color: myTurn ? "#030b18" : "var(--muted)",
              border: myTurn ? "none" : "1px solid var(--line)",
              padding: "6px 12px", borderRadius: 7, fontWeight: 900, fontSize: 11,
              cursor: "pointer", flexShrink: 0, fontFamily: "var(--condensed)",
            }}
          >{myTurn ? t.pm_play : t.pm_view}</button>
          {!myTurn && (
            <button
              onClick={() => onCancel(match)}
              style={{ background: "transparent", color: "rgba(255,100,100,.8)", border: "1px solid rgba(255,100,100,.3)", padding: "6px 10px", borderRadius: 7, fontWeight: 900, fontSize: 10, cursor: "pointer", flexShrink: 0, fontFamily: "var(--condensed)" }}
            >✕</button>
          )}
        </>
      )}
    </div>
  );
}

// ─── Lobby: desafíos pendientes + crear desafío ───────────────────────────────

export function PenaltyMatchLobby({
  identity,
  incoming,
  outgoing,
  matchesLoading,
  onEnterMatch,
}: {
  identity: Identity | null;
  incoming: PenaltyMatchType[];
  outgoing: PenaltyMatchType[];
  matchesLoading: boolean;
  onEnterMatch: (match: PenaltyMatchType) => void;
}) {
  const { t } = useLang();
  const myPubkey = identity?.pubkey ?? null;
  const loading = matchesLoading;
  const [finishedIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("figus_finished_matches") || "[]"); } catch { return []; }
  });
  const [dismissedIds, setDismissedIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("figus_dismissed_matches") || "[]"); } catch { return []; }
  });

  const dismissMatch = (id: string) => {
    setDismissedIds(prev => {
      const next = [...prev, id];
      try { localStorage.setItem("figus_dismissed_matches", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // Una sola query batch para el estado de turno de todas las partidas activas
  const visibleMatches = [...incoming, ...outgoing].filter(m => !dismissedIds.includes(m.id));
  const turnMap = useTurnMap(visibleMatches, myPubkey);

  const [challenging, setChallenging]   = useState(false);
  const [inputPk, setInputPk]           = useState("");
  const [publishing, setPublishing]     = useState(false);
  const [resolving, setResolving]       = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [resolvedProfile, setResolvedProfile] = useState<{
    pubkey: string; npub: string; name?: string; picture?: string;
  } | null>(null);
  const [justCreated, setJustCreated] = useState<{
    pubkey: string; npub: string; name?: string;
  } | null>(null);
  const [suggestions, setSuggestions] = useState<Array<{
    pubkey: string; npub: string; name?: string; picture?: string; nip05?: string;
  }>>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [playerPubkeys, setPlayerPubkeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!ISSUER_PUBKEY) return;
    list([{ kinds: [KIND.OWNERSHIP], authors: [ISSUER_PUBKEY], limit: 500 }])
      .then(events => {
        const pks = new Set(events.flatMap(ev => ev.tags.filter(t => t[0] === "p").map(t => t[1])));
        setPlayerPubkeys(pks);
      })
      .catch(() => {});
  }, []);

  // Resolve pubkey live as the user types
  useEffect(() => {
    const input = inputPk.trim();
    setResolvedProfile(null);
    setSuggestions([]);
    setError(null);
    if (!input) return;

    // npub — resolve immediately
    if (input.startsWith("npub1")) {
      try {
        const decoded = nip19.decode(input);
        if (decoded.type === "npub") {
          const pk = decoded.data as string;
          setResolvedProfile({ pubkey: pk, npub: input });
          fetchNostrMeta(pk).then(meta =>
            setResolvedProfile(prev => prev?.pubkey === pk ? { ...prev, ...meta } : prev)
          );
        }
      } catch {
        setError(t.pm_invalid_npub);
      }
      return;
    }

    // hex pubkey — resolve immediately
    if (/^[0-9a-f]{64}$/i.test(input)) {
      const pk = input.toLowerCase();
      const npub = nip19.npubEncode(pk);
      setResolvedProfile({ pubkey: pk, npub });
      fetchNostrMeta(pk).then(meta =>
        setResolvedProfile(prev => prev?.pubkey === pk ? { ...prev, ...meta } : prev)
      );
      return;
    }

    // Determine search term and whether we have a complete NIP-05 address
    const atIdx = input.indexOf("@");
    const afterAt = atIdx > 0 ? input.slice(atIdx + 1) : "";
    const isCompleteNip05 = atIdx > 0 && afterAt.includes(".");
    // Use the part before "@" as the search term (or full input if no "@")
    const searchTerm = atIdx > 0 ? input.slice(0, atIdx) : input;

    // NIP-05 full address (user@domain.tld) — debounce 700ms
    if (isCompleteNip05) {
      setResolving(true);
      const timer = setTimeout(async () => {
        try {
          const pointer = await nip05.queryProfile(input);
          if (pointer?.pubkey) {
            const pk = pointer.pubkey;
            const npub = nip19.npubEncode(pk);
            setResolvedProfile({ pubkey: pk, npub });
            setError(null);
            fetchNostrMeta(pk).then(meta =>
              setResolvedProfile(prev => prev?.pubkey === pk ? { ...prev, ...meta } : prev)
            );
          } else {
            setError(t.pm_nip05_not_found);
          }
        } catch {
          setError(t.pm_nip05_not_found);
        } finally {
          setResolving(false);
        }
      }, 700);
      return () => { clearTimeout(timer); setResolving(false); };
    }

    // Free-text NIP-50 search — debounce 400ms
    if (searchTerm.length < 2) return;
    setLoadingSuggestions(true);
    const timer = setTimeout(async () => {
      try {
        const evs = await searchProfiles(searchTerm);
        const seen = new Set<string>();
        const results = evs.flatMap(ev => {
          if (seen.has(ev.pubkey)) return [];
          seen.add(ev.pubkey);
          try {
            const m = JSON.parse(ev.content);
            return [{
              pubkey: ev.pubkey,
              npub: nip19.npubEncode(ev.pubkey),
              name: m.name || m.display_name || m.username,
              picture: m.picture,
              nip05: m.nip05,
            }];
          } catch { return []; }
        });
        results.sort((a, b) => (playerPubkeys.has(b.pubkey) ? 1 : 0) - (playerPubkeys.has(a.pubkey) ? 1 : 0));
        setSuggestions(results);
      } catch { /* silent */ } finally {
        setLoadingSuggestions(false);
      }
    }, 400);
    return () => { clearTimeout(timer); setLoadingSuggestions(false); };
  }, [inputPk]);

  function selectSuggestion(s: { pubkey: string; npub: string; name?: string; picture?: string; nip05?: string }) {
    // Use npub so the useEffect decodes it synchronously without a new async lookup
    setInputPk(s.npub);
    setSuggestions([]);
    setError(null);
  }

  async function handleCreate() {
    if (!identity || !resolvedProfile) return;
    setError(null);
    setPublishing(true);
    try {
      const profile = resolvedProfile;
      await createMatch(identity, profile.pubkey, 3);
      setInputPk("");
      setResolvedProfile(null);
      setChallenging(false);
      setJustCreated(profile);
    } catch {
      setError(t.pm_challenge_error);
    } finally {
      setPublishing(false);
    }
  }

  async function handleCancel(match: PenaltyMatchType) {
    if (!identity) return;
    await cancelMatch(identity, match);
  }

  function startChallenge(opponentPubkey: string) {
    setInputPk(nip19.npubEncode(opponentPubkey));
    setSuggestions([]);
    setError(null);
    setChallenging(true);
  }

  if (!identity) {
    return (
      <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 12, padding: "14px 0", fontFamily: "var(--condensed)", fontWeight: 700 }}>
        {t.pm_not_connected}
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "var(--condensed)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 900, color: "var(--ink)", lineHeight: 1 }}>⚽ {t.pm_pvp_title}</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>{t.pm_pvp_description}</div>
        </div>
        <button
          onClick={() => setChallenging(true)}
          style={{
            background: "var(--fifa-blue)", color: "#fff", border: "none",
            padding: "8px 14px", borderRadius: 8,
            fontWeight: 900, fontSize: 11, fontFamily: "var(--condensed)",
            letterSpacing: 0.5, cursor: "pointer",
          }}
        >
          {t.pm_challenge_btn}
        </button>
      </div>

      {/* Desafío recién enviado — confirmación */}
      {justCreated && (
        <div style={{
          background: "rgba(82,183,136,.08)",
          border: "1px solid rgba(82,183,136,.3)",
          borderRadius: 12, padding: "12px 14px",
          marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
        }}>
          <div style={{ fontSize: 12, color: "rgb(82,183,136)", fontFamily: "var(--condensed)", fontWeight: 700 }}>
            ✓ {t.share_challenge_sent}
          </div>
          <button
            onClick={() => setJustCreated(null)}
            style={{
              background: "transparent", border: "1px solid var(--line)",
              color: "var(--muted)", padding: "4px 8px", borderRadius: 6,
              fontSize: 10, cursor: "pointer", fontFamily: "var(--condensed)",
            }}
          >✕</button>
        </div>
      )}

      {/* Form de desafío */}
      {challenging && (
        <div style={{
          background: "var(--panel)", border: "1px solid var(--line)",
          borderRadius: 12, padding: "14px 16px", marginBottom: 14,
        }}>
          <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: 0.5, marginBottom: 6 }}>
            {t.pm_opponent_label}
          </div>
          <input
            autoFocus
            value={inputPk}
            onChange={e => setInputPk(e.target.value)}
            onKeyDown={e => e.key === "Escape" && setSuggestions([])}
            placeholder="npub1… · hex · usuario@dominio.com"
            style={{
              width: "100%", background: "var(--panel2)",
              border: `1px solid ${error ? "#cc2244" : resolvedProfile ? "rgba(82,183,136,.5)" : "var(--line)"}`,
              borderRadius: 8, padding: "8px 10px",
              color: "var(--ink)", fontSize: 11, fontFamily: "monospace",
              boxSizing: "border-box", marginBottom: 0, outline: "none",
            }}
          />

          {/* NIP-50 autocomplete suggestions */}
          {(loadingSuggestions || suggestions.length > 0) && !resolvedProfile && (
            <div style={{
              background: "var(--panel2)", border: "1px solid var(--line)",
              borderTop: "none", borderRadius: "0 0 8px 8px",
              marginBottom: 6, overflow: "hidden",
            }}>
              {loadingSuggestions && suggestions.length === 0 && (
                <div style={{ padding: "8px 10px", fontSize: 10, color: "var(--muted)", fontFamily: "var(--condensed)" }}>…</div>
              )}
              {suggestions.map(s => (
                <div
                  key={s.pubkey}
                  onClick={() => selectSuggestion(s)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "7px 10px", cursor: "pointer",
                    borderTop: "1px solid var(--line)",
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = "rgba(232,185,35,.07)"}
                  onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = "transparent"}
                >
                  {s.picture ? (
                    <img src={s.picture} alt="" style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    <div style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--panel)", display: "grid", placeItems: "center", fontSize: 13, flexShrink: 0 }}>👤</div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)", fontFamily: "var(--condensed)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.name || s.npub.slice(0, 16) + "…"}
                    </div>
                    {s.nip05 && (
                      <div style={{ fontSize: 10, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {s.nip05}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginBottom: 6 }} />

          {resolving && (
            <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 8 }}>{t.pm_resolving}</div>
          )}
          {error && !resolving && (
            <div style={{ fontSize: 11, color: "#cc2244", marginBottom: 8 }}>{error}</div>
          )}
          {resolvedProfile && !resolving && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "rgba(82,183,136,.08)", border: "1px solid rgba(82,183,136,.3)",
              borderRadius: 8, padding: "8px 10px", marginBottom: 8,
            }}>
              {resolvedProfile.picture ? (
                <img
                  src={resolvedProfile.picture}
                  alt=""
                  style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                />
              ) : (
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--panel2)",
                  display: "grid", placeItems: "center", fontSize: 16, flexShrink: 0 }}>
                  👤
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                {resolvedProfile.name && (
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)", overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {resolvedProfile.name}
                  </div>
                )}
                <div style={{ fontSize: 9.5, color: "var(--muted)", fontFamily: "monospace",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {resolvedProfile.npub.slice(0, 24)}…
                </div>
              </div>
              <span style={{ color: "#52b788", fontSize: 16, flexShrink: 0 }}>✓</span>
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleCreate}
              disabled={!resolvedProfile || publishing || resolving}
              style={{
                flex: 1, background: "var(--fifa-blue)", color: "#fff", border: "none",
                padding: "9px 0", borderRadius: 8, fontWeight: 900, fontSize: 12,
                cursor: resolvedProfile && !publishing && !resolving ? "pointer" : "not-allowed",
                opacity: resolvedProfile && !publishing && !resolving ? 1 : 0.5,
              }}
            >
              {publishing ? t.pm_publishing : t.pm_challenge_submit}
            </button>
            <button
              onClick={() => { setChallenging(false); setInputPk(""); setError(null); }}
              style={{
                background: "transparent", border: "1px solid var(--line)",
                color: "var(--muted)", padding: "9px 14px", borderRadius: 8,
                fontSize: 12, cursor: "pointer",
              }}
            >{t.pm_challenge_cancel}</button>
          </div>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 12, padding: 16 }}>{t.pm_loading_matches}</div>
      )}

      {(() => {
        const allMatches = [
          ...incoming.map(m => ({ m, isIncoming: true })),
          ...outgoing.map(m => ({ m, isIncoming: false })),
        ].filter(({ m }) => !dismissedIds.includes(m.id));
        const active   = allMatches.filter(({ m }) => !finishedIds.includes(m.id));
        const finished = allMatches.filter(({ m }) =>  finishedIds.includes(m.id));

        const renderCard = ({ m, isIncoming }: { m: PenaltyMatchType; isIncoming: boolean }) => {
          const isFinished = finishedIds.includes(m.id);
          const myTurn = turnMap.get(m.id) ?? null;
          return isIncoming ? (
            <IncomingMatchCard
              key={m.id} match={m} myTurn={myTurn} isFinished={isFinished}
              onEnterMatch={onEnterMatch} onChallenge={startChallenge}
              onDismiss={isFinished ? () => dismissMatch(m.id) : undefined}
            />
          ) : (
            <OutgoingMatchCard
              key={m.id} match={m} myTurn={myTurn} isFinished={isFinished}
              onEnterMatch={onEnterMatch} onCancel={handleCancel} onChallenge={startChallenge}
              onDismiss={isFinished ? () => dismissMatch(m.id) : undefined}
            />
          );
        };

        return (
          <>
            {/* En curso */}
            {active.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "var(--gold)", letterSpacing: 1.5, fontWeight: 900, marginBottom: 8 }}>
                  {t.pm_challenges_active}
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  {active.map(renderCard)}
                </div>
              </div>
            )}

            {/* Terminados */}
            {finished.length > 0 && (
              <div>
                <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: 1.5, fontWeight: 900, marginBottom: 8 }}>
                  {t.pm_challenges_finished}
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  {finished.map(renderCard)}
                </div>
              </div>
            )}

            {!loading && allMatches.length === 0 && (
              <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 12, padding: "12px 0", fontFamily: "var(--condensed)" }}>
                {t.pm_no_matches}
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}
