"use client";

import { useEffect, useState, useRef } from "react";
import { TEAMS, TEAM_GROUPS, PAGES, teamName } from "@/lib/catalog";
import { Flag } from "./Flag";
import { useLang } from "@/contexts/LangContext";
import { usePronosticos } from "@/hooks/usePronosticos";
import { BetPanel } from "./BetPanel";
import type { Identity } from "@/lib/identity";
import type { TeamStanding, StandingsData } from "@/app/api/standings/route";
import type { KoApiMatch, KoMatchesData } from "@/app/api/ko-matches/route";

// ─── Groups order ─────────────────────────────────────────────────────────────
const GROUPS_ORDER = ["A","B","C","D","E","F","G","H","I","J","K","L"];

const GROUP_TEAMS: Record<string, string[]> = {};
PAGES.forEach((p) => {
  if (p.id === "fwc") return;
  const g = TEAM_GROUPS[p.id];
  if (g) {
    if (!GROUP_TEAMS[g]) GROUP_TEAMS[g] = [];
    GROUP_TEAMS[g].push(p.id);
  }
});

const MD_PAIRS = [
  [[0,1],[2,3]],
  [[0,2],[1,3]],
  [[0,3],[1,2]],
] as const;

// ─── Group stage schedule (FIFA WC 2026 official) ────────────────────────────
type ScheduleInfo = { date: string; utc: string; art: string; simultaneous: boolean };

/** [date, artHour, artMinute] por (group, matchday, matchIdx) — horarios ART */
const SCHEDULE_TABLE: Record<string, Array<{ date: string; artH: number; artM: number }>> = {
  // ── Matchday 1 ──
  "A:0": [{ date: "11 jun", artH: 16, artM: 0 }, { date: "11 jun", artH: 23, artM: 0 }],
  "B:0": [{ date: "12 jun", artH: 16, artM: 0 }, { date: "13 jun", artH: 16, artM: 0 }],
  "C:0": [{ date: "13 jun", artH: 19, artM: 0 }, { date: "13 jun", artH: 22, artM: 0 }],
  "D:0": [{ date: "12 jun", artH: 22, artM: 0 }, { date: "14 jun", artH:  1, artM: 0 }],
  "E:0": [{ date: "14 jun", artH: 14, artM: 0 }, { date: "14 jun", artH: 20, artM: 0 }],
  "F:0": [{ date: "14 jun", artH: 17, artM: 0 }, { date: "14 jun", artH: 23, artM: 0 }],
  "G:0": [{ date: "15 jun", artH: 16, artM: 0 }, { date: "15 jun", artH: 22, artM: 0 }],
  "H:0": [{ date: "15 jun", artH: 13, artM: 0 }, { date: "15 jun", artH: 19, artM: 0 }],
  "I:0": [{ date: "16 jun", artH: 16, artM: 0 }, { date: "16 jun", artH: 19, artM: 0 }],
  "J:0": [{ date: "16 jun", artH: 22, artM: 0 }, { date: "17 jun", artH:  1, artM: 0 }],
  "K:0": [{ date: "17 jun", artH: 14, artM: 0 }, { date: "17 jun", artH: 23, artM: 0 }],
  "L:0": [{ date: "17 jun", artH: 17, artM: 0 }, { date: "17 jun", artH: 20, artM: 0 }],
  // ── Matchday 2 ──
  "A:1": [{ date: "18 jun", artH: 13, artM: 0 }, { date: "18 jun", artH: 22, artM: 0 }],
  "B:1": [{ date: "18 jun", artH: 16, artM: 0 }, { date: "18 jun", artH: 19, artM: 0 }],
  "C:1": [{ date: "19 jun", artH: 19, artM: 0 }, { date: "19 jun", artH: 21, artM: 30 }],
  "D:1": [{ date: "19 jun", artH: 16, artM: 0 }, { date: "20 jun", artH:  0, artM: 0 }],
  "E:1": [{ date: "20 jun", artH: 17, artM: 0 }, { date: "20 jun", artH: 21, artM: 0 }],
  "F:1": [{ date: "20 jun", artH: 14, artM: 0 }, { date: "21 jun", artH:  1, artM: 0 }],
  "G:1": [{ date: "21 jun", artH: 16, artM: 0 }, { date: "21 jun", artH: 22, artM: 0 }],
  "H:1": [{ date: "21 jun", artH: 13, artM: 0 }, { date: "21 jun", artH: 19, artM: 0 }],
  "I:1": [{ date: "22 jun", artH: 18, artM: 0 }, { date: "22 jun", artH: 21, artM: 0 }],
  "J:1": [{ date: "22 jun", artH: 14, artM: 0 }, { date: "23 jun", artH:  0, artM: 0 }],
  "K:1": [{ date: "23 jun", artH: 14, artM: 0 }, { date: "23 jun", artH: 23, artM: 0 }],
  "L:1": [{ date: "23 jun", artH: 17, artM: 0 }, { date: "23 jun", artH: 20, artM: 0 }],
  // ── Matchday 3 (simultáneos) ──
  "A:2": [{ date: "24 jun", artH: 22, artM: 0 }, { date: "24 jun", artH: 22, artM: 0 }],
  "B:2": [{ date: "24 jun", artH: 16, artM: 0 }, { date: "24 jun", artH: 16, artM: 0 }],
  "C:2": [{ date: "24 jun", artH: 19, artM: 0 }, { date: "24 jun", artH: 19, artM: 0 }],
  "D:2": [{ date: "25 jun", artH: 23, artM: 0 }, { date: "25 jun", artH: 23, artM: 0 }],
  "E:2": [{ date: "25 jun", artH: 17, artM: 0 }, { date: "25 jun", artH: 17, artM: 0 }],
  "F:2": [{ date: "25 jun", artH: 20, artM: 0 }, { date: "25 jun", artH: 20, artM: 0 }],
  "G:2": [{ date: "27 jun", artH:  0, artM: 0 }, { date: "27 jun", artH:  0, artM: 0 }],
  "H:2": [{ date: "26 jun", artH: 21, artM: 0 }, { date: "26 jun", artH: 21, artM: 0 }],
  "I:2": [{ date: "26 jun", artH: 16, artM: 0 }, { date: "26 jun", artH: 16, artM: 0 }],
  "J:2": [{ date: "27 jun", artH: 23, artM: 0 }, { date: "27 jun", artH: 23, artM: 0 }],
  "K:2": [{ date: "27 jun", artH: 20, artM: 30 }, { date: "27 jun", artH: 20, artM: 30 }],
  "L:2": [{ date: "27 jun", artH: 18, artM: 0 }, { date: "27 jun", artH: 18, artM: 0 }],
};

