import fs from "fs";
import path from "path";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { ALL_NUMBERS } from "../src/lib/catalog";
import { publish, issuerPubkey, now } from "./lib";

const TOURNAMENT_PATH = path.join(process.cwd(), "data", "tournament.json");
const MAX_PLAYERS   = 8;
const TOTAL_ROUNDS  = 10; // 5 kicks per player, alternating
export const ENTRY_SATS  = 5;
export const TIMEOUT_S   = 30 * 60; // 30 minutes per action

const TOURNEY_MATCH_KIND = 30305;

// ── Types ─────────────────────────────────────────────────────────────────────

export type TournamentStatus = "registering" | "group_stage" | "semi" | "final" | "finished" | "none";
export type Group = "A" | "B";

export interface Registration {
  pubkey: string;
  registeredAt: number;
  strength: number;
}

export interface InteractiveKick {
  round: number;
  kicker: string;
  goalkeeper: string;
  zone: number | null;   // null = timeout (counted as saved)
  col: number | null;
  goal: boolean;
  timedOut: boolean;
}

export interface TournamentMatch {
  id: string;
  phase: "group" | "semi" | "final";
  group?: Group;
  player1: string;
  player2: string;
  status: "pending" | "active" | "complete" | "timeout";
  matchCoord: string;              // "30305:issuer:tournamentId:matchId"
  kicks: InteractiveKick[];
  score1: number;
  score2: number;
  winner: string | null;
  completedAt: number | null;
  // Live kick state (not exposed to client in full, pendingCommitHash is private)
  currentRound: number;
  actionPhase: "waiting_commit" | "waiting_block" | "waiting_reveal" | null;
  currentKicker: string | null;
  currentGoalkeeper: string | null;
  lastActionAt: number | null;
  pendingCommitEventId: string | null;   // client needs this for BLOCK / REVEAL
  pendingCommitHash: string | null;      // server-only, validates REVEAL
  pendingBlockCol: number | null;        // server-only, resolves kick on REVEAL
}

export interface Standing {
  pubkey: string;
  pts: number; w: number; d: number; l: number;
  gf: number; ga: number; gd: number;
}

export interface Tournament {
  id: string;
  status: TournamentStatus;
  createdAt: number;
  maxPlayers: number;
  entrySats: number;
  prizePool: number;
  registrations: Registration[];
  groups: { A: string[]; B: string[] } | null;
  matches: TournamentMatch[];
  standings: { A: Standing[]; B: Standing[] } | null;
  champion: string | null;
}

// ── Persistence ───────────────────────────────────────────────────────────────

function readTournament(): Tournament | null {
  try {
    if (!fs.existsSync(TOURNAMENT_PATH)) return null;
    return JSON.parse(fs.readFileSync(TOURNAMENT_PATH, "utf-8")) as Tournament;
  } catch { return null; }
}

