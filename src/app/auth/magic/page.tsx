import { verifyMagicToken } from "@/lib/magicToken";
import { MagicLinkClient } from "./MagicLinkClient";

export default function MagicPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token = searchParams.token;

  if (!token) {
    return <ErrorPage title="Enlace inválido" msg="No se encontró el token en el enlace." />;
  }

  const data = verifyMagicToken(token);
  if (!data) {
    return <ErrorPage title="Enlace expirado" msg="Este enlace ya expiró o es inválido. Solicitá uno nuevo desde la app." />;
  }

  return <MagicLinkClient skHex={data.sk} />;
}

function ErrorPage({ title, msg }: { title: string; msg: string }) {
  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#030b18", color: "#e8e8e8", fontFamily: "sans-serif", textAlign: "center",
      padding: 24,
    }}>
      <div>
        <div style={{ fontSize: 40, marginBottom: 16 }}>❌</div>
        <h1 style={{ color: "#e8b923", fontSize: 20, marginBottom: 8 }}>{title}</h1>
        <p style={{ color: "#888", fontSize: 14, marginBottom: 24 }}>{msg}</p>
        <a href="/" style={{
          display: "inline-block", background: "#e8b923", color: "#030b18",
          fontWeight: 900, padding: "12px 24px", borderRadius: 10,
          textDecoration: "none", fontSize: 14, letterSpacing: 0.5,
        }}>
          VOLVER AL INICIO
        </a>
      </div>
    </div>
  );
}
