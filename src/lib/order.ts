import type { Event, EventTemplate } from "nostr-tools";
import { KIND, ISSUER_PUBKEY } from "./constants";
import { getPool, getRelays, subscribe } from "./pool";
import { signEvent, type SignerMode } from "./identity";
import { getNwcString, nwcPay } from "./nwc";

/**
 * Flujo de orden (Fix #1 · Opción A — lado cliente).
 *
 * En vez de hacer un zap a una Lightning Address (que el issuer no puede verificar),
 * el cliente publica un ORDER_REQUEST firmado y espera que el issuer responda con un
 * ORDER_INVOICE que contiene un bolt11 EMITIDO POR EL PROPIO ISSUER. El issuer cobra
 * esa factura en su wallet y solo entonces concede las figuritas (GRANT/SETTLEMENT).
 */

export type OrderAction = "open-pack" | "open-pack-10" | "buy-sticker";

export interface OrderInvoice {
  invoice: string;
  paymentHash: string;
  amountSats: number;
}

// Publica el ORDER_REQUEST y resuelve cuando llega el ORDER_INVOICE del issuer.
export async function requestOrderInvoice(opts: {
  action: OrderAction;
  extraTags?: string[][];
  signerMode: SignerMode;
  timeoutMs?: number;
}): Promise<OrderInvoice> {
  const template: EventTemplate = {
    kind: KIND.ORDER_REQUEST,
    created_at: Math.floor(Date.now() / 1000),
    content: "",
    tags: [["figus-action", opts.action], ...(opts.extraTags ?? [])],
  };
  const signed = await signEvent(template, opts.signerMode);

  return new Promise<OrderInvoice>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsub();
      reject(new Error("El issuer no respondió con la factura. Verificá que esté corriendo."));
    }, opts.timeoutMs ?? 30_000);

    const unsub = subscribe(
      [{ kinds: [KIND.ORDER_INVOICE], authors: [ISSUER_PUBKEY], "#e": [signed.id] }],
      (ev: Event) => {
        const errorMsg = ev.tags.find((t) => t[0] === "error")?.[1];
        if (errorMsg) {
          clearTimeout(timeout);
          unsub();
          reject(new Error(errorMsg));
          return;
        }
        const invoice = ev.tags.find((t) => t[0] === "bolt11")?.[1];
        const paymentHash = ev.tags.find((t) => t[0] === "payment_hash")?.[1];
        const amountSats = Number(ev.tags.find((t) => t[0] === "amount")?.[1] ?? "0");
        if (!invoice || !paymentHash) return;
        clearTimeout(timeout);
        unsub();
        resolve({ invoice, paymentHash, amountSats });
      }
    );

    // Publicar DESPUÉS de suscribirse, para no perder la respuesta.
    Promise.any(getPool().publish(getRelays(), signed)).catch(() => {});
  });
}

// Intenta pagar el invoice con WebLN y luego NWC. Devuelve true si lo pagó.
// Si no, el caller debe mostrar el invoice para pago manual (QR).
export async function tryPayInvoice(invoice: string): Promise<boolean> {
  if (typeof window !== "undefined" && window.webln) {
    try {
      const weblnTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("webln timeout")), 8_000)
      );
      await window.webln.enable();
      await Promise.race([window.webln.sendPayment(invoice), weblnTimeout]);
      return true;
    } catch { /* seguimos con NWC */ }
  }

  const nwcStr = getNwcString();
  if (nwcStr) {
    try {
      const nwcTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("nwc timeout")), 12_000)
      );
      await Promise.race([nwcPay(invoice, nwcStr), nwcTimeout]);
      return true;
    } catch { /* mostrar invoice manual */ }
  }

  return false;
}