const KO_MONTHS_ES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

// Convierte un utcDate ISO (de football-data.org) a fecha/hora ART, sin
// depender de la zona horaria del navegador/servidor que ejecuta el cálculo
// (aritmética sobre el timestamp + accessors UTC del resultado desplazado).
function utcIsoToArt(utcDateIso: string): { date: string; artH: number } {
  const artMs = new Date(utcDateIso).getTime() - 3 * 3600 * 1000; // ART = UTC-3
  const art = new Date(artMs);
  return { date: `${art.getUTCDate()} ${KO_MONTHS_ES[art.getUTCMonth()]}`, artH: art.getUTCHours() };
}

function getSchedule(group: string, mdIdx: number, matchIdx: number): ScheduleInfo {
  const entries = SCHEDULE_TABLE[`${group}:${mdIdx}`];
  if (!entries?.[matchIdx]) return { date: "—", utc: "—", art: "—", simultaneous: false };
  const { date, artH, artM } = entries[matchIdx];
  const mm = String(artM).padStart(2, "0");
  const art = `${String(artH).padStart(2, "0")}:${mm}`;
  let utcH = artH + 3; if (utcH >= 24) utcH -= 24;
  const utc = `${String(utcH).padStart(2, "0")}:${mm}`;
  const simultaneous = entries.length === 2
    && entries[0].artH === entries[1].artH && entries[0].artM === entries[1].artM;
  return { date, utc, art, simultaneous };
}

// ─── Venues (group stage) ─────────────────────────────────────────────────────
const VENUES: Record<string, string> = {
  A: "Estadio Azteca · CDMX / Estadio BBVA · Monterrey",
  B: "BC Place · Vancouver / AT&T Stadium · Dallas",
  C: "Levi's Stadium · San José / MetLife Stadium · NJ",
  D: "SoFi Stadium · Los Ángeles / Arrowhead · Kansas City",
  E: "Estadio Akron · Guadalajara / Gillette Stadium · Boston",
  F: "Lincoln Financial · Filadelfia / BMO Field · Toronto",
  G: "Rose Bowl · Los Ángeles / Mercedes-Benz · Atlanta",
  H: "Estadio Azteca · CDMX / Lumen Field · Seattle",
  I: "MetLife Stadium · NJ / AT&T Stadium · Dallas",
  J: "Estadio BBVA · Monterrey / SoFi Stadium · Los Ángeles",
  K: "BC Place · Vancouver / Levi's Stadium · San José",
  L: "Estadio Akron · Guadalajara / Lincoln Financial · Filadelfia",
};

// ─── Knockout bracket data ────────────────────────────────────────────────────
type KoMatch = {
  id: string;
  home: string;
  away: string;
  date: string;
  utcH: number;
  venue?: string;
  isFinal?: boolean;
  note?: string;
};

type KoRound = {
  id: string;
  matches: KoMatch[];
};

