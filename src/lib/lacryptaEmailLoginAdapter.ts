"use client";

import { importLocalNsec } from "@/lib/identity";
import type { LacryptaEmailLoginConsumeResponse } from "./lacryptaEmailLogin";

export async function persistLacryptaEmailIdentity(
  data: LacryptaEmailLoginConsumeResponse,
) {
  importLocalNsec(data.nsec);
}
