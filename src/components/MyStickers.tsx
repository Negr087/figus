"use client";

import { useState } from "react";
import { CATALOG, RARITY_META, ALL_NUMBERS, suggestedPrice } from "@/lib/catalog";
import type { Rarity } from "@/lib/types";
import { StickerFace } from "./StickerCard";
import { StickerZoom } from "./StickerZoom";
import { useLang } from "@/contexts/LangContext";
import type { Listing, Ownership } from "@/lib/types";

const RARITIES: Rarity[] = ["common", "rare", "shiny", "legendary"];
const RARITY_DEFAULT_PRICE: Record<Rarity, number> = {
  common: 200, rare: 500, shiny: 1000, legendary: 1500,
};

export function MyStickers({
  ownership,
  onSell,
  onSellMany,
  myListings = [],
}: {
  ownership: Ownership;
  onSell: (num: number, price: number) => void;
  onSellMany?: (items: { num: number; price: number }[]) => Promise<void>;
  myListings?: Listing[];
}) {
  const listedNums = new Set(myListings.map(l => l.stickerNum));
  const { t } = useLang();
  const [filter,      setFilter]     = useState<"dupes" | "all" | "bulk">("dupes");
  const [zoomedNum,   setZoomedNum]  = useState<number | null>(null);
  const [sellingNum,  setSellingNum] = useState<number | null>(null);
  const [sellPrice,   setSellPrice]  = useState("");
  const [bulkPrices,  setBulkPrices] = useState<Record<Rarity, string>>({
    common: "200", rare: "500", shiny: "1000", legendary: "1500",
  });
  const [bulkBusy, setBulkBusy] = useState(false);

  const ownedNums = ALL_NUMBERS.filter((n) => (ownership[n] ?? 0) > 0);
  const dupeNums  = ALL_NUMBERS.filter((n) => (ownership[n] ?? 0) > 1);

  // Unlisted dupes per rarity (one listing max per sticker number)
  const unlistedByRarity = Object.fromEntries(
    RARITIES.map(r => [r, dupeNums.filter(n => !listedNums.has(n) && CATALOG[n].rarity === r)])
  ) as Record<Rarity, number[]>;
  const totalUnlisted = RARITIES.reduce((sum, r) => sum + unlistedByRarity[r].length, 0);

  if (ownedNums.length === 0) return null;

  const shown = filter === "all" ? ownedNums : dupeNums;

  async function handleBulkSell(items: { num: number; price: number }[]) {
    if (!onSellMany || bulkBusy || items.length === 0) return;
    setBulkBusy(true);
    try { await onSellMany(items); }
    finally { setBulkBusy(false); }
  }

  const tabBtn = (active: boolean, label: string, onClick: () => void) => (
    <button
      onClick={onClick}
      style={{
        background: active ? "var(--gold)" : "transparent",
        color: active ? "#030b18" : "var(--muted)",
        border: active ? "none" : "1px solid var(--line)",
        padding: "4px 10px",
        borderRadius: 6,
        fontSize: 10,
        fontWeight: 900,
        fontFamily: "var(--condensed)",
        letterSpacing: 0.5,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ borderTop: "1px solid var(--line)", paddingTop: 24, marginTop: 4 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 14, letterSpacing: 1, color: "var(--ink)" }}>
            {t.my_title}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--condensed)", marginTop: 2 }}>
            {ownedNums.length} {t.my_unique} · {dupeNums.length} {t.my_dupes}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {tabBtn(filter === "dupes", t.my_tab_dupes, () => setFilter("dupes"))}
          {tabBtn(filter === "all",   t.my_tab_all,   () => setFilter("all"))}
          {dupeNums.length > 0 && onSellMany && tabBtn(filter === "bulk", t.my_tab_bulk, () => setFilter("bulk"))}
        </div>
      </div>

      {/* ── Bulk sell panel ──────────────────────────────────────────── */}
      {filter === "bulk" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {totalUnlisted === 0 ? (
            <div style={{
              textAlign: "center", padding: "28px 0",
              color: "var(--muted)", fontSize: 12,
              fontFamily: "var(--condensed)", fontWeight: 700,
            }}>
              {t.my_bulk_empty}
            </div>
          ) : (
            <>
              {RARITIES.map(r => {
                const nums = unlistedByRarity[r];
                if (nums.length === 0) return null;
                const meta = RARITY_META[r];
                return (
                  <div key={r} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "10px 12px",
                    background: "rgba(255,255,255,.04)",
                    borderRadius: 8,
                    border: `1px solid ${meta.ring}44`,
                  }}>
                    {/* Color dot */}
                    <div style={{
                      width: 8, height: 8, borderRadius: "50%",
                      background: meta.ring, flexShrink: 0,
                    }} />
                    {/* Rarity label */}
                    <div style={{
                      flex: 1, fontFamily: "var(--condensed)", fontWeight: 900,
                      fontSize: 12, color: meta.ring,
                    }}>
                      {meta.label}
                    </div>
                    {/* Count */}
                    <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--condensed)", minWidth: 52, textAlign: "right" }}>
                      {nums.length} {t.my_bulk_stickers}
                    </div>
                    {/* Price input */}
                    <input
                      type="number"
                      min={1}
                      value={bulkPrices[r]}
                      onChange={e => setBulkPrices(prev => ({ ...prev, [r]: e.target.value }))}
                      style={{
                        width: 72,
                        padding: "4px 6px",
                        background: "rgba(255,255,255,.06)",
                        border: "1px solid var(--line)",
                        borderRadius: 5,
                        color: "var(--ink)",
                        fontSize: 11,
                        fontFamily: "var(--condensed)",
                        fontWeight: 700,
                        textAlign: "center",
                        outline: "none",
                      }}
                    />
                    <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--condensed)" }}>sats</span>
                    {/* Publish this rarity */}
                    <button
                      disabled={bulkBusy}
                      onClick={() => handleBulkSell(nums.map(n => ({
                        num: n,
                        price: Math.max(1, Number(bulkPrices[r]) || RARITY_DEFAULT_PRICE[r]),
                      })))}
                      style={{
                        background: `${meta.ring}22`,
                        border: `1px solid ${meta.ring}88`,
                        color: meta.ring,
                        padding: "5px 10px",
                        borderRadius: 6,
                        fontSize: 10,
                        fontWeight: 900,
                        fontFamily: "var(--condensed)",
                        letterSpacing: 0.3,
                        cursor: bulkBusy ? "default" : "pointer",
                        opacity: bulkBusy ? 0.5 : 1,
                        flexShrink: 0,
                      }}
                    >
                      ⚡ {nums.length}
                    </button>
                  </div>
                );
              })}

              {/* Publish all button */}
              <button
                disabled={bulkBusy}
                onClick={() => handleBulkSell(
                  RARITIES.flatMap(r => unlistedByRarity[r].map(n => ({
                    num: n,
                    price: Math.max(1, Number(bulkPrices[r]) || RARITY_DEFAULT_PRICE[r]),
                  })))
                )}
                style={{
                  marginTop: 4,
                  width: "100%",
                  background: bulkBusy
                    ? "rgba(255,255,255,0.06)"
                    : "linear-gradient(135deg,var(--gold),#d4920a)",
                  color: bulkBusy ? "var(--muted)" : "#030b18",
                  border: bulkBusy ? "1px solid var(--line)" : "none",
                  padding: "10px 0",
                  borderRadius: 8,
                  fontFamily: "var(--condensed)",
                  fontWeight: 900,
                  fontSize: 13,
                  letterSpacing: 0.5,
                  cursor: bulkBusy ? "default" : "pointer",
                }}
              >
                {bulkBusy
                  ? t.my_bulk_signing
                  : `⚡ ${t.my_bulk_publish} (${totalUnlisted})`}
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Normal grid (dupes / all) ───────────────────────────────── */}
      {filter !== "bulk" && (
        <>
          {shown.length === 0 && (
            <div style={{
              textAlign: "center", padding: "28px 0",
              color: "var(--muted)", fontSize: 12,
              fontFamily: "var(--condensed)", fontWeight: 700,
            }}>
              {filter === "dupes" ? t.my_empty_dupes : t.my_empty_all}
            </div>
          )}

          {shown.length > 0 && (
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(82px, 1fr))",
              gap: 10,
            }}>
              {shown.map((n) => {
                const count  = ownership[n] ?? 0;
                const extras = count - 1;
                const r      = RARITY_META[CATALOG[n].rarity];

                return (
                  <div key={n} style={{ position: "relative" }}>
                    {/* Card */}
                    <div
                      onClick={() => setZoomedNum(n)}
                      style={{
                        height: 112,
                        border: `2px solid ${r.ring}`,
                        borderRadius: 10,
                        overflow: "hidden",
                        boxShadow: extras > 0 ? `0 0 10px ${r.glow}44` : "none",
                        opacity: extras === 0 && filter === "all" ? 0.55 : 1,
                        cursor: "pointer",
                      }}
                    >
                      <StickerFace num={n} compact />
                    </div>

                    {/* Quantity badge */}
                    {count > 1 && (
                      <div style={{
                        position: "absolute", top: -7, right: -7,
                        background: "var(--gold)", color: "#030b18",
                        fontSize: 9, fontWeight: 900,
                        fontFamily: "var(--condensed)",
                        borderRadius: 99, minWidth: 20, height: 20,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        padding: "0 4px",
                        boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
                        zIndex: 2,
                      }}>
                        ×{count}
                      </div>
                    )}

                    {/* Sell button / price editor */}
                    {extras > 0 && (
                      sellingNum === n ? (
                        <div style={{ marginTop: 5, display: "flex", flexDirection: "column", gap: 3 }}>
                          <input
                            autoFocus
                            type="number"
                            min={1}
                            value={sellPrice}
                            onChange={(e) => setSellPrice(e.target.value)}
                            placeholder={String(suggestedPrice(n))}
                            style={{
                              width: "100%",
                              padding: "3px 6px",
                              background: "rgba(255,255,255,0.06)",
                              border: "1px solid var(--gold)",
                              borderRadius: 5,
                              color: "var(--gold)",
                              fontSize: 10,
                              fontFamily: "var(--condensed)",
                              fontWeight: 700,
                              boxSizing: "border-box",
                              textAlign: "center",
                              outline: "none",
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                const p = Number(sellPrice) || suggestedPrice(n);
                                onSell(n, p);
                                setSellingNum(null);
                                setSellPrice("");
                              }
                              if (e.key === "Escape") { setSellingNum(null); setSellPrice(""); }
                            }}
                          />
                          <div style={{ display: "flex", gap: 3 }}>
                            <button
                              onClick={() => {
                                const p = Number(sellPrice) || suggestedPrice(n);
                                onSell(n, p);
                                setSellingNum(null);
                                setSellPrice("");
                              }}
                              style={{
                                flex: 1,
                                background: "var(--gold)", border: "none", color: "#030b18",
                                padding: "3px 0", borderRadius: 5,
                                fontSize: 9, fontWeight: 900,
                                fontFamily: "var(--condensed)", cursor: "pointer",
                              }}
                            >
                              ✓
                            </button>
                            <button
                              onClick={() => { setSellingNum(null); setSellPrice(""); }}
                              style={{
                                background: "transparent", border: "1px solid var(--line)",
                                color: "var(--muted)", padding: "3px 5px",
                                borderRadius: 5, fontSize: 9, cursor: "pointer",
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ) : listedNums.has(n) ? (
                        <div style={{
                          width: "100%", marginTop: 5,
                          background: "rgba(34,197,94,.15)",
                          border: "1px solid rgba(34,197,94,.5)",
                          color: "rgb(34,197,94)",
                          padding: "4px 0", borderRadius: 6,
                          fontSize: 9, fontWeight: 900,
                          fontFamily: "var(--condensed)", letterSpacing: 0.3, textAlign: "center",
                        }}>
                          {t.my_listed}
                        </div>
                      ) : (
                        <button
                          onClick={() => { setSellingNum(n); setSellPrice(String(suggestedPrice(n))); }}
                          style={{
                            width: "100%", marginTop: 5,
                            background: "transparent", border: "1px solid var(--gold)",
                            color: "var(--gold)", padding: "4px 0", borderRadius: 6,
                            fontSize: 9, fontWeight: 900,
                            fontFamily: "var(--condensed)", letterSpacing: 0.3, cursor: "pointer",
                          }}
                        >
                          {t.my_sell}
                        </button>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {zoomedNum !== null && (
        <StickerZoom
          num={zoomedNum}
          ownership={ownership}
          onClose={() => setZoomedNum(null)}
          myListings={myListings}
          onSell={onSell}
        />
      )}
    </div>
  );
}
