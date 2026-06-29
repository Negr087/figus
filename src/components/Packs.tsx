"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CATALOG, RARITY_META, TEAMS, TEAM_FLAGS } from "@/lib/catalog";
import { StickerFace } from "./StickerCard";
import { useLang } from "@/contexts/LangContext";
import { ShareButton } from "./ShareButton";
import type { Identity } from "@/lib/identity";
import { SITE_URL } from "@/lib/share";

export function Packs({
  onOpen,
  onOpenBulk,
  onCancel,
  busy,
  freePack,
}: {
  onOpen: () => void;
  onOpenBulk: () => void;
  onCancel: () => void;
  busy: boolean;
  freePack?: { available: boolean; onOpen: () => void };
}) {
  const { t } = useLang();
  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 0" }}>

      {/* ── SOBRE DE REGALO ── */}
      {freePack?.available && (
        <div style={{
          width: "100%",
          maxWidth: 340,
          marginBottom: 28,
          background: "linear-gradient(135deg, rgba(82,183,136,.12), rgba(82,183,136,.04))",
          border: "1px solid rgba(82,183,136,.5)",
          borderRadius: 16,
          padding: "18px 20px",
          textAlign: "center",
        }}>
          <div style={{
            fontFamily: "var(--condensed)",
            fontWeight: 900,
            fontSize: 10,
            letterSpacing: 2,
            color: "#52b788",
            marginBottom: 6,
          }}>
            {t.pack_free_badge}
          </div>
          <div style={{
            fontFamily: "var(--display)",
            fontSize: 20,
            color: "var(--ink)",
            marginBottom: 4,
          }}>
            {t.pack_free_title}
          </div>
          <div style={{
            fontSize: 11,
            color: "var(--muted)",
            fontFamily: "var(--condensed)",
            marginBottom: 14,
          }}>
            {t.pack_free_subtitle}
          </div>
          <button
            disabled={busy}
            onClick={freePack.onOpen}
            style={{
              background: busy ? "var(--panel2)" : "linear-gradient(135deg, #52b788, #2d6a4f)",
              color: busy ? "var(--muted)" : "#fff",
              border: "none",
              padding: "12px 28px",
              borderRadius: 10,
              fontWeight: 900,
              fontSize: 14,
              fontFamily: "var(--condensed)",
              letterSpacing: 0.5,
              cursor: busy ? "default" : "pointer",
              transition: "all .2s",
            }}
          >
            {busy ? t.pack_processing : t.pack_free_btn}
          </button>
        </div>
      )}
      {/* Pack visual */}
      <div
        style={{
          position: "relative",
          width: 220,
          height: 310,
          marginBottom: 28,
          filter: "drop-shadow(0 12px 40px rgba(0,48,135,0.5))",
        }}
      >
        {/* Pack body */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 16,
            background: "linear-gradient(160deg, #003087 0%, #001a50 40%, #0a0020 80%, #1a0040 100%)",
            border: "2px solid rgba(232,185,35,0.6)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 16px 16px",
          }}
        >
          <div className="shine" style={{ opacity: 0.5 }} />

          {/* Top: FIFA WC 2026 */}
          <div style={{ textAlign: "center", zIndex: 1 }}>
            <div
              style={{
                fontSize: 9,
                letterSpacing: 2,
                color: "rgba(255,255,255,0.7)",
                fontFamily: "var(--condensed)",
                fontWeight: 700,
              }}
            >
              FIFA WORLD CUP 2026™
            </div>
            <div
              style={{
                fontFamily: "var(--display)",
                fontSize: 28,
                color: "var(--gold)",
                lineHeight: 1,
                marginTop: 4,
              }}
            >
              FIGUS
            </div>
          </div>

          {/* Center: Hexagon logo / emblem */}
          <div
            style={{
              width: 90,
              height: 90,
              position: "relative",
              zIndex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Hexagon />
            <span style={{ position: "absolute", fontSize: 32 }}>🏆</span>
          </div>

          {/* Bottom info */}
          <div style={{ textAlign: "center", zIndex: 1 }}>
            <div
              style={{
                fontFamily: "var(--condensed)",
                fontWeight: 900,
                fontSize: 16,
                color: "#fff",
                letterSpacing: 0.5,
              }}
            >
              {t.pack_classic}
            </div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 2, fontFamily: "var(--condensed)" }}>
              {t.pack_7random}
            </div>
          </div>
        </div>

        {/* Tear notch at top */}
        <div
          style={{
            position: "absolute",
            top: -1,
            left: "50%",
            transform: "translateX(-50%)",
            width: 40,
            height: 8,
            background: "#030b18",
            borderRadius: "0 0 6px 6px",
            border: "1px solid rgba(232,185,35,0.3)",
            borderTop: "none",
          }}
        />
      </div>

      {/* Price + button */}
      <div
        style={{
          fontFamily: "var(--condensed)",
          fontSize: 32,
          fontWeight: 900,
          color: "var(--gold)",
          lineHeight: 1,
          marginBottom: 4,
        }}
      >
        21 sats
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 18 }}>
        {t.pack_lightning}
      </div>

      <button
        disabled={busy}
        onClick={onOpen}
        style={{
          background: busy
            ? "var(--panel2)"
            : "linear-gradient(135deg, var(--gold), #d4920a)",
          color: busy ? "var(--muted)" : "#030b18",
          border: "none",
          padding: "14px 36px",
          borderRadius: 12,
          fontWeight: 900,
          fontSize: 16,
          fontFamily: "var(--condensed)",
          letterSpacing: 0.5,
          opacity: busy ? 0.7 : 1,
          transition: "all .2s",
        }}
      >
        {busy ? t.pack_processing : t.pack_open}
      </button>
      {busy && (
        <button
          onClick={onCancel}
          style={{
            marginTop: 8,
            background: "transparent",
            color: "var(--muted)",
            border: "1px solid var(--line)",
            padding: "6px 18px",
            borderRadius: 8,
            fontSize: 11,
            fontFamily: "var(--condensed)",
            fontWeight: 700,
          }}
        >
          {t.pack_cancel}
        </button>
      )}

      {/* Caja × 10 */}
      <div style={{
        marginTop: 20,
        width: "100%",
        maxWidth: 340,
        background: "linear-gradient(135deg, rgba(232,185,35,.1), rgba(232,185,35,.04))",
        border: "1px solid rgba(232,185,35,.35)",
        borderRadius: 14,
        padding: "14px 18px",
        display: "flex",
        alignItems: "center",
        gap: 14,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
            <span style={{
              fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 14,
              color: "var(--gold)", letterSpacing: 0.5,
            }}>
              {t.pack_bulk_title}
            </span>
            <span style={{
              background: "var(--gold)", color: "#030b18",
              fontSize: 9, fontWeight: 900, padding: "2px 7px",
              borderRadius: 99, fontFamily: "var(--condensed)", letterSpacing: 0.5,
            }}>
              {t.pack_bulk_discount}
            </span>
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--condensed)" }}>
            {t.pack_bulk_subtitle}
          </div>
          <div style={{ marginTop: 4, display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 18, color: "var(--gold)" }}>
              189 sats
            </span>
            <span style={{ fontSize: 11, color: "var(--muted)", textDecoration: "line-through", fontFamily: "var(--condensed)" }}>
              210
            </span>
          </div>
        </div>
        <button
          disabled={busy}
          onClick={onOpenBulk}
          style={{
            background: busy ? "var(--panel2)" : "linear-gradient(135deg, var(--gold), #d4920a)",
            color: busy ? "var(--muted)" : "#030b18",
            border: "none",
            padding: "10px 14px",
            borderRadius: 10,
            fontWeight: 900,
            fontSize: 11,
            fontFamily: "var(--condensed)",
            letterSpacing: 0.3,
            cursor: busy ? "default" : "pointer",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          {busy ? t.pack_processing : t.pack_bulk_open}
        </button>
      </div>

      {/* Odds table */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          justifyContent: "center",
          marginTop: 20,
        }}
      >
        {(["legendary", "shiny", "rare", "common"] as const).map((k) => {
          const v = RARITY_META[k];
          return (
            <div
              key={k}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                background: "var(--panel)",
                border: `1px solid ${v.ring}44`,
                borderRadius: 8,
                padding: "6px 12px",
              }}
            >
              <span style={{ fontSize: 9, fontWeight: 900, color: v.ring, fontFamily: "var(--condensed)", letterSpacing: 0.5 }}>
                {v.label.toUpperCase()}
              </span>
              <span style={{ fontSize: 12, fontWeight: 900, color: "var(--ink)", fontFamily: "var(--condensed)" }}>
                {(v.odds * 100).toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Bordes dentados del sobre (efecto rasgado) ───────────────────────────────
const SAW_TEETH = 11;
// Borde inferior dentado de la tira que se arranca (recorrido de derecha a izquierda)
const SAW_STRIP = (() => {
  const pts: string[] = [];
  for (let k = SAW_TEETH * 2; k >= 0; k--) {
    const x = (k / (SAW_TEETH * 2)) * 100;
    const y = k % 2 === 0 ? 70 : 100;
    pts.push(`${x.toFixed(2)}% ${y}%`);
  }
  return `polygon(0% 0%, 100% 0%, ${pts.join(", ")})`;
})();
// Borde superior dentado del cuerpo (queda a la vista cuando vuela la tira)
const SAW_BODY = (() => {
  const pts: string[] = [];
  for (let k = 0; k <= SAW_TEETH * 2; k++) {
    const x = (k / (SAW_TEETH * 2)) * 100;
    const y = k % 2 === 0 ? 0 : 4;
    pts.push(`${x.toFixed(2)}% ${y}%`);
  }
  return `polygon(${pts.join(", ")}, 100% 100%, 0% 100%)`;
})();

type PackStage = "pack" | "tear" | "cards";

/** Marca de cada figurita del sobre: nueva o repetida (con total de copias). */
export interface PackMark {
  isNew: boolean;
  copies: number;
}

export function PackReveal({
  figus,
  marks,
  onClose,
  onSkipAll,
  identity,
  packIndex,
  totalPacks,
}: {
  figus: number[];
  /** Alineado con `figus` — si falta (demo), no se muestran badges. */
  marks?: PackMark[];
  onClose: () => void;
  /** Modo multi-sobre: salta todos los sobres restantes de una. */
  onSkipAll?: () => void;
  identity?: Identity;
  packIndex?: number;
  totalPacks?: number;
}) {
  const { t, lang } = useLang();
  const [stage, setStage] = useState<PackStage>("pack");
  const [revealed, setRevealed] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);

  // Sobre nuevo (o el siguiente de la caja): reiniciar la secuencia de apertura
  useEffect(() => {
    setStage("pack");
    setRevealed(0);
  }, [figus]);

  // pack (entra girando + tiembla) → tear (se rasga) → cards (salen las figus)
  useEffect(() => {
    if (stage === "pack") {
      const t1 = setTimeout(() => setStage("tear"), 1850);
      return () => clearTimeout(t1);
    }
    if (stage === "tear") {
      const t1 = setTimeout(() => setStage("cards"), 480);
      return () => clearTimeout(t1);
    }
  }, [stage]);

  // Las figuritas van saliendo del sobre una por una
  useEffect(() => {
    if (stage !== "cards") return;
    const interval = setInterval(
      () => setRevealed((r) => (r < figus.length ? r + 1 : r)),
      160
    );
    return () => clearInterval(interval);
  }, [stage, figus.length]);

  // Partículas doradas del rasgado — hacia arriba, fijas por sobre
  const tearBits = useMemo(
    () =>
      Array.from({ length: 14 }, (_, k) => {
        const spread = (k / 13 - 0.5) * 2; // -1..1
        return {
          dx: spread * (50 + Math.random() * 70),
          dy: -(30 + Math.random() * 100),
          size: 3 + Math.random() * 5,
          delay: Math.random() * 0.08,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [figus]
  );

  const skipPack = () => { if (stage === "pack") setStage("tear"); };
  const opening = stage !== "cards";

  // ── Auto-avance en modo multi-sobre ────────────────────────────────────────
  // Con todas las cartas afuera, el botón "SIGUIENTE SOBRE" se llena como
  // barra de progreso durante 4s y simula el click solo.
  const hasNextPack = !!(totalPacks && packIndex && packIndex < totalPacks);
  const allRevealed = revealed >= figus.length;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!hasNextPack || stage !== "cards" || !allRevealed) return;
    const t1 = setTimeout(() => onCloseRef.current(), 4000);
    return () => clearTimeout(t1);
  }, [hasNextPack, stage, allRevealed]);

  return (
    <div
      onClick={opening ? skipPack : onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(3,11,24,.92)",
        backdropFilter: "blur(8px)",
        display: "grid",
        placeItems: "center",
        zIndex: 50,
        padding: 20,
        cursor: stage === "pack" ? "pointer" : "default",
      }}
    >
      <style>{`
        @keyframes packIn {
          0%   { transform: rotateY(720deg) scale(.08) translateY(80px); opacity: 0; }
          55%  { opacity: 1; }
          100% { transform: rotateY(0deg) scale(1) translateY(0); opacity: 1; }
        }
        @keyframes packWobble {
          0%, 100% { transform: rotateY(-13deg) rotateZ(-2deg) translateY(0); }
          25%      { transform: rotateY(11deg)  rotateZ(1.6deg) translateY(-6px); }
          50%      { transform: rotateY(-9deg)  rotateZ(-1.2deg) translateY(4px); }
          75%      { transform: rotateY(13deg)  rotateZ(2.2deg) translateY(-5px); }
        }
        @keyframes packJolt {
          0%   { transform: scale(1) rotateZ(0); }
          30%  { transform: scale(1.07) rotateZ(-2.4deg); }
          60%  { transform: scale(.97) rotateZ(1.4deg); }
          100% { transform: scale(1.01) rotateZ(0); }
        }
        @keyframes packTearStrip {
          0%   { transform: translate(0, 0) rotate(0deg); opacity: 1; }
          100% { transform: translate(-56px, -150px) rotate(-32deg); opacity: 0; }
        }
        @keyframes packGlowPulse {
          0%, 100% { opacity: .45; transform: scale(1); }
          50%      { opacity: .9;  transform: scale(1.18); }
        }
        @keyframes packShine {
          0%       { transform: translateX(-200%) skewX(-16deg); }
          55%,100% { transform: translateX(300%)  skewX(-16deg); }
        }
        @keyframes packFlash {
          0%   { opacity: .95; transform: translate(-50%,-50%) scale(.4); }
          100% { opacity: 0;   transform: translate(-50%,-50%) scale(2.2); }
        }
        @keyframes packBit {
          0%   { transform: translate(-50%,-50%) scale(1); opacity: 1; }
          100% { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(.15); opacity: 0; }
        }
        @keyframes packCardOut {
          0%   { opacity: 0; transform: translateY(150px) rotateY(440deg) scale(.15); }
          55%  { opacity: 1; }
          80%  { transform: translateY(-10px) rotateY(0deg) scale(1.07); }
          100% { opacity: 1; transform: translateY(0) rotateY(0deg) scale(1); }
        }
        @keyframes packLabelBlink {
          0%, 100% { opacity: .9; }
          50%      { opacity: .4; }
        }
        @keyframes packNextFill {
          0%   { transform: scaleX(0); }
          100% { transform: scaleX(1); }
        }
      `}</style>

      {/* ════ FASE 1 · EL SOBRE (entra, tiembla, se rasga) ════ */}
      {opening && (
        <div style={{ position: "relative", pointerEvents: "none", textAlign: "center" }}>
          {/* Chip de progreso en cajas de varios sobres */}
          <div style={{
            marginBottom: 22,
            fontFamily: "var(--condensed)", fontWeight: 900,
            fontSize: 11, letterSpacing: 2, color: "var(--gold)",
            animation: "packLabelBlink 1.2s ease-in-out infinite",
          }}>
            {(lang === "en" ? "OPENING PACK" : "ABRIENDO SOBRE")}
            {totalPacks && packIndex ? ` ${packIndex}/${totalPacks}` : ""}…
          </div>

          <div style={{ perspective: 1400, display: "inline-block", position: "relative" }}>
            {/* Halo dorado pulsante */}
            <div style={{
              position: "absolute", left: "50%", top: "50%",
              width: 420, height: 420,
              marginLeft: -210, marginTop: -210,
              background: "radial-gradient(circle, rgba(232,185,35,.4) 0%, transparent 62%)",
              borderRadius: "50%",
              animation: "packGlowPulse 1.4s ease-in-out infinite",
              filter: "blur(8px)",
            }} />

            {/* Sobre 3D */}
            <div style={{
              position: "relative",
              width: 200, height: 270,
              transformStyle: "preserve-3d",
              animation: stage === "pack"
                ? "packIn .7s cubic-bezier(.25,.9,.3,1) both, packWobble 1.15s ease-in-out .75s infinite"
                : "packJolt .48s ease-out both",
            }}>
              {/* Cuerpo del sobre (borde superior dentado, oculto bajo la tira) */}
              <div style={{
                position: "absolute", inset: 0,
                clipPath: SAW_BODY,
                borderRadius: 14,
                background: "linear-gradient(155deg, #10275a 0%, #0a1a3e 45%, #143a7a 75%, #0a1a3e 100%)",
                boxShadow: "0 18px 50px rgba(0,0,0,.55), inset 0 0 0 2px rgba(232,185,35,.55), inset 0 0 40px rgba(232,185,35,.08)",
                overflow: "hidden",
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                gap: 6,
              }}>
                <img src="/logomundial.webp" alt="" width={74} height={74} style={{ objectFit: "contain", filter: "drop-shadow(0 0 14px rgba(232,185,35,.5))" }} />
                <div style={{ fontFamily: "var(--display)", fontSize: 34, color: "var(--gold)", lineHeight: 1, letterSpacing: 2, textShadow: "0 2px 0 rgba(0,0,0,.45)" }}>
                  FIGUS
                </div>
                <div style={{ fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 10, letterSpacing: 3, color: "rgba(255,255,255,.85)" }}>
                  MUNDIAL 2026™
                </div>
                <div style={{
                  marginTop: 8, fontFamily: "var(--condensed)", fontWeight: 900,
                  fontSize: 9, letterSpacing: 1.5, color: "#030b18",
                  background: "var(--gold)", borderRadius: 99, padding: "3px 10px",
                }}>
                  {figus.length} FIGURITAS
                </div>
                {/* Barrido de brillo del foil */}
                <div style={{
                  position: "absolute", top: -20, bottom: -20, width: "45%",
                  background: "linear-gradient(105deg, transparent 0%, rgba(255,255,255,.35) 50%, transparent 100%)",
                  animation: "packShine 1.6s ease-in-out .4s infinite",
                }} />
              </div>

              {/* Tira superior que se arranca (borde inferior dentado) */}
              <div style={{
                position: "absolute", top: 0, left: 0, right: 0,
                height: 46,
                clipPath: SAW_STRIP,
                borderRadius: "14px 14px 0 0",
                background: "linear-gradient(155deg, #1a3a7e 0%, #122a5e 60%, #1d4490 100%)",
                boxShadow: "inset 0 0 0 2px rgba(232,185,35,.55)",
                display: "flex", alignItems: "center", justifyContent: "center",
                animation: stage === "tear" ? "packTearStrip .46s cubic-bezier(.4,.1,.7,1) both" : "none",
                zIndex: 2,
              }}>
                <div style={{ fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 8, letterSpacing: 2.5, color: "rgba(232,185,35,.8)" }}>
                  ⚡ FIFA WORLD CUP 2026™ ⚡
                </div>
              </div>

              {/* Flash + partículas al rasgar */}
              {stage === "tear" && (
                <>
                  <div style={{
                    position: "absolute", left: "50%", top: 26,
                    width: 240, height: 130,
                    background: "radial-gradient(ellipse, rgba(255,255,255,.95) 0%, rgba(232,185,35,.7) 40%, transparent 70%)",
                    animation: "packFlash .45s ease-out both",
                    pointerEvents: "none",
                  }} />
                  {tearBits.map((b, k) => (
                    <div key={k} style={{
                      position: "absolute", left: "50%", top: 30,
                      width: b.size, height: b.size,
                      borderRadius: "50%",
                      background: k % 3 === 0 ? "#fff" : "var(--gold)",
                      boxShadow: "0 0 8px rgba(232,185,35,.8)",
                      ["--dx" as string]: `${b.dx}px`,
                      ["--dy" as string]: `${b.dy}px`,
                      animation: `packBit ${0.5 + (k % 4) * 0.07}s ease-out ${b.delay}s both`,
                    }} />
                  ))}
                </>
              )}
            </div>
          </div>

          <div style={{
            marginTop: 22, fontSize: 10, color: "var(--muted)",
            fontFamily: "var(--condensed)", fontWeight: 700, letterSpacing: 1.5,
          }}>
            {lang === "en" ? "CLICK TO OPEN NOW" : "CLICK PARA ABRIRLO YA"}
          </div>
        </div>
      )}

      {/* ════ FASE 2 · LAS FIGURITAS SALEN DEL SOBRE ════ */}
      {stage === "cards" && (
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: 20,
          padding: "28px 24px",
          textAlign: "center",
          maxWidth: 560,
          width: "100%",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 4 }}>
          <div
            style={{
              fontFamily: "var(--condensed)",
              fontWeight: 900,
              fontSize: 10,
              letterSpacing: 2,
              color: "var(--gold)",
            }}
          >
            FIFA WORLD CUP 2026™
          </div>
          {totalPacks && packIndex && (
            <span style={{
              fontFamily: "var(--condensed)", fontWeight: 900, fontSize: 10,
              letterSpacing: 0.5, background: "rgba(232,185,35,.15)",
              border: "1px solid rgba(232,185,35,.4)", color: "var(--gold)",
              borderRadius: 99, padding: "2px 8px",
            }}>
              {packIndex}/{totalPacks}
            </span>
          )}
        </div>
        <h2
          style={{
            fontFamily: "var(--display)",
            margin: "0 0 4px",
            color: "var(--ink)",
            fontSize: 22,
          }}
        >
          {t.pack_opened}
        </h2>
        <p style={{ opacity: 0.5, margin: "0 0 20px", fontSize: 12, fontFamily: "var(--condensed)" }}>
          {t.pack_tap}
        </p>

        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          {(() => {
            // Index of the best special card (legendary > shiny) — used to attach the share ref
            const bestIdx = (() => {
              const li = figus.findIndex(n => CATALOG[n]?.rarity === "legendary");
              if (li >= 0) return li;
              return figus.findIndex(n => CATALOG[n]?.rarity === "shiny");
            })();
            return figus.map((num, i) => {
              const f = CATALOG[num];
              const r = RARITY_META[f.rarity];
              const team = TEAMS[f.team];
              const show = i < revealed;
              return (
                <div
                  key={`${num}-${i}`}
                  ref={i === bestIdx ? cardRef : undefined}
                  style={{
                    width: 100,
                    height: 134,
                    borderRadius: 10,
                    border: `2px solid ${show ? r.ring : "var(--line)"}`,
                    overflow: "hidden",
                    position: "relative",
                    boxShadow: show ? `0 0 28px ${r.glow}` : "none",
                    background: show
                      ? `linear-gradient(150deg, ${team.color}, ${team.accent})`
                      : "var(--panel2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    // Cada figurita sale volando del sobre (gira y aterriza en su lugar)
                    animation: show ? "packCardOut .6s cubic-bezier(.2,1.3,.4,1) both" : "none",
                  }}
                >
                  {show ? (
                    <div style={{
                      width: "100%", height: "100%",
                      // Las repetidas salen apagadas, como en el resumen del lote
                      filter: marks?.[i] && !marks[i].isNew ? "grayscale(.7) brightness(.85)" : "none",
                    }}>
                      <StickerFace num={num} />
                    </div>
                  ) : (
                    <div style={{ fontSize: 36, opacity: 0.3 }}>❔</div>
                  )}
                  {/* Badge nueva/repetida (si hay clasificación) */}
                  {show && marks?.[i] && (
                    <div style={{
                      position: "absolute", bottom: 0, left: 0, right: 0,
                      textAlign: "center",
                      fontFamily: "var(--condensed)", fontWeight: 900,
                      fontSize: 8, letterSpacing: 1, padding: "2.5px 0",
                      background: marks[i].isNew ? "var(--gold)" : "rgba(75,85,99,.92)",
                      color: marks[i].isNew ? "#030b18" : "#cbd5e1",
                      zIndex: 2,
                    }}>
                      {marks[i].isNew ? "✨ NUEVA" : `REPETIDA ×${marks[i].copies}`}
                    </div>
                  )}
                </div>
              );
            });
          })()}
        </div>

        {(() => {
          const allRevealed = revealed >= figus.length;
          const specials = figus.filter(n => {
            const r = CATALOG[n]?.rarity;
            return r === "legendary" || r === "shiny";
          });
          if (!allRevealed || !identity || specials.length === 0) return null;
          const best = specials.find(n => CATALOG[n].rarity === "legendary") ?? specials[0];
          const s = CATALOG[best];
          const rarityLabel = RARITY_META[s.rarity].label.toUpperCase();
          const content = `🎴 ¡Acabo de sacar una ${rarityLabel} en el álbum del Mundial 2026!\n✨ #${best} ${s.name}\n\nArmá tu álbum en ${SITE_URL} ⚽🏆 #FIFAWorldCup2026 #Figus`;
          return (
            <div style={{ marginTop: 16 }}>
              <ShareButton content={content} identity={identity} style={{ width: "100%" }} cardRef={cardRef} />
            </div>
          );
        })()}

        <button
          onClick={onClose}
          style={{
            marginTop: 12,
            background: "linear-gradient(135deg,var(--gold),#d4920a)",
            color: "#030b18",
            border: 0,
            padding: "13px 32px",
            borderRadius: 12,
            fontWeight: 900,
            fontSize: 15,
            fontFamily: "var(--condensed)",
            letterSpacing: 0.5,
            position: "relative",
            overflow: "hidden",
            cursor: "pointer",
          }}
        >
          {/* Barra de progreso de fondo: al llenarse (4s) avanza solo */}
          {hasNextPack && allRevealed && (
            <div style={{
              position: "absolute", inset: 0,
              background: "rgba(255,255,255,.4)",
              transformOrigin: "left",
              animation: "packNextFill 4s linear both",
              pointerEvents: "none",
            }} />
          )}
          <span style={{ position: "relative" }}>
            {hasNextPack ? t.pack_next : t.pack_paste}
          </span>
        </button>

        {/* Modo multi-sobre: saltear los sobres restantes */}
        {onSkipAll && totalPacks && packIndex && packIndex < totalPacks && (
          <div style={{ marginTop: 10 }}>
            <button
              onClick={onSkipAll}
              style={{
                background: "transparent",
                border: "1px solid var(--line)",
                color: "var(--muted)",
                padding: "7px 18px",
                borderRadius: 8,
                fontWeight: 900,
                fontSize: 11,
                fontFamily: "var(--condensed)",
                letterSpacing: 0.5,
                cursor: "pointer",
              }}
            >
              {lang === "en" ? "Skip all packs ⏭" : "Saltear todos los sobres ⏭"}
            </button>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

function Hexagon() {
  return (
    <svg width="90" height="90" viewBox="0 0 90 90" fill="none">
      <polygon
        points="45,4 82,24 82,66 45,86 8,66 8,24"
        stroke="rgba(232,185,35,0.5)"
        strokeWidth="2"
        fill="rgba(232,185,35,0.08)"
      />
      <polygon
        points="45,12 76,29 76,62 45,79 14,62 14,29"
        stroke="rgba(232,185,35,0.25)"
        strokeWidth="1"
        fill="none"
      />
    </svg>
  );
}
