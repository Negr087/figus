import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Figus — Álbum Mundial sobre Nostr",
  description:
    "Álbum de figuritas del Mundial nativo de Nostr + Lightning. Conseguí, cambiá y completá con zaps.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Bungee&family=Roboto+Condensed:wght@400;700;900&family=Sora:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
        <link rel="icon" type="image/webp" href="/logomundial.webp" />
        <link rel="apple-touch-icon" href="/logomundial.webp" />
      </head>
      <body>{children}</body>
    </html>
  );
}
