"use client";

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import type { EventTemplate } from "nostr-tools";
import { KIND } from "@/lib/constants";
import { getPool, getRelays } from "@/lib/pool";
import { signEvent, type Identity } from "@/lib/identity";
import { generateNonce, commitZone } from "@/lib/penalty";
import { AimGrid, KeeperGrid } from "@/components/PenaltyMatch";
import { Scene3DErrorBoundary, Scene2DFallback } from "@/components/Scene3DErrorBoundary";

const PenaltyScene3D = dynamic(
  () => import("@/components/PenaltyScene3D"),
  { ssr: false, loading: () => <div style={{ height: 220, background: "#0d1a0d", borderRadius: 10 }} /> }
);

// Mirror of issuer/tournament.ts InteractiveKick (client-visible fields)
export interface InteractiveKick {
  round: number;
  kicker: string;
  goalkeeper: string;
  zone: number | null;
  col: number | null;
  goal: boolean;
  timedOut: boolean;
}

// Mirror of TournamentMatch fields returned by the API
export interface LiveTournamentMatch {
  id: string;
  matchCoord: string;
  phase: "group" | "semi" | "final";
  group?: "A" | "B";
  player1: string;
  player2: string;
  status: "pending" | "active" | "complete" | "timeout";
  kicks: InteractiveKick[];
  score1: number;
  score2: number;
  winner: string | null;
  currentRound: number;
  actionPhase: "waiting_commit" | "waiting_block" | "waiting_reveal" | null;
  currentKicker: string | null;
  currentGoalkeeper: string | null;
  pendingCommitEventId: string | null;
}

interface NostrProfile { name: string; picture: string; }

async function publishToRelays(ev: any): Promise<void> {
  return Promise.race([
    Promise.any(getPool().publish(getRelays(), ev)).then(() => {}),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
  ]);
}

function lsKey(matchId: string, round: number) { return `figus_tcommit_${matchId}_${round}`; }
function short(pk: string) { return pk.slice(0, 8) + "…"; }

function PlayerRow({
  pubkey, score, profiles, isMe,
}: { pubkey: string; score: number; profiles: Map<string, NostrProfile>; isMe: boolean }) {
  const p = profiles.get(pubkey);
  const name = p?.name || short(pubkey);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
      {p?.picture ? (
        <img src={p.picture} alt="" width={22} height={22} style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: isMe ? "1.5px solid var(--gold)" : "1.5px solid var(--line)" }}
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        <div style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--panel2)", border: isMe ? "1.5px solid var(--gold)" : "1.5px solid var(--line)", display: "grid", placeItems: "center", fontSize: 9, fontWeight: 900, color: "var(--muted)", fontFamily: "var(--condensed)", flexShrink: 0 }}>
          {name[0]?.toUpperCase() || "?"}
        </div>
      )}
      <span style={{ fontSize: 10, color: isMe ? "var(--ink)" : "var(--muted)", fontFamily: "var(--condensed)", fontWeight: isMe ? 900 : 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {name}{isMe ? " (vos)" : ""}
      </span>
      <span style={{ marginLeft: "auto", fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 20, color: "var(--gold)", flexShrink: 0 }}>
        {score}
      </span>
    </div>
  );
}