function writeTournament(t: Tournament): void {
  const dir = path.dirname(TOURNAMENT_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${TOURNAMENT_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(t, null, 2));
  fs.renameSync(tmp, TOURNAMENT_PATH);
}

function createFreshTournament(): Tournament {
  const t: Tournament = {
    id: Date.now().toString(36),
    status: "registering",
    createdAt: Math.floor(Date.now() / 1000),
    maxPlayers: MAX_PLAYERS,
    entrySats: ENTRY_SATS,
    prizePool: 0,
    registrations: [],
    groups: null,
    matches: [],
    standings: null,
    champion: null,
  };
  writeTournament(t);
  return t;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function viewTournament(): Tournament | null {
  return readTournament();
}

export function getTournament(): Tournament {
  const t = readTournament();
  if (!t) return createFreshTournament();
  if (t.status === "finished") return createFreshTournament();
  return t;
}

export function resetTournament(): Tournament {
  return createFreshTournament();
}

export function isRegistered(pubkey: string): boolean {
  const t = readTournament();
  return t?.registrations.some(r => r.pubkey === pubkey) ?? false;
}

export async function registerPlayer(pubkey: string, ownedUnique: number): Promise<{ ok: boolean; error?: string }> {
  const t = getTournament();
  if (t.status !== "registering") return { ok: false, error: "El torneo ya comenzó" };
  if (t.registrations.some(r => r.pubkey === pubkey)) return { ok: false, error: "Ya estás inscripto en este torneo" };
  if (t.registrations.length >= MAX_PLAYERS) return { ok: false, error: "El torneo está lleno" };

  const strength = Math.min(1, ownedUnique / ALL_NUMBERS.length);
  t.registrations.push({ pubkey, registeredAt: now(), strength });
  t.prizePool += ENTRY_SATS;

  if (t.registrations.length === MAX_PLAYERS) {
    writeTournament(t);
    await startTournament(t);
  } else {
    writeTournament(t);
  }

  console.log(`🏆 Torneo: ${pubkey.slice(0, 8)}… inscripto (${t.registrations.length}/${MAX_PLAYERS})`);
  return { ok: true };
}

// ── Match helpers ─────────────────────────────────────────────────────────────

function kickerOfRound(round: number, player1: string, player2: string): string {
  return round % 2 === 1 ? player1 : player2;
}
function goalkeeperOfRound(round: number, player1: string, player2: string): string {
  return round % 2 === 1 ? player2 : player1;
}

function makeMatch(id: string, phase: TournamentMatch["phase"], group: Group | undefined, player1: string, player2: string, tournamentId: string): TournamentMatch {
  const ISSUER = issuerPubkey();
  return {
    id, phase, group, player1, player2,
    status: "pending",
    matchCoord: `${TOURNEY_MATCH_KIND}:${ISSUER}:${tournamentId}:${id}`,
    kicks: [], score1: 0, score2: 0, winner: null, completedAt: null,
    currentRound: 1,
    actionPhase: "waiting_commit",
    currentKicker: player1,       // player1 kicks first (round 1, odd)
    currentGoalkeeper: player2,
    lastActionAt: null,
    pendingCommitEventId: null,
    pendingCommitHash: null,
    pendingBlockCol: null,
  };
}

async function publishMatchEvent(tournamentId: string, match: TournamentMatch): Promise<void> {
  const dTag = `${tournamentId}:${match.id}`;
  try {
    await publish({
      kind: TOURNEY_MATCH_KIND,
      created_at: now(),
      content: "",
      tags: [
        ["d", dTag],
        ["p", match.player1],
        ["p", match.player2],
        ["phase", match.phase],
        ...(match.group ? [["group", match.group]] : []),
        ["rounds", String(TOTAL_ROUNDS)],
        ["tourney", tournamentId],
      ],
    });
  } catch (e) {
    console.error(`⚠️ No se pudo publicar match ${match.id}:`, (e as Error).message);
  }
}

// ── Tournament start: interactive group stage ─────────────────────────────────

async function startTournament(t: Tournament): Promise<void> {
  const shuffled = [...t.registrations].sort(() => Math.random() - 0.5);
  const groupA = shuffled.slice(0, 4).map(r => r.pubkey);
  const groupB = shuffled.slice(4, 8).map(r => r.pubkey);
  t.groups = { A: groupA, B: groupB };
  t.status = "group_stage";
  t.matches = [];

  // Round-robin within each group: C(4,2) = 6 matches per group
  for (const [group, players] of [["A", groupA], ["B", groupB]] as [Group, string[]][]) {
    let idx = 0;
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const id = `g-${group}-${idx++}`;
        t.matches.push(makeMatch(id, "group", group, players[i], players[j], t.id));
      }
    }
  }

  writeTournament(t);

  // Publish TOURNEY_MATCH events for all group matches
  await Promise.allSettled(t.matches.map(m => publishMatchEvent(t.id, m)));
  console.log(`🏆 Torneo ${t.id}: fase de grupos iniciada (12 partidos)`);
}

// ── Commit / Block / Reveal handlers ─────────────────────────────────────────

function verifyCommit(zone: number, nonce: string, commit: string): boolean {
  try {
    const input = new TextEncoder().encode(`${zone}:${nonce}`);
    return bytesToHex(sha256(input)) === commit;
  } catch { return false; }
}

function findMatch(t: Tournament, matchCoord: string): TournamentMatch | null {
  return t.matches.find(m => m.matchCoord === matchCoord) ?? null;
}

