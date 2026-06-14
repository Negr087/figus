import { NextRequest, NextResponse } from "next/server";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { createMagicToken } from "@/lib/magicToken";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.MAGIC_FROM_EMAIL ?? "Figus <noreply@figus.lacrypta.dev>";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export async function POST(req: NextRequest) {
  let email: string;
  try {
    const body = (await req.json()) as { email?: string };
    email = (body.email ?? "").trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Email inválido" }, { status: 400 });
  }

  if (!RESEND_API_KEY) {
    return NextResponse.json({ error: "Email no configurado en el servidor" }, { status: 503 });
  }

  const sk = generateSecretKey();
  const skHex = Buffer.from(sk).toString("hex");
  const pubkey = getPublicKey(sk);
  const token = createMagicToken(skHex, pubkey);
  const magicLink = `${SITE_URL}/auth/magic?token=${encodeURIComponent(token)}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;background:#030b18;color:#e8e8e8;padding:40px 20px;text-align:center">
  <div style="max-width:480px;margin:0 auto">
    <div style="font-size:40px;margin-bottom:16px">⚽</div>
    <h1 style="color:#e8b923;font-size:24px;margin:0 0 8px">Figus Mundial 2026</h1>
    <p style="color:#aaa;margin:0 0 32px">Tu enlace mágico para entrar</p>
    <a href="${magicLink}"
       style="display:inline-block;background:#e8b923;color:#030b18;font-weight:900;font-size:16px;padding:14px 32px;border-radius:10px;text-decoration:none;letter-spacing:0.5px">
      ENTRAR A FIGUS →
    </a>
    <p style="color:#666;font-size:12px;margin-top:32px">
      Este enlace expira en 15 minutos.<br>
      Si no lo pediste vos, ignorá este correo.
    </p>
  </div>
</body>
</html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: email, subject: "Tu enlace mágico para Figus", html }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[magic-link] Resend error:", err);
    return NextResponse.json({ error: "No se pudo enviar el correo. Intentá de nuevo." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