export function TournamentMatchPanel({
  match,
  identity,
  profiles,
  onActionDone,
}: {
  match: LiveTournamentMatch;
  identity: Identity;
  profiles: Map<string, NostrProfile>;
  onActionDone?: () => void;
}) {
  const myPubkey = identity.pubkey;
  const {
    matchCoord, id: matchId, currentRound, actionPhase,
    currentKicker, currentGoalkeeper, pendingCommitEventId,
  } = match;
  const isKicker = myPubkey === currentKicker;
  const isGoalkeeper = myPubkey === currentGoalkeeper;
  const iAmInMatch = myPubkey === match.player1 || myPubkey === match.player2;

  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 3D scene state
  const [scenePhase, setScenePhase] = useState<"aim" | "flying" | "result">("aim");
  const [sceneZone, setSceneZone] = useState<number | null>(null);
  const [sceneKeeperCol, setSceneKeeperCol] = useState(1);
  const [sceneIsGoal, setSceneIsGoal] = useState(false);

  // Animate when a new kick is recorded
  const prevKickCount = useRef(match.kicks.length);
  useEffect(() => {
    const kicks = match.kicks;
    if (kicks.length > prevKickCount.current) {
      prevKickCount.current = kicks.length;
      const last = kicks[kicks.length - 1];
      if (last && last.zone !== null && last.col !== null && !last.timedOut) {
        setSceneZone(last.zone);
        setSceneKeeperCol(last.col);
        setSceneIsGoal(last.goal);
        setScenePhase("flying");
        const t1 = setTimeout(() => setScenePhase("result"), 900);
        const t2 = setTimeout(() => { setScenePhase("aim"); setSceneZone(null); }, 2800);
        return () => { clearTimeout(t1); clearTimeout(t2); };
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.kicks.length]);

  // Auto-reveal: when goalkeeper has blocked and it's our turn to reveal
  const autoRevealRound = useRef(-1);
  useEffect(() => {
    if (actionPhase !== "waiting_reveal" || !isKicker || !pendingCommitEventId) return;
    if (autoRevealRound.current === currentRound) return; // already triggered

    const stored = localStorage.getItem(lsKey(matchId, currentRound));
    if (!stored) {
      setError("No se encontraron datos del commit. Recargá la página.");
      return;
    }

    autoRevealRound.current = currentRound;
    (async () => {
      try {
        const { zone, nonce } = JSON.parse(stored);
        setPublishing(true);
        const tmpl: EventTemplate = {
          kind: KIND.PENALTY_REVEAL,
          created_at: Math.floor(Date.now() / 1000),
          content: "",
          tags: [
            ["a", matchCoord],
            ["e", pendingCommitEventId],
            ["round", String(currentRound)],
            ["zone", String(zone)],
            ["nonce", nonce],
          ],
        };
        const ev = await signEvent(tmpl, identity.mode);
        await publishToRelays(ev);
        localStorage.removeItem(lsKey(matchId, currentRound));
        onActionDone?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al revelar");
        autoRevealRound.current = -1; // allow retry
      } finally {
        setPublishing(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionPhase, isKicker, pendingCommitEventId, currentRound]);

  // Reset auto-reveal ref when round advances
  useEffect(() => { autoRevealRound.current = -1; }, [currentRound]);

  async function handleKick(zone: number) {
    if (publishing) return;
    const nonce = generateNonce();
    const commit = commitZone(zone, nonce);
    try { localStorage.setItem(lsKey(matchId, currentRound), JSON.stringify({ zone, nonce })); } catch {}
    setPublishing(true);
    setError(null);
    try {
      const tmpl: EventTemplate = {
        kind: KIND.PENALTY_COMMIT,
        created_at: Math.floor(Date.now() / 1000),
        content: "",
        tags: [
          ["a", matchCoord],
          ["round", String(currentRound)],
          ["commit", commit],
        ],
      };
      const ev = await signEvent(tmpl, identity.mode);
      await publishToRelays(ev);
      onActionDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al publicar");
    } finally { setPublishing(false); }
  }

  async function handleBlock(col: number) {
    if (!pendingCommitEventId || publishing) return;
    setPublishing(true);
    setError(null);
    try {
      const tmpl: EventTemplate = {
        kind: KIND.PENALTY_BLOCK,
        created_at: Math.floor(Date.now() / 1000),
        content: "",
        tags: [
          ["a", matchCoord],
          ["e", pendingCommitEventId],
          ["round", String(currentRound)],
          ["col", String(col)],
        ],
      };
      const ev = await signEvent(tmpl, identity.mode);
      await publishToRelays(ev);
      onActionDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al publicar");
    } finally { setPublishing(false); }
  }

  const isComplete = match.status === "complete" || match.status === "timeout";
  const isSuddenDeath = currentRound > 10;
  const iAmActive = iAmInMatch && !isComplete && actionPhase !== null;
  const myTurn = isKicker || isGoalkeeper;
  const winnerProfile = match.winner ? profiles.get(match.winner) : null;
  const winnerName = match.winner ? (winnerProfile?.name || short(match.winner)) : null;

  return (
    <div style={{
      background: "rgba(0,0,0,.4)",
      border: `1px solid ${iAmActive && myTurn ? "rgba(232,185,35,.4)" : "rgba(255,255,255,.08)"}`,
      borderRadius: 12,
      overflow: "hidden",
    }}>
      {/* Score header */}
      <div style={{ padding: "10px 14px 8px", background: "rgba(255,255,255,.03)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <PlayerRow pubkey={match.player1} score={match.score1} profiles={profiles} isMe={myPubkey === match.player1} />
          <span style={{ color: "rgba(255,255,255,.2)", fontSize: 12, flexShrink: 0 }}>–</span>
          <PlayerRow pubkey={match.player2} score={match.score2} profiles={profiles} isMe={myPubkey === match.player2} />
        </div>
        <div style={{ fontSize: 9, fontFamily: "var(--condensed)", color: "var(--muted)", letterSpacing: 1 }}>
          {isComplete
            ? `COMPLETADO · Ganó ${winnerName}`
            : isSuddenDeath
            ? "MUERTE SÚBITA"
            : `RONDA ${Math.min(currentRound, 6)}/6`}
        </div>
      </div>

      {/* 3D scene — only when user is one of the players */}
      {iAmInMatch && (
        <Scene3DErrorBoundary fallback={
          <Scene2DFallback phase={scenePhase} isGoal={sceneIsGoal} />
        }>
          <PenaltyScene3D phase={scenePhase} zone={sceneZone} keeperCol={sceneKeeperCol} isGoal={sceneIsGoal} />
        </Scene3DErrorBoundary>
      )}

      {/* Action panel */}
      {iAmActive && (
        <div style={{ padding: "12px 14px" }}>
          {actionPhase === "waiting_commit" && isKicker && (
            <AimGrid onKick={handleKick} disabled={publishing} />
          )}
          {actionPhase === "waiting_block" && isGoalkeeper && (
            <KeeperGrid onBlock={handleBlock} disabled={publishing || !pendingCommitEventId} />
          )}
          {(actionPhase === "waiting_reveal" && isKicker) && (
            <div style={{ textAlign: "center", fontSize: 11, color: "var(--muted)", fontFamily: "var(--condensed)", padding: "8px 0" }}>
              {publishing ? "Revelando tu zona…" : "Preparando reveal…"}
            </div>
          )}
          {!myTurn && (
            <div style={{ textAlign: "center", fontSize: 11, color: "var(--muted)", fontFamily: "var(--condensed)", padding: "8px 0" }}>
              Esperando al rival…
            </div>
          )}
          {error && (
            <div style={{ textAlign: "center", fontSize: 10, color: "#f87171", fontFamily: "var(--condensed)", marginTop: 6 }}>
              {error}
            </div>
          )}
        </div>
      )}

      {/* Kick history dots */}
      {match.kicks.length > 0 && (
        <div style={{ padding: "6px 14px 10px", display: "flex", gap: 3, flexWrap: "wrap" }}>
          {match.kicks.map((k, i) => (
            <span
              key={i}
              title={k.timedOut ? "Timeout" : k.goal ? "Gol" : "Atajado"}
              style={{
                display: "inline-block", width: 9, height: 9, borderRadius: "50%",
                background: k.timedOut
                  ? "rgba(255,255,255,.1)"
                  : k.goal
                  ? "var(--gold)"
                  : "rgba(255,255,255,.18)",
                border: `1px solid ${k.timedOut ? "rgba(255,100,100,.35)" : "rgba(255,255,255,.15)"}`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
