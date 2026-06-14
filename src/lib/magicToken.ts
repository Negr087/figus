import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

const SECRET = process.env.MAGIC_SECRET ?? "dev-secret-change-me-in-production";
const TTL_MS = 15 * 60 * 1000; // 15 minutes

export function createMagicToken(skHex: string, pubkey: string): string {
  const payload = Buffer.from(
    JSON.stringify({ sk: skHex, pubkey, exp: Date.now() + TTL_MS })
  ).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyMagicToken(token: string): { sk: string; pubkey: string } | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", SECRET).update(payload).digest("base64url");
  try {
    if (!timingSafeEqual(Buffer.from(sig, "base64url"), Buffer.from(expected, "base64url")))
      return null;
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      sk: string;
      pubkey: string;
      exp: number;
    };
    if (data.exp < Date.now()) return null;
    if (typeof data.sk !== "string" || typeof data.pubkey !== "string") return null;
    return { sk: data.sk, pubkey: data.pubkey };
  } catch {
    return null;
  }
}
