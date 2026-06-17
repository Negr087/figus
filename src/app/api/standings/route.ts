import { NextResponse } from "next/server";

const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY;
const API_URL = "https://api.football-data.org/v4/competitions/WC/standings";

export interface TeamStanding {
  tla: string;
  played: number;
  won: number;
  draw: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
}

export interface StandingsData {
  groups: Record<string, TeamStanding[]>;
  fetchedAt: number;
}

// In-memory cache: avoids hammering the API on every request
let cache: { data: StandingsData; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function GET() {
  if (!FOOTBALL_API_KEY) {
    return NextResponse.json({ error: "FOOTBALL_API_KEY not configured" }, { status: 503 });
  }

  const now = Date.now();
  if (cache && now < cache.expiresAt) {
    return NextResponse.json(cache.data, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=60" },
    });
  }

  try {
    const res = await fetch(API_URL, {
      headers: { "X-Auth-Token": FOOTBALL_API_KEY },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      if (cache) return NextResponse.json(cache.data); // serve stale on error
      return NextResponse.json({ error: `API error ${res.status}` }, { status: 502 });
    }

    const raw = await res.json() as {
      standings: Array<{
        group: string;
        table: Array<{
          team: { tla: string };
          playedGames: number;
          won: number;
          draw: number;
          lost: number;
          goalsFor: number;
          goalsAgainst: number;
          goalDifference: number;
          points: number;
        }>;
      }>;
    };

    const groups: Record<string, TeamStanding[]> = {};
    for (const sg of raw.standings) {
      const letter = sg.group.replace("Group ", "");
      groups[letter] = sg.table.map(row => ({
        tla: row.team.tla.toLowerCase(),
        played: row.playedGames,
        won: row.won,
        draw: row.draw,
        lost: row.lost,
        gf: row.goalsFor,
        ga: row.goalsAgainst,
        gd: row.goalDifference,
        points: row.points,
      }));
    }

    const data: StandingsData = { groups, fetchedAt: now };
    cache = { data, expiresAt: now + CACHE_TTL_MS };

    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=60" },
    });
  } catch {
    if (cache) return NextResponse.json(cache.data);
    return NextResponse.json({ error: "Failed to fetch standings" }, { status: 502 });
  }
}
