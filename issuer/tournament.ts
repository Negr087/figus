import fs from "fs";
import path from "path";
import { ALL_NUMBERS } from "../src/lib/catalog";

const TOURNAMENT_PATH = path.join(process.cwd(), "data", "tournament.json");
const MAX_PLAYERS = 8;
export const ENTRY_SATS = 5;

// ── Types ─────────────────────────────────────────────────────────────────────

export type TournamentStatus = "registering" | "group_stage" | "finished";
export type Group = "A" | "B";

export interface Registration {
  pubkey: string;
  registeredAt: number;
  strength: number; // 0–1: owned unique stickers / total stickers
}

export interface KickResult {
  player: 1 | 2;
  goal: boolean;
}

export interface Match {
  id: string;
  phase: "group" | "semi" | "final";
  group?: Group;
  player1: string; // pubkey
  player2: string; // pubkey
  kicks: KickResult[];
  score1: number;
  score2: number;
  winner: string; // pubkey
}

export interface Standing {
  pubkey: string;
  pts: number;
  w: number;
  d: number;
  l: number;
  gf: number; // goals for
  ga: number; // goals against
  gd: number; // goal difference
}

export interface Tournament {
  id: string;
  status: TournamentStatus;
  createdAt: number;
  maxPlayers: number;
  entrySats: number;
  prizePool: number; // sats accumulated from registrations
  registrations: Registration[];
  groups: { A: string[]; B: string[] } | null;
  matches: Match[];
  standings: { A: Standing[]; B: Standing[] } | null;
  semi1: Match | null;
  semi2: Match | null;
  final: Match | null;
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
    semi1: null,
    semi2: null,
    final: null,
    champion: null,
  };
  writeTournament(t);
  return t;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function resetTournament(): Tournament {
  return createFreshTournament();
}

export function getTournament(): Tournament {
  const t = readTournament();
  if (!t) return createFreshTournament();
  // Auto-create new tournament if previous finished
  if (t.status === "finished") return createFreshTournament();
  return t;
}

export function isRegistered(pubkey: string): boolean {
  const t = readTournament();
  return t?.registrations.some(r => r.pubkey === pubkey) ?? false;
}

export function registerPlayer(pubkey: string, ownedUnique: number): { ok: boolean; error?: string } {
  const t = getTournament();

  if (t.status !== "registering") return { ok: false, error: "El torneo ya comenzó" };
  if (t.registrations.some(r => r.pubkey === pubkey)) return { ok: false, error: "Ya estás inscripto" };
  if (t.registrations.length >= MAX_PLAYERS) return { ok: false, error: "El torneo está lleno" };

  const strength = Math.min(1, ownedUnique / ALL_NUMBERS.length);
  t.registrations.push({ pubkey, registeredAt: Math.floor(Date.now() / 1000), strength });
  t.prizePool += ENTRY_SATS;

  if (t.registrations.length === MAX_PLAYERS) {
    simulateTournament(t);
  } else {
    writeTournament(t);
  }

  console.log(`🏆 Torneo: ${pubkey.slice(0, 8)}… inscripto (${t.registrations.length}/${MAX_PLAYERS})`);
  return { ok: true };
}

// ── Simulation ────────────────────────────────────────────────────────────────

function simulateMatch(
  p1: string, s1: number,
  p2: string, s2: number,
  phase: Match["phase"],
  id: string,
  group?: Group,
): Match {
  const kicks: KickResult[] = [];
  let score1 = 0, score2 = 0;

  // 5 kicks each, alternating
  for (let i = 0; i < 5; i++) {
    const g1 = Math.random() < (0.40 + s1 * 0.40);
    kicks.push({ player: 1, goal: g1 });
    if (g1) score1++;

    const g2 = Math.random() < (0.40 + s2 * 0.40);
    kicks.push({ player: 2, goal: g2 });
    if (g2) score2++;
  }

  // Golden kick if tied: 50/50, p1 goes first
  if (score1 === score2) {
    const g1 = Math.random() < 0.5;
    kicks.push({ player: 1, goal: g1 });
    if (g1) {
      score1++;
    } else {
      kicks.push({ player: 2, goal: true });
      score2++;
    }
  }

  return {
    id,
    phase,
    group,
    player1: p1,
    player2: p2,
    kicks,
    score1,
    score2,
    winner: score1 > score2 ? p1 : p2,
  };
}

function computeStandings(players: string[], matches: Match[]): Standing[] {
  const map = new Map<string, Standing>(
    players.map(p => [p, { pubkey: p, pts: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0 }])
  );

  for (const m of matches) {
    const s1 = map.get(m.player1)!;
    const s2 = map.get(m.player2)!;
    s1.gf += m.score1; s1.ga += m.score2; s1.gd = s1.gf - s1.ga;
    s2.gf += m.score2; s2.ga += m.score1; s2.gd = s2.gf - s2.ga;
    if (m.score1 > m.score2) { s1.pts += 3; s1.w++; s2.l++; }
    else if (m.score1 < m.score2) { s2.pts += 3; s2.w++; s1.l++; }
    else { s1.pts += 1; s2.pts += 1; s1.d++; s2.d++; }
  }

  return [...map.values()].sort((a, b) =>
    b.pts - a.pts || b.gd - a.gd || b.gf - a.gf
  );
}

function simulateTournament(t: Tournament): void {
  t.status = "group_stage";

  // Shuffle and assign groups
  const shuffled = [...t.registrations].sort(() => Math.random() - 0.5);
  const groupA = shuffled.slice(0, 4).map(r => r.pubkey);
  const groupB = shuffled.slice(4, 8).map(r => r.pubkey);
  t.groups = { A: groupA, B: groupB };

  const strengthOf = (pubkey: string) =>
    t.registrations.find(r => r.pubkey === pubkey)?.strength ?? 0;

  // Round-robin within each group (C(4,2) = 6 matches per group)
  const groupMatches: Match[] = [];
  for (const [group, players] of [["A", groupA], ["B", groupB]] as [Group, string[]][]) {
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const p1 = players[i], p2 = players[j];
        groupMatches.push(simulateMatch(
          p1, strengthOf(p1), p2, strengthOf(p2),
          "group", `${group}-${i}${j}`, group,
        ));
      }
    }
  }
  t.matches = groupMatches;

  // Standings
  const standA = computeStandings(groupA, groupMatches.filter(m => m.group === "A"));
  const standB = computeStandings(groupB, groupMatches.filter(m => m.group === "B"));
  t.standings = { A: standA, B: standB };

  // Qualifiers: top 2 from each group
  const [a1, a2] = standA.map(s => s.pubkey);
  const [b1, b2] = standB.map(s => s.pubkey);

  // Semis: A1 vs B2, B1 vs A2
  t.semi1 = simulateMatch(a1, strengthOf(a1), b2, strengthOf(b2), "semi", "semi1");
  t.semi2 = simulateMatch(b1, strengthOf(b1), a2, strengthOf(a2), "semi", "semi2");

  // Final
  t.final = simulateMatch(
    t.semi1.winner, strengthOf(t.semi1.winner),
    t.semi2.winner, strengthOf(t.semi2.winner),
    "final", "final",
  );

  t.champion = t.final.winner;
  t.status = "finished";

  writeTournament(t);
  console.log(`🏆 Torneo simulado. Campeón: ${t.champion?.slice(0, 8)}…`);
}
