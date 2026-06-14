"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function MagicLinkClient({ skHex }: { skHex: string }) {
  const router = useRouter();
  const [done, setDone] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem("figus:sk", skHex);
      localStorage.setItem("figus:mode", "local");
    } catch { /* noop */ }
    setDone(true);
    router.replace("/");
  }, [skHex, router]);

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#030b18", color: "#e8e8e8", fontFamily: "sans-serif", textAlign: "center",
    }}>
      <div>
        <div style={{ fontSize: 40, marginBottom: 16 }}>⚽</div>
        <div style={{ color: "#e8b923", fontWeight: 900, fontSize: 18, letterSpacing: 1 }}>
          {done ? "Redirigiendo…" : "Iniciando sesión…"}
        </div>
      </div>
    </div>
  );
}
