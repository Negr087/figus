import { Suspense } from "react";
import LacryptaEmailLoginClient from "./LacryptaEmailLoginClient";

export default function LacryptaEmailLoginPage() {
  return (
    <Suspense fallback={<Shell message="Starting session..." />}>
      <LacryptaEmailLoginClient />
    </Suspense>
  );
}

function Shell({ message }: { message: string }) {
  return (
    <main style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      textAlign: "center",
    }}>
      <p>{message}</p>
    </main>
  );
}