const KO_ROUNDS: KoRound[] = [
  {
    id: "r32",
    matches: [
      // Jul 3 — grupos A/B
      { id: "ko-r32-01", home: "1° A", away: "2° B", date: "3 jul", utcH: 14 },
      { id: "ko-r32-02", home: "1° B", away: "2° A", date: "3 jul", utcH: 17 },
      { id: "ko-r32-03", home: "1° C", away: "2° D", date: "3 jul", utcH: 20 },
      { id: "ko-r32-04", home: "1° D", away: "2° C", date: "3 jul", utcH: 23 },
      // Jul 4 — grupos E/F
      { id: "ko-r32-05", home: "1° E", away: "2° F", date: "4 jul", utcH: 14 },
      { id: "ko-r32-06", home: "1° F", away: "2° E", date: "4 jul", utcH: 17 },
      { id: "ko-r32-07", home: "1° G", away: "2° H", date: "4 jul", utcH: 20 },
      { id: "ko-r32-08", home: "1° H", away: "2° G", date: "4 jul", utcH: 23 },
      // Jul 5 — grupos I/J/K/L
      { id: "ko-r32-09", home: "1° I", away: "2° J", date: "5 jul", utcH: 14 },
      { id: "ko-r32-10", home: "1° J", away: "2° I", date: "5 jul", utcH: 17 },
      { id: "ko-r32-11", home: "1° K", away: "2° L", date: "5 jul", utcH: 20 },
      { id: "ko-r32-12", home: "1° L", away: "2° K", date: "5 jul", utcH: 23 },
      // Jul 6 — 8 mejores terceros
      { id: "ko-r32-13", home: "Mejor 3°*", away: "Mejor 3°*", date: "6 jul", utcH: 14, note: "Posiciones TBD según tabla de terceros" },
      { id: "ko-r32-14", home: "Mejor 3°*", away: "Mejor 3°*", date: "6 jul", utcH: 17, note: "Posiciones TBD según tabla de terceros" },
      { id: "ko-r32-15", home: "Mejor 3°*", away: "Mejor 3°*", date: "6 jul", utcH: 20, note: "Posiciones TBD según tabla de terceros" },
      { id: "ko-r32-16", home: "Mejor 3°*", away: "Mejor 3°*", date: "6 jul", utcH: 23, note: "Posiciones TBD según tabla de terceros" },
    ],
  },
  {
    id: "r16",
    matches: [
      // Jul 8
      { id: "ko-r16-01", home: "W P01", away: "W P02", date: "8 jul", utcH: 14 },
      { id: "ko-r16-02", home: "W P03", away: "W P04", date: "8 jul", utcH: 18 },
      { id: "ko-r16-03", home: "W P13", away: "W P14", date: "8 jul", utcH: 22 },
      // Jul 9
      { id: "ko-r16-04", home: "W P05", away: "W P06", date: "9 jul", utcH: 14 },
      { id: "ko-r16-05", home: "W P07", away: "W P08", date: "9 jul", utcH: 18 },
      { id: "ko-r16-06", home: "W P15", away: "W P16", date: "9 jul", utcH: 22 },
      // Jul 10
      { id: "ko-r16-07", home: "W P09", away: "W P10", date: "10 jul", utcH: 16 },
      { id: "ko-r16-08", home: "W P11", away: "W P12", date: "10 jul", utcH: 20 },
    ],
  },
  {
    id: "qf",
    matches: [
      { id: "ko-qf-01", home: "W O1", away: "W O2", date: "12 jul", utcH: 16 },
      { id: "ko-qf-02", home: "W O3", away: "W O4", date: "12 jul", utcH: 20 },
      { id: "ko-qf-03", home: "W O5", away: "W O6", date: "13 jul", utcH: 16 },
      { id: "ko-qf-04", home: "W O7", away: "W O8", date: "13 jul", utcH: 20 },
    ],
  },
  {
    id: "sf",
    matches: [
      { id: "ko-sf-01", home: "W C1", away: "W C2", date: "15 jul", utcH: 20 },
      { id: "ko-sf-02", home: "W C3", away: "W C4", date: "16 jul", utcH: 20 },
    ],
  },
  {
    id: "3rd",
    matches: [
      { id: "ko-3rd", home: "Perd. SF1", away: "Perd. SF2", date: "18 jul", utcH: 16, venue: "Estadio Azteca · CDMX" },
    ],
  },
  {
    id: "final",
    matches: [
      { id: "ko-final", home: "W SF1", away: "W SF2", date: "19 jul", utcH: 20, venue: "MetLife Stadium · Nueva York/NJ", isFinal: true },
    ],
  },
];