export function processCommit(matchCoord: string, eventId: string, commitHash: string, kicker: string): { ok: boolean; error?: string } {
  const t = readTournament();
  if (!t) return { ok: false, error: "No hay torneo activo" };
  const match = findMatch(t, matchCoord);
  if (!match) return { ok: false, error: "Partido no encontrado" };
  if (match.status === "complete" || match.status === "timeout") return { ok: false, error: "Partido terminado" };
  if (match.actionPhase !== "waiting_commit") return { ok: false, error: "No es momento de commit" };
  if (match.currentKicker !== kicker) return { ok: false, error: "No es tu turno de patear" };

  match.status = "active";
  match.actionPhase = "waiting_block";
  match.pendingCommitEventId = eventId;
  match.pendingCommitHash = commitHash;
  match.lastActionAt = now();
  writeTournament(t);
  return { ok: true };
}

export function processBlock(matchCoord: string, commitId: string, col: number, goalkeeper: string): { ok: boolean; error?: string } {
  const t = readTournament();
  if (!t) return { ok: false, error: "No hay torneo activo" };
  const match = findMatch(t, matchCoord);
  if (!match) return { ok: false, error: "Partido no encontrado" };
  if (match.actionPhase !== "waiting_block") return { ok: false, error: "No es momento de atajar" };
  if (match.currentGoalkeeper !== goalkeeper) return { ok: false, error: "No es tu turno de atajar" };
  if (match.pendingCommitEventId !== commitId) return { ok: false, error: "Commit inválido" };

  match.actionPhase = "waiting_reveal";
  match.pendingBlockCol = col;
  match.lastActionAt = now();
  writeTournament(t);
  return { ok: true };
}

export async function processReveal(matchCoord: string, zone: number, nonce: string, kicker: string): Promise<{ ok: boolean; error?: string }> {
  const t = readTournament();
  if (!t) return { ok: false, error: "No hay torneo activo" };
  const match = findMatch(t, matchCoord);
  if (!match) return { ok: false, error: "Partido no encontrado" };
  if (match.actionPhase !== "waiting_reveal") return { ok: false, error: "No es momento de revelar" };
  if (match.currentKicker !== kicker) return { ok: false, error: "No sos el pateador" };
  if (match.pendingCommitHash === null || match.pendingBlockCol === null) return { ok: false, error: "Estado inconsistente" };

  if (!verifyCommit(zone, nonce, match.pendingCommitHash)) {
    // Cheat: kick counts as saved
    console.log(`⚠️ Reveal inválido en ${match.id} ronda ${match.currentRound} (cheat o error)`);
    zone = -1; // invalid zone → saved
  }

  const col = match.pendingBlockCol;
  const goal = zone >= 0 && zone !== col; // left/center/right simple match
  const kick: InteractiveKick = {
    round: match.currentRound,
    kicker: match.currentKicker!,
    goalkeeper: match.currentGoalkeeper!,
    zone: zone >= 0 ? zone : null,
    col,
    goal,
    timedOut: false,
  };
  match.kicks.push(kick);
  if (kick.kicker === match.player1) match.score1 += goal ? 1 : 0;
  else match.score2 += goal ? 1 : 0;

  match.lastActionAt = now();
  match.pendingCommitEventId = null;
  match.pendingCommitHash = null;
  match.pendingBlockCol = null;

  advanceMatchRound(match);
  writeTournament(t);

  if (match.status === "complete" || match.status === "timeout") {
    await checkPhaseComplete(t);
  }

  return { ok: true };
}

function advanceMatchRound(match: TournamentMatch): void {
  const round = match.currentRound;
  const { score1, score2 } = match;

  // After round 10 with different scores → done
  if (round === TOTAL_ROUNDS && score1 !== score2) {
    match.status = "complete";
    match.winner = score1 > score2 ? match.player1 : match.player2;
    match.actionPhase = null;
    match.completedAt = now();
    return;
  }

  // After each even round in sudden death → check
  if (round > TOTAL_ROUNDS && round % 2 === 0 && score1 !== score2) {
    match.status = "complete";
    match.winner = score1 > score2 ? match.player1 : match.player2;
    match.actionPhase = null;
    match.completedAt = now();
    return;
  }

  // Continue to next round
  const next = round + 1;
  match.currentRound = next;
  match.currentKicker = kickerOfRound(next, match.player1, match.player2);
  match.currentGoalkeeper = goalkeeperOfRound(next, match.player1, match.player2);
  match.actionPhase = "waiting_commit";
}

// ── Timeout enforcement (call every 60s) ──────────────────────────────────────

