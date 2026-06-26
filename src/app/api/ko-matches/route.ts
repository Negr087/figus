import { NextResponse } from "next/server";

const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY;
const API_URL = "https://api.football-data.org/v4/competitions/WC/matches";

// football-data.org conoce la estructura fija del cruce (fechas y stage) desde
// el día 1, y rellena homeTeam/awayTeam con el equipo real en cuanto se decide
// oficialmente — no hace falta calcular nosotros la tabla de "mejores terceros".
const STAGE_TO_ROUND: Record<string, string> = {
  LAST_32: "r32",
  LAST_16: "r16",
  ROUND_OF_16: "r16",
  QUARTER_FINALS: "qf",
  SEMI_FINALS: "sf",
  THIRD_PLACE: "3rd",
  FINAL: "final",
};

export interface KoTeam { tla: string; name: string }
export interface KoApiMatch {
  round: string;
  utcDate: string;
  home: KoTeam | null;
  away: KoTeam | null;
}
export interface KoMatchesData {
  matches: KoApiMatch[];
  fetchedAt: number;
}

// Cache en memoria: evita golpear la API en cada request
let cache: { data: KoMatchesData; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

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
      if (cache) return NextResponse.json(cache.data);
      return NextResponse.json({ error: `API error ${res.status}` }, { status: 502 });
    }

    const raw = await res.json() as {
      matches: Array<{
        stage: string;
        utcDate: string;
        homeTeam: { tla: string | null; name: string } | null;
        awayTeam: { tla: string | null; name: string } | null;
      }>;
    };

    const matches: KoApiMatch[] = [];
    for (const m of raw.matches) {
      const round = STAGE_TO_ROUND[m.stage];
      if (!round) continue; // GROUP_STAGE u otro stage que no manejamos
      matches.push({
        round,
        utcDate: m.utcDate,
        home: m.homeTeam?.tla ? { tla: m.homeTeam.tla.toLowerCase(), name: m.homeTeam.name } : null,
        away: m.awayTeam?.tla ? { tla: m.awayTeam.tla.toLowerCase(), name: m.awayTeam.name } : null,
      });
    }
    matches.sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime());

    const data: KoMatchesData = { matches, fetchedAt: now };
    cache = { data, expiresAt: now + CACHE_TTL_MS };

    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=60" },
    });
  } catch {
    if (cache) return NextResponse.json(cache.data);
    return NextResponse.json({ error: "Failed to fetch matches" }, { status: 502 });
  }
}