// ─── Standings hook ───────────────────────────────────────────────────────────
function useStandings() {
  const [standings, setStandings] = useState<StandingsData | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch_ = () => {
    fetch("/api/standings")
      .then(r => r.ok ? r.json() : null)
      .then((d: StandingsData | null) => { if (d) setStandings(d); })
      .catch(() => {});
  };

  useEffect(() => {
    fetch_();
    timerRef.current = setInterval(fetch_, 5 * 60 * 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  return standings;
}

// ─── Knockout matches hook (equipos reales una vez confirmados) ──────────────
function useKoMatches() {
  const [koMatches, setKoMatches] = useState<KoApiMatch[] | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch_ = () => {
    fetch("/api/ko-matches")
      .then(r => r.ok ? r.json() : null)
      .then((d: KoMatchesData | null) => { if (d) setKoMatches(d.matches); })
      .catch(() => {});
  };

  useEffect(() => {
    fetch_();
    timerRef.current = setInterval(fetch_, 5 * 60 * 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  return koMatches;
}

// ─── Group standings table ────────────────────────────────────────────────────
function GroupStandingsTable({ rows, lang }: { rows: TeamStanding[]; lang: string }) {
  const medals = ["🥇", "🥈", "3°", "4°"];
  return (
    <div style={{
      background: "var(--panel)",
      border: "1px solid var(--line)",
      borderRadius: 12,
      overflow: "hidden",
      marginBottom: 14,
    }}>
      {/* Header row */}
      <div style={{
        padding: "7px 14px",
        background: "var(--panel2)",
        borderBottom: "1px solid var(--line)",
        display: "grid",
        gridTemplateColumns: "20px 1fr 28px 24px 24px 24px 28px 28px 28px 32px",
        gap: "0 4px",
        fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 9,
        letterSpacing: 1, color: "var(--muted)", alignItems: "center",
      }}>
        <span>#</span>
        <span>EQUIPO</span>
        <span style={{ textAlign: "center" }}>PJ</span>
        <span style={{ textAlign: "center" }}>G</span>
        <span style={{ textAlign: "center" }}>E</span>
        <span style={{ textAlign: "center" }}>P</span>
        <span style={{ textAlign: "center" }}>GF</span>
        <span style={{ textAlign: "center" }}>GC</span>
        <span style={{ textAlign: "center" }}>DG</span>
        <span style={{ textAlign: "center", color: "var(--gold)" }}>PTS</span>
      </div>
      {rows.map((row, i) => {
        const qualifies = i < 2;
        return (
          <div
            key={row.tla}
            style={{
              display: "grid",
              gridTemplateColumns: "20px 1fr 28px 24px 24px 24px 28px 28px 28px 32px",
              gap: "0 4px",
              padding: "9px 14px",
              borderBottom: i < rows.length - 1 ? "1px solid rgba(255,255,255,.05)" : "none",
              background: qualifies ? "rgba(74,222,128,.04)" : "transparent",
              alignItems: "center",
            }}
          >
            <span style={{
              fontFamily: "var(--condensed)", fontWeight: 900,
              fontSize: i < 2 ? 12 : 10,
              color: qualifies ? "#4ade80" : "var(--muted)",
            }}>
              {medals[i]}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
              <Flag team={row.tla} height={14} />
              <span style={{
                fontFamily: "var(--condensed)", fontWeight: qualifies ? 900 : 700,
                fontSize: 11, color: qualifies ? "var(--ink)" : "var(--muted)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {teamName(row.tla, lang)}
              </span>
            </div>
            <Cell v={row.played} muted />
            <Cell v={row.won} highlight={row.won > 0} />
            <Cell v={row.draw} />
            <Cell v={row.lost} red={row.lost > 0} />
            <Cell v={row.gf} muted />
            <Cell v={row.ga} muted />
            <Cell v={row.gd} signed green={row.gd > 0} red={row.gd < 0} />
            <span style={{
              textAlign: "center", fontFamily: "var(--condensed)", fontWeight: 900,
              fontSize: 13, color: qualifies ? "var(--gold)" : "var(--ink)",
            }}>
              {row.points}
            </span>
          </div>
        );
      })}
      <div style={{
        padding: "5px 14px",
        borderTop: "1px solid rgba(74,222,128,.15)",
        display: "flex", alignItems: "center", gap: 6,
        fontSize: 9, fontFamily: "var(--condensed)", color: "var(--muted)",
      }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: "rgba(74,222,128,.35)", display: "inline-block" }} />
        Clasifican a octavos
      </div>
    </div>
  );
}

function Cell({
  v, muted, highlight, red, green, signed,
}: {
  v: number; muted?: boolean; highlight?: boolean;
  red?: boolean; green?: boolean; signed?: boolean;
}) {
  const color = red ? "#f87171" : green ? "#4ade80" : highlight ? "var(--ink)" : muted ? "var(--muted)" : "var(--ink)";
  return (
    <span style={{ textAlign: "center", fontFamily: "var(--condensed)", fontSize: 11, color }}>
      {signed && v > 0 ? `+${v}` : v}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function Fixture({ identity }: { identity?: Identity }) {
  const { t, lang } = useLang();
  const [view,        setView]        = useState<"grupos" | "eliminatorias">("grupos");
  const [activeGroup, setActiveGroup] = useState("A");
  const pubkey = identity?.pubkey ?? null;
  const standings = useStandings();
  const koMatches = useKoMatches();

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 11, letterSpacing: 3, color: "var(--gold)", marginBottom: 4 }}>
          FIFA WORLD CUP 2026™
        </div>
        <div style={{ fontFamily: "var(--display)", fontSize: 22, color: "var(--ink)", lineHeight: 1.1, marginBottom: 6 }}>
          {t.fixture_title}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--condensed)" }}>
          {t.fixture_subtitle}
        </div>
      </div>

      {/* View toggle */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {(["grupos", "eliminatorias"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} style={{
            background: view === v ? "var(--gold)" : "var(--panel)",
            color: view === v ? "#030b18" : "var(--muted)",
            border: `1px solid ${view === v ? "var(--gold)" : "var(--line)"}`,
            padding: "7px 16px", borderRadius: 8,
            fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 11, letterSpacing: 1, cursor: "pointer",
          }}>
            {v === "grupos" ? t.fixture_groups : t.fixture_knockout}
          </button>
        ))}
      </div>

      {/* ── FASE DE GRUPOS ── */}
      {view === "grupos" && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 14 }}>
            {GROUPS_ORDER.map((g) => (
              <button key={g} onClick={() => setActiveGroup(g)} style={{
                background: activeGroup === g ? "var(--gold)" : "var(--panel)",
                color: activeGroup === g ? "#030b18" : "var(--muted)",
                border: `1px solid ${activeGroup === g ? "var(--gold)" : "var(--line)"}`,
                padding: "5px 11px", borderRadius: 6,
                fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 11, cursor: "pointer",
              }}>
                {t.fixture_group_tab} {g}
              </button>
            ))}
          </div>
          <GroupView
            group={activeGroup} t={t} lang={lang}
            myPubkey={pubkey} identity={identity}
            standingRows={standings?.groups[activeGroup] ?? null}
          />
        </>
      )}

      {/* ── ELIMINATORIAS ── */}
      {view === "eliminatorias" && (
        <KnockoutView t={t} lang={lang} myPubkey={pubkey} identity={identity} koMatches={koMatches} />
      )}
    </div>
  );
}

// ─── Group stage view ─────────────────────────────────────────────────────────
function GroupView({
  group, t, lang, myPubkey, identity, standingRows,
}: {
  group: string;
  t: import("@/lib/i18n").Translations;
  lang: string;
  myPubkey: string | null;
  identity?: Identity;
  standingRows: TeamStanding[] | null;
}) {
  const teams = GROUP_TEAMS[group] ?? [];
  return (
    <div>
      {/* Standings table (real-time) */}
      {standingRows ? (
        <GroupStandingsTable rows={standingRows} lang={lang} />
      ) : (
        /* Fallback: static team list while standings load */
        <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
          <div style={{ padding: "8px 14px", background: "var(--panel2)", borderBottom: "1px solid var(--line)", fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 10, letterSpacing: 2, color: "var(--gold)" }}>
            {t.fixture_group_label} {group} — {t.fixture_teams_label}
          </div>
          {teams.map((code, i) => {
            const team = TEAMS[code];
            return (
              <div key={code} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: i < teams.length - 1 ? "1px solid var(--line)" : "none" }}>
                <span style={{ fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 11, color: "var(--muted)", width: 16 }}>{i + 1}</span>
                <Flag team={code} height={18} />
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: team.color, flexShrink: 0 }} />
                <span style={{ fontFamily: "var(--condensed)", fontWeight: 700, fontSize: 13, color: "var(--ink)" }}>{teamName(code, lang)}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Matches by matchday */}
      {([0, 1, 2] as const).map((mdIdx) => (
        <div key={mdIdx} style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <span style={{ fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 11, color: "var(--ink)", letterSpacing: 0.5 }}>
              {[t.matchday_1, t.matchday_2, t.matchday_3][mdIdx]}
            </span>
            {mdIdx === 2 && (
              <span style={{ fontFamily: "var(--condensed)", fontSize: 10, color: "var(--gold)", letterSpacing: 0.5 }}>
                ⚡ {t.prono_simultaneous}
              </span>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {MD_PAIRS[mdIdx].map(([iA, iB], matchIdx) => {
              const teamA = teams[iA];
              const teamB = teams[iB];
              if (!teamA || !teamB) return null;
              const matchId = `${group}:${mdIdx}:${matchIdx}`;
              const schedule = getSchedule(group, mdIdx, matchIdx);
              return (
                <MatchRow
                  key={matchId}
                  teamA={teamA} teamB={teamB}
                  nameA={teamName(teamA, lang)} nameB={teamName(teamB, lang)}
                  matchId={matchId} schedule={schedule}
                  myPubkey={myPubkey} identity={identity} t={t}
                />
              );
            })}
          </div>
        </div>
      ))}

      {VENUES[group] && (
        <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--condensed)", textAlign: "center", marginTop: 4, padding: "6px 12px", background: "var(--panel)", borderRadius: 8, border: "1px solid var(--line)" }}>
          📍 {VENUES[group]}
        </div>
      )}
    </div>
  );
}

// ─── Group-stage match row ────────────────────────────────────────────────────
function MatchRow({
  teamA, teamB, nameA, nameB,
  matchId, schedule, myPubkey, identity, t,
}: {
  teamA: string; teamB: string; nameA: string; nameB: string;
  matchId: string; schedule: ScheduleInfo;
  myPubkey: string | null; identity?: Identity;
  t: import("@/lib/i18n").Translations;
}) {
  const { pronos, myProno, publishing, publish } = usePronosticos(matchId, myPubkey);
  const [homeVal, setHomeVal] = useState("");
  const [awayVal, setAwayVal] = useState("");

  useEffect(() => {
    if (myProno) {
      setHomeVal(String(myProno.home));
      setAwayVal(String(myProno.away));
    } else {
      setHomeVal("");
      setAwayVal("");
    }
  }, [myProno?.home, myProno?.away]); // eslint-disable-line react-hooks/exhaustive-deps

  const count = pronos.size;
  const isDirty = myProno === null || homeVal !== String(myProno.home) || awayVal !== String(myProno.away);

  const handleSave = async () => {
    if (!identity) return;
    const h = parseInt(homeVal, 10), a = parseInt(awayVal, 10);
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0) return;
    await publish(h, a, identity);
  };

  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 12px", background: "var(--panel2)", borderBottom: "1px solid var(--line)" }}>
        <span style={{ fontFamily: "var(--condensed)", fontSize: 10, color: "var(--muted)", fontWeight: 700 }}>📅 {schedule.date}</span>
        <span style={{ fontFamily: "var(--condensed)", fontSize: 10, color: "var(--ink)", letterSpacing: 0.3 }}>
          🕐 {schedule.utc} UTC&nbsp;&nbsp;/&nbsp;&nbsp;{schedule.art} ARG
        </span>
      </div>

      {/* Teams + inputs */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 12px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, justifyContent: "flex-end" }}>
          <span style={{ fontFamily: "var(--condensed)", fontWeight: 700, fontSize: 12, color: "var(--ink)", textAlign: "right" }}>{nameA}</span>
          <Flag team={teamA} height={16} />
        </div>
        <ScoreInputs homeVal={homeVal} awayVal={awayVal} setHome={setHomeVal} setAway={setAwayVal} />
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, justifyContent: "flex-start" }}>
          <Flag team={teamB} height={16} />
          <span style={{ fontFamily: "var(--condensed)", fontWeight: 700, fontSize: 12, color: "var(--ink)" }}>{nameB}</span>
        </div>
      </div>

      <PronoFooter identity={identity} isDirty={isDirty} homeVal={homeVal} awayVal={awayVal} publishing={publishing} myProno={!!myProno} count={count} onSave={handleSave} t={t} />
      <BetPanel home={teamA} away={teamB} nameHome={nameA} nameAway={nameB} identity={identity} t={t} />
    </div>
  );
}