export async function timeoutStaleMatches(): Promise<void> {
  const t = readTournament();
  if (!t || t.status === "registering" || t.status === "finished") return;

  let changed = false;
  const deadline = now() - TIMEOUT_S;

  for (const match of t.matches) {
    if (match.status !== "active" && match.status !== "pending") continue;
    // "pending" with no action yet: start countdown only once someone has acted
    if (match.status === "pending") continue;
    if (match.lastActionAt === null || match.lastActionAt > deadline) continue;

    // Timeout: current kicker forfeits remaining kicks (counted as saves)
    console.log(`⏰ Timeout en ${match.id} ronda ${match.currentRound} — forfeit de ${match.currentKicker?.slice(0, 8)}`);
    while (match.actionPhase !== null) {
      const kick: InteractiveKick = {
        round: match.currentRound,
        kicker: match.currentKicker!,
        goalkeeper: match.currentGoalkeeper!,
        zone: null, col: null, goal: false, timedOut: true,
      };
      match.kicks.push(kick);
      advanceMatchRound(match);
      if (match.status === "complete") break;
      // Only timeout one kick per check; the other player can then act
      // Actually, timeout all remaining for the forfeited player's turn
      // to keep the match moving. We stop after 1 kick then let normal flow resume.
      break;
    }
    changed = true;
  }

  if (changed) {
    writeTournament(t);
    for (const match of t.matches) {
      if (match.status === "complete") await checkPhaseComplete(t);
    }
  }
}

// ── Phase advancement ─────────────────────────────────────────────────────────

function computeStandings(players: string[], matches: TournamentMatch[]): Standing[] {
  const map = new Map<string, Standing>(
    players.map(p => [p, { pubkey: p, pts: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0 }])
  );
  for (const m of matches) {
    if (m.status !== "complete" && m.status !== "timeout") continue;
    const s1 = map.get(m.player1)!;
    const s2 = map.get(m.player2)!;
    s1.gf += m.score1; s1.ga += m.score2; s1.gd = s1.gf - s1.ga;
    s2.gf += m.score2; s2.ga += m.score1; s2.gd = s2.gf - s2.ga;
    if (m.score1 > m.score2) { s1.pts += 3; s1.w++; s2.l++; }
    else if (m.score1 < m.score2) { s2.pts += 3; s2.w++; s1.l++; }
    else { s1.pts++; s2.pts++; s1.d++; s2.d++; }
  }
  return [...map.values()].sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
}

async function checkPhaseComplete(t: Tournament): Promise<void> {
  const done = (m: TournamentMatch) => m.status === "complete" || m.status === "timeout";

  if (t.status === "group_stage") {
    const gm = t.matches.filter(m => m.phase === "group");
    if (!gm.every(done)) return;

    const standA = computeStandings(t.groups!.A, gm.filter(m => m.group === "A"));
    const standB = computeStandings(t.groups!.B, gm.filter(m => m.group === "B"));
    t.standings = { A: standA, B: standB };

    const [a1, a2] = standA.map(s => s.pubkey);
    const [b1, b2] = standB.map(s => s.pubkey);
    const semi1 = makeMatch("semi1", "semi", undefined, a1, b2, t.id);
    const semi2 = makeMatch("semi2", "semi", undefined, b1, a2, t.id);
    t.matches.push(semi1, semi2);
    t.status = "semi";
    writeTournament(t);
    await Promise.allSettled([publishMatchEvent(t.id, semi1), publishMatchEvent(t.id, semi2)]);
    console.log("🏆 Fase de grupos terminada → semifinales creadas");

  } else if (t.status === "semi") {
    const sm = t.matches.filter(m => m.phase === "semi");
    if (!sm.every(done)) return;

    const semi1 = sm.find(m => m.id === "semi1")!;
    const semi2 = sm.find(m => m.id === "semi2")!;
    const finalMatch = makeMatch("final", "final", undefined, semi1.winner!, semi2.winner!, t.id);
    t.matches.push(finalMatch);
    t.status = "final";
    writeTournament(t);
    await publishMatchEvent(t.id, finalMatch);
    console.log("🏆 Semifinales terminadas → final creada");

  } else if (t.status === "final") {
    const fm = t.matches.find(m => m.phase === "final");
    if (!fm || !done(fm)) return;
    t.champion = fm.winner;
    t.status = "finished";
    writeTournament(t);
    console.log(`🏆 Torneo terminado. Campeón: ${t.champion?.slice(0, 8)}…`);
  }
}
