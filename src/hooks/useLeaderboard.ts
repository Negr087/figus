"use client";

import { useState, useEffect } from "react";
import { KIND, ISSUER_PUBKEY } from "@/lib/constants";
import { list, listAll, mapWithConcurrency } from "@/lib/pool";
import { parseOwnership } from "@/lib/parsers";
import { ALL_NUMBERS } from "@/lib/catalog";
import type { LeaderEntry } from "@/lib/types";

// Cache en módulo: sobrevive navegación entre tabs, expira a los 5 minutos.
let cachedEntries: LeaderEntry[] | null = null;
let cacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000;

export function useLeaderboard(enabled: boolean): { entries: LeaderEntry[]; loading: boolean } {
  const [entries, setEntries] = useState<LeaderEntry[]>(() => cachedEntries ?? []);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !ISSUER_PUBKEY) return;

    // Servir caché si es fresco
    if (cachedEntries && Date.now() - cacheTs < CACHE_TTL) {
      setEntries(cachedEntries);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setEntries([]);

    async function load() {
      // Paso 1: query de descubrimiento — trae hasta 500 eventos para extraer
      // los pubkeys de todos los jugadores activos. No importa si está incompleto,
      // solo necesitamos saber quiénes juegan.
      const discoveryEvents = await list(
        [{ kinds: [KIND.OWNERSHIP], authors: [ISSUER_PUBKEY], limit: 500 }],
        6000
      );
      if (cancelled) return;

      const pubkeys = [
        ...new Set(
          discoveryEvents
            .map(ev => ev.tags.find(t => t[0] === "p")?.[1])
            .filter((p): p is string => !!p)
        ),
      ];
      if (!pubkeys.length) { setLoading(false); return; }

      // Paso 2: query individual por jugador, paginada — un jugador con muchas
      // figuritas distintas tiene un 30100 addressable por cada una, y una sola
      // consulta sin paginar puede truncarse en el límite del relay (visto en
      // producción: un usuario con 1016 figus aparecía con 650 puntos).
      // Con tope de concurrencia: si un relay está caído, no queremos sumar un
      // intento de conexión por cada jugador a la vez (ver mapWithConcurrency).
      const perPlayerEvents = await mapWithConcurrency(pubkeys, 6, pk =>
        listAll({ kinds: [KIND.OWNERSHIP], authors: [ISSUER_PUBKEY], "#p": [pk] }, 5000)
      );
      if (cancelled) return;

      const stickerCounts: Record<string, number> = {};
      for (let i = 0; i < pubkeys.length; i++) {
        const own = parseOwnership(perPlayerEvents[i]);
        stickerCounts[pubkeys[i]] = ALL_NUMBERS.filter(n => (own[n] ?? 0) > 0).length;
      }

      // 3. Perfiles (en paralelo con el procesamiento anterior ya terminó)
      const profileMap: Record<string, { name: string; picture: string } | null> = {};
      try {
        const profileEvs = await list([{ kinds: [0], authors: pubkeys }]);
        if (!cancelled) {
          const latest: Record<string, (typeof profileEvs)[0]> = {};
          for (const ev of profileEvs) {
            if (!latest[ev.pubkey] || ev.created_at > latest[ev.pubkey].created_at)
              latest[ev.pubkey] = ev;
          }
          for (const pk of pubkeys) {
            const ev = latest[pk];
            if (ev) {
              try {
                const meta = JSON.parse(ev.content);
                profileMap[pk] = { name: meta.display_name || meta.name || "", picture: meta.picture || "" };
              } catch { profileMap[pk] = null; }
            } else {
              profileMap[pk] = null;
            }
          }
        }
      } catch {}

      if (cancelled) return;

      const scored: LeaderEntry[] = pubkeys.map(pk => {
        const stickers = stickerCounts[pk] || 0;
        return { pubkey: pk, profile: profileMap[pk] ?? null, stickers, score: stickers, rank: 0 };
      });

      scored.sort((a, b) => b.score - a.score || b.stickers - a.stickers);
      scored.forEach((e, i) => { e.rank = i + 1; });

      cachedEntries = scored;
      cacheTs = Date.now();
      setEntries(scored);
      setLoading(false);
    }

    load().catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, [enabled]);

  return { entries, loading };
}
