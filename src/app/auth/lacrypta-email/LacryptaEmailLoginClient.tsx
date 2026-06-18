"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  consumeLacryptaEmailLogin,
  safeLocalRedirect,
} from "@/lib/lacryptaEmailLogin";
import { persistLacryptaEmailIdentity } from "@/lib/lacryptaEmailLoginAdapter";

export default function LacryptaEmailLoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("Iniciando sesión…");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const token = searchParams.get("token")?.trim();
    const fallbackRedirect = safeLocalRedirect(searchParams.get("next"), "/");
    if (!token) {
      setMessage("No se encontró el token en el enlace.");
      setFailed(true);
      return;
    }

    async function run() {
      try {
        const data = await consumeLacryptaEmailLogin(token!);
        await persistLacryptaEmailIdentity(data);
        if (cancelled) return;
        setMessage("¡Sesión iniciada! Redirigiendo…");
        router.replace(safeLocalRedirect(data.redirectTo, fallbackRedirect));
      } catch (error) {
        if (cancelled) return;
        setMessage(error instanceof Error ? error.message : "No se pudo iniciar la sesión.");
        setFailed(true);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#030b18", color: "#e8e8e8", fontFamily: "sans-serif", textAlign: "center",
      padding: 24,
    }}>
      <div>
        <div style={{ fontSize: 40, marginBottom: 16 }}>{failed ? "❌" : "📨"}</div>
        <h1 style={{ color: "#e8b923", fontSize: 20, marginBottom: 8 }}>
          {failed ? "Enlace inválido" : "Conectando"}
        </h1>
        <p style={{ color: "#888", fontSize: 14, marginBottom: 24 }}>{message}</p>
        {failed && (
          <a href="/" style={{
            display: "inline-block", background: "#e8b923", color: "#030b18",
            fontWeight: 900, padding: "12px 24px", borderRadius: 10,
            textDecoration: "none", fontSize: 14, letterSpacing: 0.5,
          }}>
            VOLVER AL INICIO
          </a>
        )}
      </div>
    </div>
  );
}
