"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { Identity } from "@/lib/identity";
import { useProfile } from "@/hooks/useProfile";
import { useLang } from "@/contexts/LangContext";
import { requestLacryptaEmailLogin } from "@/lib/lacryptaEmailLogin";

type NcView = "menu" | "qr" | "bunker" | "connecting";
type Tab = "nostr" | "email";
type EmailState = "idle" | "sending" | "sent" | "error";

export function Connect({
  identity,
  nip07Available,
  onNip07,
  onLocal,
  onLogout,
  onNip46QR,
  onNip46Bunker,
}: {
  identity: Identity | null;
  nip07Available: boolean;
  onNip07: () => void;
  onLocal: () => void;
  onLogout: () => void;
  onNip46QR: (
    onQR: (uri: string, dataUrl: string, expiresAt: number) => void,
    onauth: (url: string) => void,
    signal: AbortSignal
  ) => Promise<void>;
  onNip46Bunker: (url: string, onauth: (url: string) => void) => Promise<void>;
}) {
  const { t } = useLang();
  const profile = useProfile(identity?.pubkey ?? null);
  const [imgError, setImgError] = useState(false);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [tab, setTab] = useState<Tab>("nostr");
  const [ncView, setNcView] = useState<NcView>("menu");
  const [email, setEmail] = useState("");
  const [emailState, setEmailState] = useState<EmailState>("idle");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [qrUri, setQrUri] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrExpiresAt, setQrExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [bunkerUrl, setBunkerUrl] = useState("");
  const [ncError, setNcError] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [mounted, setMounted] = useState(false);

  // Mount flag for portal (SSR safe)
  useEffect(() => { setMounted(true); }, []);

  // Countdown timer
  useEffect(() => {
    if (!qrExpiresAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [qrExpiresAt]);

  // ESC to close + lock body scroll
  useEffect(() => {
    if (!showModal) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") closeModal(); };
    window.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", handler);
    };
  }, [showModal]);

  function closeModal() {
    abortRef.current?.abort();
    abortRef.current = null;
    setShowModal(false);
    setTab("nostr");
    setNcView("menu");
    setQrUri(null);
    setQrDataUrl(null);
    setQrExpiresAt(null);
    setBunkerUrl("");
    setNcError(null);
    setAuthUrl(null);
    setEmail("");
    setEmailState("idle");
    setEmailError(null);
  }

  function switchTab(t: Tab) {
    setTab(t);
    setNcView("menu");
    setNcError(null);
    abortRef.current?.abort();
    abortRef.current = null;
    setQrUri(null);
    setQrDataUrl(null);
  }

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!normalized || emailState === "sending") return;
    setEmailState("sending");
    setEmailError(null);
    try {
      await requestLacryptaEmailLogin({ email: normalized, redirectTo: window.location.hash || "/" });
      setEmailState("sent");
    } catch (err) {
      setEmailState("error");
      setEmailError(err instanceof Error ? err.message : "No se pudo enviar el enlace.");
    }
  }

  async function startQR() {
    setNcView("qr");
    setNcError(null);
    setQrUri(null);
    setQrDataUrl(null);
    setAuthUrl(null);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      await onNip46QR(
        (uri, dataUrl, expiresAt) => {
          setQrUri(uri);
          setQrDataUrl(dataUrl);
          setQrExpiresAt(expiresAt);
        },
        (url) => setAuthUrl(url),
        abort.signal
      );
      closeModal();
    } catch (e: unknown) {
      if (abort.signal.aborted) return;
      const msg = e instanceof Error ? e.message : "No se pudo conectar";
      if (msg.includes("timeout") || msg.includes("AbortError")) {
        setNcView("menu");
        setQrUri(null);
        setQrDataUrl(null);
        return;
      }
      setNcError(msg);
    }
  }

  async function handleBunkerConnect() {
    if (!bunkerUrl.trim()) return;
    setNcView("connecting");
    setNcError(null);
    setAuthUrl(null);
    try {
      await onNip46Bunker(bunkerUrl, (url) => setAuthUrl(url));
      closeModal();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "No se pudo conectar";
      setNcError(msg);
      setNcView("bunker");
    }
  }

  async function copyUri() {
    if (!qrUri) return;
    try {
      await navigator.clipboard.writeText(qrUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
  }

  const remainingMs = qrExpiresAt ? Math.max(0, qrExpiresAt - now) : null;
  const countdown =
    remainingMs !== null
      ? `${Math.floor(remainingMs / 60000)}:${String(
          Math.floor((remainingMs % 60000) / 1000)
        ).padStart(2, "0")}`
      : null;

  // --- Logged in view ---
  if (identity) {
    const displayName = profile?.name
      ? profile.name.length > 16
        ? profile.name.slice(0, 16) + "…"
        : profile.name
      : identity.pubkey.slice(0, 8) + "…";

    const initials = profile?.name
      ? profile.name.slice(0, 2).toUpperCase()
      : identity.pubkey.slice(0, 2).toUpperCase();

    const showImg = profile?.picture && !imgError;

    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{
            width: 30, height: 30, borderRadius: "50%", overflow: "hidden",
            border: "1.5px solid var(--gold)", flexShrink: 0,
            background: "var(--panel2)", display: "flex",
            alignItems: "center", justifyContent: "center",
          }}>
            {showImg ? (
              <img
                src={profile!.picture} alt="" width={30} height={30}
                style={{ objectFit: "cover", width: "100%", height: "100%", display: "block" }}
                onError={() => setImgError(true)}
              />
            ) : (
              <span style={{ fontSize: 11, fontWeight: 900, color: "var(--gold)", fontFamily: "var(--condensed)" }}>
                {initials}
              </span>
            )}
          </div>
          <span style={{
            fontSize: 12, color: "var(--ink)", fontFamily: "var(--condensed)",
            fontWeight: 700, letterSpacing: 0.3, maxWidth: 120,
            overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
          }}>
            {displayName}
          </span>
        </div>
        <button
          onClick={onLogout}
          style={{
            background: "transparent", border: "1px solid var(--line)",
            color: "var(--muted)", padding: "5px 10px", borderRadius: 8,
            fontSize: 11, fontFamily: "var(--condensed)", fontWeight: 700, cursor: "pointer",
          }}
        >
          {t.logout}
        </button>
      </div>
    );
  }

  // --- Logged out view ---
  return (
    <>
      <div style={{ display: "flex", gap: 6 }}>
        {nip07Available && (
          <button onClick={onNip07} style={{
            background: "linear-gradient(135deg,var(--grass),var(--pitch))",
            color: "#fff", border: 0, padding: "8px 14px",
            borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}>
            {t.connect_ext}
          </button>
        )}
        <button
          onClick={() => { setShowModal(true); setNcView("menu"); }}
          style={{
            background: "var(--panel)", border: "1px solid rgba(140,82,255,0.6)",
            color: "rgb(180,130,255)", padding: "8px 14px",
            borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}
        >
          📱 Nostr Connect
        </button>
        <button onClick={onLocal} style={{
          background: "var(--panel)", border: "1px solid var(--gold)",
          color: "var(--gold)", padding: "8px 14px",
          borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
        }}>
          {t.connect_local}
        </button>
      </div>

      {showModal && mounted && createPortal(
        <>
          {/* ── CSS for responsive modal ── */}
          <style>{`
            @keyframes nc-spin { to { transform: rotate(360deg); } }
            @keyframes nc-ping {
              0%,100% { opacity:1; transform:scale(1); }
              50%      { opacity:.4; transform:scale(1.5); }
            }
            @keyframes nc-slide-up {
              from { transform: translateY(40px); opacity:0; }
              to   { transform: translateY(0);    opacity:1; }
            }

            .nc-overlay {
              position: fixed; inset: 0; z-index: 200;
              display: flex; align-items: center; justify-content: center;
              padding: 16px;
            }
            .nc-modal {
              position: relative; width: 100%; max-width: 420px;
              background: var(--panel);
              border: 1px solid rgba(140,82,255,.5);
              border-radius: 16px;
              display: flex; flex-direction: column;
              max-height: 90vh;
              overflow: hidden;
              box-shadow: 0 24px 64px rgba(0,0,0,.7);
              animation: nc-slide-up .22s ease;
            }
            .nc-modal-body {
              overflow-y: auto;
              flex: 1;
              min-height: 0;
              padding: 20px;
              -webkit-overflow-scrolling: touch;
            }
            /* Mobile: bottom sheet */
            @media (max-width: 600px) {
              .nc-overlay {
                align-items: flex-end;
                padding: 0;
              }
              .nc-modal {
                max-width: 100%;
                border-radius: 20px 20px 0 0;
                border-bottom: none;
                max-height: 92vh;
              }
              .nc-modal-body {
                padding-bottom: calc(20px + env(safe-area-inset-bottom));
              }
            }
          `}</style>

          <div className="nc-overlay">
            {/* Backdrop */}
            <div
              onClick={closeModal}
              style={{
                position: "absolute", inset: 0,
                background: "rgba(0,0,0,0.82)",
                backdropFilter: "blur(6px)",
              }}
            />

            <div className="nc-modal">
              {/* ── HEADER (sticky) ── */}
              <div style={{
                display: "flex", alignItems: "center",
                justifyContent: "space-between",
                padding: "16px 20px",
                borderBottom: "1px solid var(--line)",
                flexShrink: 0,
              }}>
                {/* Drag handle on mobile */}
                <div style={{
                  position: "absolute", top: 8, left: "50%",
                  transform: "translateX(-50%)",
                  width: 36, height: 4,
                  background: "var(--line)", borderRadius: 99,
                }} />

                {ncView !== "menu" ? (
                  <button
                    onClick={() => {
                      abortRef.current?.abort();
                      abortRef.current = null;
                      setNcView("menu");
                      setNcError(null);
                      setAuthUrl(null);
                      setQrUri(null);
                      setQrDataUrl(null);
                    }}
                    style={{
                      background: "transparent", border: "none",
                      color: "var(--muted)", cursor: "pointer",
                      fontSize: 13, display: "flex",
                      alignItems: "center", gap: 4, padding: 0,
                    }}
                  >
                    ← Volver
                  </button>
                ) : (
                  <div style={{ display: "flex", gap: 3, background: "rgba(255,255,255,.05)", borderRadius: 10, padding: 3 }}>
                    {(["nostr", "email"] as Tab[]).map((t) => {
                      const active = tab === t;
                      return (
                        <button
                          key={t}
                          onClick={() => switchTab(t)}
                          style={{
                            flex: 1, padding: "6px 14px", border: "none", cursor: "pointer",
                            borderRadius: 8, fontFamily: "var(--condensed)", fontWeight: 900,
                            fontSize: 12, letterSpacing: 0.5,
                            background: active
                              ? (t === "nostr" ? "rgba(140,82,255,0.3)" : "rgba(232,185,35,0.2)")
                              : "transparent",
                            color: active
                              ? (t === "nostr" ? "rgb(200,160,255)" : "var(--gold)")
                              : "var(--muted)",
                            outline: active
                              ? `1px solid ${t === "nostr" ? "rgba(140,82,255,0.5)" : "rgba(232,185,35,0.4)"}`
                              : "none",
                          }}
                        >
                          {t === "nostr" ? "🔐 NOSTR" : "✉ CORREO"}
                        </button>
                      );
                    })}
                  </div>
                )}

                <button
                  onClick={closeModal}
                  style={{
                    background: "transparent", border: "none",
                    color: "var(--muted)", fontSize: 22,
                    cursor: "pointer", lineHeight: 1, padding: "0 0 0 8px",
                  }}
                >
                  ×
                </button>
              </div>

              {/* ── SCROLLABLE BODY ── */}
              <div className="nc-modal-body">

                {/* EMAIL */}
                {ncView === "menu" && tab === "email" && (
                  <form onSubmit={handleEmailLogin} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <p style={{ fontSize: 13, color: "var(--muted)", margin: 0, lineHeight: 1.6 }}>
                      Ingresá tu correo y te mandamos un enlace mágico.
                      Al abrirlo entrás automáticamente con una clave temporal.
                    </p>
                    <div>
                      <label style={{
                        display: "block", fontSize: 11, fontWeight: 700,
                        color: "var(--muted)", fontFamily: "var(--condensed)",
                        letterSpacing: 0.5, marginBottom: 6,
                      }}>
                        CORREO ELECTRÓNICO
                      </label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="vos@ejemplo.com"
                        disabled={emailState === "sending" || emailState === "sent"}
                        style={{
                          width: "100%", padding: "11px 14px",
                          background: "rgba(255,255,255,0.03)",
                          border: "1px solid var(--line)",
                          borderRadius: 10, color: "var(--ink)",
                          fontSize: 14, boxSizing: "border-box",
                          outline: "none",
                        }}
                        onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(232,185,35,0.6)")}
                        onBlur={(e) => (e.currentTarget.style.borderColor = "var(--line)")}
                      />
                    </div>

                    {emailState === "sent" && (
                      <div style={{
                        padding: "12px 14px",
                        background: "rgba(50,200,100,0.1)",
                        border: "1px solid rgba(50,200,100,0.35)",
                        borderRadius: 10, fontSize: 13, color: "#6dde9e",
                        lineHeight: 1.5,
                      }}>
                        ✅ Revisá tu correo. El enlace expira en 15 minutos.
                      </div>
                    )}

                    {emailState === "error" && emailError && (
                      <ErrorBox msg={emailError} />
                    )}

                    <button
                      type="submit"
                      disabled={emailState === "sending" || !email.trim()}
                      style={{
                        padding: "13px 16px",
                        background: emailState === "sent"
                          ? "rgba(50,200,100,0.15)"
                          : "linear-gradient(135deg,rgba(232,185,35,0.8),rgba(200,140,20,0.8))",
                        border: emailState === "sent"
                          ? "1px solid rgba(50,200,100,0.4)"
                          : "1px solid rgba(232,185,35,0.7)",
                        borderRadius: 10,
                        color: emailState === "sent" ? "#6dde9e" : "#030b18",
                        fontWeight: 900, fontSize: 14,
                        fontFamily: "var(--condensed)", letterSpacing: 0.5,
                        cursor: (emailState === "sending" || !email.trim()) ? "not-allowed" : "pointer",
                        opacity: (emailState === "sending" || !email.trim()) ? 0.5 : 1,
                      }}
                    >
                      {emailState === "sending"
                        ? "ENVIANDO…"
                        : emailState === "sent"
                        ? "REENVIAR ENLACE →"
                        : "ENVIAR ENLACE MÁGICO →"}
                    </button>
                  </form>
                )}

                {/* MENU */}
                {ncView === "menu" && tab === "nostr" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <p style={{ fontSize: 13, color: "var(--muted)", margin: 0, lineHeight: 1.6 }}>
                      Usá tu firmante Nostr desde el celular sin exponer tu clave.
                      Compatible con{" "}
                      <strong style={{ color: "var(--ink)" }}>Amber</strong> (Android),{" "}
                      <strong style={{ color: "var(--ink)" }}>nsec.app</strong> y cualquier app NIP-46.
                    </p>

                    <button
                      onClick={startQR}
                      style={{
                        display: "flex", alignItems: "center", gap: 14,
                        padding: "16px", width: "100%", textAlign: "left",
                        background: "rgba(140,82,255,0.08)",
                        border: "1px solid rgba(140,82,255,0.4)",
                        borderRadius: 12, cursor: "pointer",
                      }}
                    >
                      <span style={{ fontSize: 32, lineHeight: 1, flexShrink: 0 }}>📷</span>
                      <div>
                        <div style={{
                          fontSize: 14, fontWeight: 700,
                          color: "rgb(200,160,255)",
                          fontFamily: "var(--condensed)", letterSpacing: 0.5,
                        }}>
                          ESCANEAR QR
                        </div>
                        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
                          Abrí Amber o nsec.app y escaneá el código QR
                        </div>
                      </div>
                    </button>

                    <button
                      onClick={() => setNcView("bunker")}
                      style={{
                        display: "flex", alignItems: "center", gap: 14,
                        padding: "16px", width: "100%", textAlign: "left",
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid var(--line)",
                        borderRadius: 12, cursor: "pointer",
                      }}
                    >
                      <span style={{ fontSize: 32, lineHeight: 1, flexShrink: 0 }}>🔗</span>
                      <div>
                        <div style={{
                          fontSize: 14, fontWeight: 700,
                          color: "var(--ink)",
                          fontFamily: "var(--condensed)", letterSpacing: 0.5,
                        }}>
                          URL BUNKER
                        </div>
                        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
                          Pegá tu <code style={{ fontSize: 11 }}>bunker://</code> o NIP-05
                        </div>
                      </div>
                    </button>

                    <p style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", margin: "4px 0 0" }}>
                      NIP-46 · tu clave privada nunca sale de tu dispositivo
                    </p>
                  </div>
                )}

                {/* QR */}
                {ncView === "qr" && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{
                        fontSize: 15, fontWeight: 700,
                        color: "var(--ink)", fontFamily: "var(--condensed)",
                      }}>
                        ESCANEÁ CON TU FIRMANTE
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                        Abrí Amber, nsec.app o cualquier firmante NIP-46
                      </div>
                    </div>

                    {/* QR box — responsive width */}
                    <div style={{
                      background: "#030b18",
                      border: "2px solid rgba(140,82,255,0.4)",
                      borderRadius: 12, padding: 8,
                      width: "min(264px, 100%)",
                      aspectRatio: "1",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {qrDataUrl ? (
                        <img
                          src={qrDataUrl} alt="nostrconnect QR"
                          style={{ width: "100%", height: "100%", display: "block" }}
                        />
                      ) : qrUri ? (
                        // Canvas blocked (LibreWolf / Tor Browser) — show URI as text
                        <div style={{ padding: "12px 8px", textAlign: "center" }}>
                          <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 8, fontFamily: "var(--condensed)", letterSpacing: 1 }}>
                            QR no disponible — copiá el URI
                          </div>
                          <div style={{
                            fontSize: 9, color: "var(--gold)", wordBreak: "break-all",
                            fontFamily: "monospace", lineHeight: 1.5,
                          }}>
                            {qrUri.slice(0, 120)}…
                          </div>
                        </div>
                      ) : (
                        <div style={{ color: "var(--gold)", fontSize: 13 }}>Generando…</div>
                      )}
                    </div>

                    {/* "Abrir en Amber" deep link */}
                    {qrUri && (
                      <a
                        href={qrUri}
                        style={{
                          display: "flex", alignItems: "center",
                          justifyContent: "center", gap: 8,
                          width: "100%", padding: "13px 16px",
                          background: "linear-gradient(135deg,rgba(140,82,255,0.25),rgba(80,40,180,0.25))",
                          border: "1px solid rgba(140,82,255,0.5)",
                          borderRadius: 10,
                          color: "rgb(200,160,255)",
                          fontWeight: 700, fontSize: 14,
                          fontFamily: "var(--condensed)", letterSpacing: 0.5,
                          textDecoration: "none",
                        }}
                      >
                        📱 ABRIR EN AMBER
                      </a>
                    )}

                    {/* Status + countdown */}
                    <div style={{
                      display: "flex", alignItems: "center",
                      gap: 10, fontSize: 11, flexWrap: "wrap",
                      justifyContent: "center",
                    }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        color: "rgb(100,220,200)",
                        fontFamily: "var(--condensed)", fontWeight: 700, letterSpacing: 0.5,
                      }}>
                        <span style={{
                          width: 7, height: 7, borderRadius: "50%",
                          background: "rgb(100,220,200)",
                          display: "inline-block",
                          animation: "nc-ping 1.5s ease-in-out infinite",
                        }} />
                        ESPERANDO FIRMANTE…
                      </span>
                      {countdown && (
                        <span style={{ color: "var(--muted)" }}>
                          expira en{" "}
                          <span style={{
                            color: remainingMs !== null && remainingMs < 30_000 ? "#ff6b6b" : "var(--ink)",
                            fontWeight: 700,
                          }}>
                            {countdown}
                          </span>
                        </span>
                      )}
                    </div>

                    {/* Copy URI */}
                    {qrUri && (
                      <button
                        onClick={copyUri}
                        style={{
                          display: "flex", alignItems: "center",
                          justifyContent: "space-between",
                          width: "100%", padding: "8px 12px",
                          background: "rgba(255,255,255,0.03)",
                          border: "1px solid var(--line)",
                          borderRadius: 8, cursor: "pointer", gap: 8,
                        }}
                      >
                        <span style={{
                          fontFamily: "monospace", fontSize: 10,
                          color: "var(--muted)", overflow: "hidden",
                          textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {qrUri.slice(0, 55)}…
                        </span>
                        <span style={{ fontSize: 14, flexShrink: 0 }}>
                          {copied ? "✅" : "📋"}
                        </span>
                      </button>
                    )}

                    {authUrl && (
                      <a
                        href={authUrl} target="_blank" rel="noopener noreferrer"
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6,
                          padding: "9px 16px",
                          background: "rgba(140,82,255,0.12)",
                          border: "1px solid rgba(140,82,255,0.4)",
                          borderRadius: 8, color: "rgb(180,130,255)",
                          fontSize: 12, fontWeight: 700, textDecoration: "none",
                        }}
                      >
                        Autorizar en el firmante →
                      </a>
                    )}

                    {ncError && <ErrorBox msg={ncError} />}
                  </div>
                )}

                {/* BUNKER URL */}
                {ncView === "bunker" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div>
                      <div style={{
                        fontSize: 15, fontWeight: 700,
                        color: "var(--ink)", fontFamily: "var(--condensed)",
                      }}>
                        CONECTÁ TU BUNKER
                      </div>
                      <p style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 0", lineHeight: 1.6 }}>
                        Pegá la URL <code style={{ color: "rgb(100,220,200)", fontSize: 11 }}>bunker://</code> de
                        tu firmante remoto, o un NIP-05 como{" "}
                        <code style={{ color: "var(--muted)", fontSize: 11 }}>usuario@nsec.app</code>.
                      </p>
                    </div>

                    <div>
                      <label style={{
                        display: "block", fontSize: 11, fontWeight: 700,
                        color: "var(--muted)", fontFamily: "var(--condensed)",
                        letterSpacing: 0.5, marginBottom: 6,
                      }}>
                        URL DEL BUNKER
                      </label>
                      <textarea
                        value={bunkerUrl}
                        onChange={(e) => setBunkerUrl(e.target.value)}
                        placeholder={"bunker://abc123...@relay.nsec.app?secret=xyz\n— o —\nusuario@nsec.app"}
                        rows={3}
                        style={{
                          width: "100%", padding: "10px 12px",
                          background: "rgba(255,255,255,0.03)",
                          border: "1px solid var(--line)",
                          borderRadius: 10, color: "var(--ink)",
                          fontSize: 12, fontFamily: "monospace",
                          resize: "vertical", boxSizing: "border-box",
                          outline: "none", lineHeight: 1.5,
                        }}
                        onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(140,82,255,0.6)")}
                        onBlur={(e) => (e.currentTarget.style.borderColor = "var(--line)")}
                      />
                    </div>

                    {ncError && <ErrorBox msg={ncError} />}

                    <button
                      onClick={handleBunkerConnect}
                      disabled={!bunkerUrl.trim()}
                      style={{
                        padding: "13px 16px",
                        background: "linear-gradient(135deg,rgba(140,82,255,0.5),rgba(80,40,180,0.5))",
                        border: "1px solid rgba(140,82,255,0.6)",
                        borderRadius: 10, color: "rgb(220,190,255)",
                        fontWeight: 900, fontSize: 14,
                        fontFamily: "var(--condensed)", letterSpacing: 0.5,
                        cursor: bunkerUrl.trim() ? "pointer" : "not-allowed",
                        opacity: bunkerUrl.trim() ? 1 : 0.5,
                      }}
                    >
                      CONECTAR →
                    </button>

                    <p style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", margin: 0 }}>
                      Compatible con Amber, nsec.app, nsecBunker y más
                    </p>
                  </div>
                )}

                {/* CONNECTING */}
                {ncView === "connecting" && (
                  <div style={{
                    display: "flex", flexDirection: "column",
                    alignItems: "center", gap: 18, padding: "24px 0",
                  }}>
                    <div style={{
                      width: 52, height: 52, borderRadius: "50%",
                      border: "3px solid rgba(140,82,255,0.2)",
                      borderTop: "3px solid rgba(140,82,255,0.9)",
                      animation: "nc-spin 0.8s linear infinite",
                    }} />
                    <div style={{ textAlign: "center" }}>
                      <div style={{
                        fontSize: 15, fontWeight: 700,
                        color: "var(--ink)", fontFamily: "var(--condensed)",
                      }}>
                        CONECTANDO…
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                        Esperando confirmación de tu firmante remoto
                      </div>
                    </div>
                    {authUrl && (
                      <a
                        href={authUrl} target="_blank" rel="noopener noreferrer"
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6,
                          padding: "9px 16px",
                          background: "rgba(140,82,255,0.12)",
                          border: "1px solid rgba(140,82,255,0.4)",
                          borderRadius: 8, color: "rgb(180,130,255)",
                          fontSize: 12, fontWeight: 700, textDecoration: "none",
                        }}
                      >
                        Autorizar en el firmante →
                      </a>
                    )}
                  </div>
                )}
              </div>

              {/* ── FOOTER (sticky) ── */}
              <div style={{
                padding: "11px 20px",
                borderTop: "1px solid var(--line)",
                background: "rgba(0,0,0,0.25)",
                textAlign: "center", flexShrink: 0,
              }}>
                <span style={{
                  fontSize: 10, color: "var(--muted)",
                  fontFamily: "var(--condensed)", letterSpacing: 0.5,
                }}>
                  {tab === "email" && ncView === "menu"
                    ? "AL INGRESAR ACEPTÁS NUESTROS TÉRMINOS · TU CLAVE QUEDA EN ESTE DISPOSITIVO"
                    : "NIP-46 · TU CLAVE PRIVADA NUNCA SALE DE TU DISPOSITIVO"}
                </span>
              </div>
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div style={{
      width: "100%", padding: "10px 14px",
      background: "rgba(255,80,80,0.1)",
      border: "1px solid rgba(255,80,80,0.3)",
      borderRadius: 8, fontSize: 12, color: "#ff9999",
    }}>
      {msg}
    </div>
  );
}
