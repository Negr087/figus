export type LacryptaEmailLoginRequest = {
  email: string;
  redirectTo?: string;
};

export type LacryptaEmailLoginConsumeResponse = {
  nsec: string;
  pubkey: string;
  redirectTo: string;
};

const DEFAULT_API_BASE = "https://lacrypta.dev";
const CALLBACK_PATH = "/auth/lacrypta-email";

function apiBase(): string {
  return (
    process.env.NEXT_PUBLIC_LACRYPTA_EMAIL_LOGIN_API_BASE ??
    DEFAULT_API_BASE
  ).replace(/\/+$/u, "");
}

export function lacryptaEmailLoginCallbackUrl(): string {
  if (typeof window === "undefined") return CALLBACK_PATH;
  return new URL(CALLBACK_PATH, window.location.origin).toString();
}

export function currentLacryptaEmailRedirect(fallback = "/"): string {
  if (typeof window === "undefined") return fallback;
  return safeLocalRedirect(
    `${window.location.pathname}${window.location.search}${window.location.hash}`,
    fallback,
  );
}

export function safeLocalRedirect(value: unknown, fallback = "/"): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate) return fallback;
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return fallback;
  if (candidate === "/api" || candidate.startsWith("/api/")) return fallback;
  if (/[\u0000-\u001f\u007f]/u.test(candidate)) return fallback;
  return candidate;
}

export async function requestLacryptaEmailLogin({
  email,
  redirectTo = currentLacryptaEmailRedirect(),
}: LacryptaEmailLoginRequest): Promise<void> {
  const res = await fetch(`${apiBase()}/api/auth/email/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      callbackUrl: lacryptaEmailLoginCallbackUrl(),
      email,
      redirectTo: safeLocalRedirect(redirectTo),
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? "Could not send the login email.");
  }
}

export async function consumeLacryptaEmailLogin(
  token: string,
): Promise<LacryptaEmailLoginConsumeResponse> {
  const res = await fetch(`${apiBase()}/api/auth/email/consume`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const data = (await res.json().catch(() => ({}))) as
    | LacryptaEmailLoginConsumeResponse
    | { error?: string };
  if (!res.ok || !("nsec" in data) || !("pubkey" in data)) {
    throw new Error("error" in data ? data.error : "Could not consume the login token.");
  }
  return data;
}