// ─── Knockout view ────────────────────────────────────────────────────────────
function KnockoutView({
  t, lang, myPubkey, identity, koMatches,
}: {
  t: import("@/lib/i18n").Translations;
  lang: string;
  myPubkey: string | null;
  identity?: Identity;
  koMatches: KoApiMatch[] | null;
}) {
  const ROUND_LABELS: Record<string, string> = {
    r32:   t.ko_round32,
    r16:   t.ko_round16,
    qf:    t.ko_quarter,
    sf:    t.ko_semi,
    "3rd": t.ko_third,
    final: t.ko_final,
  };

  const [activeRound, setActiveRound] = useState("r32");
  const current = KO_ROUNDS.find((r) => r.id === activeRound)!;

  // football-data.org ya conoce la estructura fija (fechas/stage) desde el
  // arranque del torneo y completa homeTeam/awayTeam en cuanto el cruce se
  // decide oficialmente — alcanza con emparejar por orden cronológico dentro
  // de la ronda (la lista que llega ya viene ordenada por utcDate).
  const apiForRound = (koMatches ?? []).filter((m) => m.round === activeRound);

  return (
    <div>
      <p style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--condensed)", margin: "0 0 12px" }}>
        {t.fixture_qualify}
      </p>

      {/* Round selector */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 16 }}>
        {KO_ROUNDS.map((r) => (
          <button
            key={r.id}
            onClick={() => setActiveRound(r.id)}
            style={{
              background: activeRound === r.id
                ? (r.id === "final" ? "var(--gold)" : "var(--gold)")
                : "var(--panel)",
              color: activeRound === r.id ? "#030b18" : "var(--muted)",
              border: `1px solid ${activeRound === r.id ? "var(--gold)" : "var(--line)"}`,
              padding: "5px 10px", borderRadius: 6,
              fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 10, cursor: "pointer",
              letterSpacing: 0.5,
            }}
          >
            {ROUND_LABELS[r.id]}
          </button>
        ))}
      </div>

      {/* Match count badge */}
      <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 13, color: "var(--ink)" }}>
          {ROUND_LABELS[activeRound]}
        </div>
        <div style={{ background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 6, padding: "2px 8px", fontFamily: "var(--condensed)", fontSize: 10, color: "var(--muted)" }}>
          {current.matches.length} {current.matches.length === 1 ? "partido" : "partidos"}
        </div>
      </div>

      {/* Match cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {current.matches.map((m, i) => (
          <KoMatchRow
            key={m.id}
            match={m}
            matchNum={i + 1}
            myPubkey={myPubkey}
            identity={identity}
            t={t}
            lang={lang}
            homeResolved={apiForRound[i]?.home ?? null}
            awayResolved={apiForRound[i]?.away ?? null}
            apiUtcDate={apiForRound[i]?.utcDate}
          />
        ))}
      </div>

      {/* Format note at bottom */}
      <div style={{ marginTop: 14, padding: "10px 14px", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, fontSize: 10, color: "var(--muted)", fontFamily: "var(--condensed)", lineHeight: 1.6 }}>
        <strong style={{ color: "var(--ink)" }}>{t.fixture_format_title}</strong> {t.fixture_format}
      </div>
    </div>
  );
}

