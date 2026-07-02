import { NextResponse } from "next/server";

const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY;
const API_URL = "https://api.football-data.org/v4/competitions/WC/matches";

// football-data.org conoce la estructura fija del cruce (fechas y stage) desde
// el día 1, y rellena homeTeam/awayTeam con el equipo real en cuanto se decide
// oficialmente — no hace falta calcular nosotros la tabla de "mejores terceros".
// football-data.org usa distintos nombres de stage según el torneo.
// Para el WC 2026 (48 equipos, primera vez) todavía no está claro qué
// nombre van a usar para la nueva ronda de 32 — cubrimos las variantes
// más probables para no descartar partidos silenciosamente.
const STAGE_TO_ROUND: Record<string, string> = {
  // Round of 32 (nueva ronda del WC 2026)
  LAST_32:      "r32",
  ROUND_OF_32:  "r32",
  // Round of 16 / Octavos
  LAST_16:      "r16",
  ROUND_OF_16:  "r16",
  // Resto
  QUARTER_FINALS: "qf",
  SEMI_FINALS:    "sf",
  THIRD_PLACE:    "3rd",
  FINAL:          "final",
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

    // Diagnóstico: loguear todos los stages que devuelve la API para detectar
    // si hay alguno que no está en STAGE_TO_ROUND (causaría que esos partidos
    // se descarten en silencio y no aparezcan equipos en el fixture).
    const stageCounts = new Map<string, number>();
    for (const m of raw.matches) {
      stageCounts.set(m.stage, (stageCounts.get(m.stage) ?? 0) + 1);
    }
    const unknown = [...stageCounts.keys()].filter((s) => !STAGE_TO_ROUND[s]);
    console.log(
      "[ko-matches] stages recibidos:",
      Object.fromEntries(stageCounts),
      unknown.length ? `⚠️ DESCONOCIDOS: ${unknown.join(", ")}` : "✓ todos mapeados"
    );

    const matches: KoApiMatch[] = [];
    for (const m of raw.matches) {
      const round = STAGE_TO_ROUND[m.stage];
      if (!round) continue;
      // Algunos equipos en football-data.org tienen tla=null aunque el nombre
      // ya está definido. Si hay nombre pero no TLA, intentamos derivar el TLA
      // del nombre buscando en nuestros alias o usando un slug de 3 letras.
      const resolveTeam = (
        t: { tla: string | null; name: string } | null
      ): KoTeam | null => {
        if (!t) return null;
        if (t.tla) return { tla: t.tla.toLowerCase(), name: t.name };
        // tla null pero el nombre sí está: loguear para detectar el problema
        console.log(`[ko-matches] tla null para "${t.name}" en ${m.stage} ${m.utcDate}`);
        return null;
      };
      matches.push({
        round,
        utcDate: m.utcDate,
        home: resolveTeam(m.homeTeam),
        away: resolveTeam(m.awayTeam),
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