// ─── Knockout match card ──────────────────────────────────────────────────────
function KoMatchRow({
  match, matchNum, myPubkey, identity, t, lang, homeResolved, awayResolved, apiUtcDate,
}: {
  match: KoMatch;
  matchNum: number;
  myPubkey: string | null;
  identity?: Identity;
  t: import("@/lib/i18n").Translations;
  lang: string;
  homeResolved: { tla: string; name: string } | null;
  awayResolved: { tla: string; name: string } | null;
  apiUtcDate?: string;
}) {
  const { pronos, myProno, publishing, publish } = usePronosticos(match.id, myPubkey);
  const [homeVal, setHomeVal] = useState("");
  const [awayVal, setAwayVal] = useState("");

  useEffect(() => {
    if (myProno) { setHomeVal(String(myProno.home)); setAwayVal(String(myProno.away)); }
  }, [myProno?.home, myProno?.away]); // eslint-disable-line react-hooks/exhaustive-deps

  const count = pronos.size;
  const isDirty = myProno === null || homeVal !== String(myProno.home) || awayVal !== String(myProno.away);
  // football-data.org es la fuente oficial de fechas — si la trajo, pisa el
  // valor hardcodeado de KO_ROUNDS (que quedó desactualizado: decía 3 jul
  // para un partido que en realidad arranca el 28 jun).
  const resolvedSchedule = apiUtcDate ? utcIsoToArt(apiUtcDate) : null;
  const displayDate = resolvedSchedule?.date ?? match.date;
  const artH = resolvedSchedule?.artH ?? match.utcH; // stored fallback values are ART times
  const utcH2 = artH + 3 >= 24 ? artH + 3 - 24 : artH + 3; // UTC = ART + 3
  const utc = `${String(utcH2).padStart(2,"0")}:00`;
  const art = `${String(artH).padStart(2,"0")}:00`;

  const handleSave = async () => {
    if (!identity) return;
    const h = parseInt(homeVal, 10), a = parseInt(awayVal, 10);
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0) return;
    await publish(h, a, identity);
  };

  const isFinal = match.isFinal;

  return (
    <div style={{
      background: isFinal
        ? "linear-gradient(135deg, rgba(232,185,35,.12), rgba(232,185,35,.04))"
        : "var(--panel)",
      border: `1px solid ${isFinal ? "var(--gold)" : "var(--line)"}`,
      borderRadius: 12,
      overflow: "hidden",
    }}>
      {/* Schedule bar */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "6px 12px",
        background: isFinal ? "rgba(232,185,35,.1)" : "var(--panel2)",
        borderBottom: `1px solid ${isFinal ? "rgba(232,185,35,.3)" : "var(--line)"}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "var(--condensed)", fontSize: 9, fontWeight: 900, color: "var(--muted)", letterSpacing: 1 }}>
            P{String(matchNum).padStart(2,"0")}
          </span>
          <span style={{ fontFamily: "var(--condensed)", fontSize: 10, color: isFinal ? "var(--gold)" : "var(--muted)", fontWeight: 700 }}>
            📅 {displayDate}
          </span>
          {match.venue && (
            <span style={{ fontFamily: "var(--condensed)", fontSize: 9, color: "var(--muted)" }}>
              · 📍 {match.venue}
            </span>
          )}
        </div>
        <span style={{ fontFamily: "var(--condensed)", fontSize: 10, color: "var(--ink)", letterSpacing: 0.3 }}>
          🕐 {utc} UTC&nbsp;/&nbsp;{art} ARG
        </span>
      </div>

      {/* Teams + inputs */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 12px 8px" }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
          {homeResolved && <Flag team={homeResolved.tla} height={14} />}
          <span style={{
            fontFamily: "var(--condensed)", fontWeight: 900,
            fontSize: isFinal ? 14 : 12,
            color: isFinal ? "var(--gold)" : "var(--ink)",
            letterSpacing: isFinal ? 0.5 : 0,
            textAlign: "right",
          }}>
            {homeResolved ? teamName(homeResolved.tla, lang) : match.home}
          </span>
        </div>
        <ScoreInputs homeVal={homeVal} awayVal={awayVal} setHome={setHomeVal} setAway={setAwayVal} />
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 6 }}>
          <span style={{
            fontFamily: "var(--condensed)", fontWeight: 900,
            fontSize: isFinal ? 14 : 12,
            color: isFinal ? "var(--gold)" : "var(--ink)",
            letterSpacing: isFinal ? 0.5 : 0,
            textAlign: "left",
          }}>
            {awayResolved ? teamName(awayResolved.tla, lang) : match.away}
          </span>
          {awayResolved && <Flag team={awayResolved.tla} height={14} />}
        </div>
      </div>

      {match.note && (
        <div style={{ padding: "0 12px 6px", fontFamily: "var(--condensed)", fontSize: 9, color: "var(--muted)", fontStyle: "italic" }}>
          * {match.note}
        </div>
      )}

      <PronoFooter
        identity={identity} isDirty={isDirty}
        homeVal={homeVal} awayVal={awayVal}
        publishing={publishing} myProno={!!myProno}
        count={count} onSave={handleSave} t={t}
      />
    </div>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────────
function ScoreInputs({
  homeVal, awayVal, setHome, setAway,
}: {
  homeVal: string; awayVal: string;
  setHome: (v: string) => void; setAway: (v: string) => void;
}) {
  const inputStyle = (filled: boolean): React.CSSProperties => ({
    width: 36, height: 36, textAlign: "center",
    background: "var(--panel2)",
    border: `1px solid ${filled ? "var(--gold)" : "var(--line)"}`,
    borderRadius: 8, color: "var(--ink)",
    fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 16,
    outline: "none", MozAppearance: "textfield",
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
      <input type="number" min={0} max={20} value={homeVal} onChange={(e) => setHome(e.target.value)} placeholder="–" style={inputStyle(homeVal !== "")} />
      <span style={{ fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 14, color: "var(--muted)" }}>–</span>
      <input type="number" min={0} max={20} value={awayVal} onChange={(e) => setAway(e.target.value)} placeholder="–" style={inputStyle(awayVal !== "")} />
    </div>
  );
}

function PronoFooter({
  identity, isDirty, homeVal, awayVal, publishing, myProno, count, onSave, t,
}: {
  identity?: Identity; isDirty: boolean; homeVal: string; awayVal: string;
  publishing: boolean; myProno: boolean; count: number;
  onSave: () => void; t: import("@/lib/i18n").Translations;
}) {
  const canSave = isDirty && homeVal !== "" && awayVal !== "" && !publishing;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px 10px", gap: 8 }}>
      {identity ? (
        <button
          onClick={onSave}
          disabled={!canSave}
          style={{
            background: myProno && !isDirty ? "rgba(34,197,94,.15)" : "rgba(139,92,246,.15)",
            color: myProno && !isDirty ? "#4ade80" : "#a78bfa",
            border: `1px solid ${myProno && !isDirty ? "rgba(74,222,128,.3)" : "rgba(167,139,250,.3)"}`,
            borderRadius: 8, padding: "5px 14px",
            fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 11, letterSpacing: 0.5,
            cursor: canSave ? "pointer" : "default",
            opacity: canSave ? 1 : 0.6,
            transition: "all .15s",
          }}
        >
          {publishing ? t.prono_saving : myProno && !isDirty ? `✓ ${t.prono_saved}` : t.prono_save}
        </button>
      ) : (
        <span style={{ fontFamily: "var(--condensed)", fontSize: 10, color: "var(--muted)", fontStyle: "italic" }}>
          {t.prono_connect}
        </span>
      )}
      {count > 0 && (
        <span style={{ fontFamily: "var(--condensed)", fontSize: 10, color: "var(--muted)" }}>
          👥 {count} {t.prono_count}
        </span>
      )}
    </div>
  );
}
