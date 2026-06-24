import { nip19, type EventTemplate } from "nostr-tools";
import type { Identity } from "./identity";
import { encryptDM, signEvent } from "./identity";
import { getPool, getRelays } from "./pool";
import { SITE_URL } from "./share";

export async function sendDM(
  identity: Identity,
  recipientPubkey: string,
  message: string
): Promise<void> {
  const encrypted = await encryptDM(recipientPubkey, message, identity.mode);
  const template: EventTemplate = {
    kind: 4,
    created_at: Math.floor(Date.now() / 1000),
    content: encrypted,
    tags: [["p", recipientPubkey]],
  };
  const signed = await signEvent(template, identity.mode);
  await Promise.any(getPool().publish(getRelays(), signed));
}

export function dmNewChallenge(challengerPubkey: string): string {
  const npub = nip19.npubEncode(challengerPubkey);
  return `⚽ ¡nostr:${npub} te desafió a una tanda de penales en el álbum del Mundial 2026!\n\nEntrá a aceptar el desafío: ${SITE_URL}#game`;
}

export function dmYourTurn(): string {
  return `⚽ ¡Es tu turno de patear en la tanda de penales!\n\nEntrá a jugar: ${SITE_URL}#game`;
}

export function dmTournamentStart(startAtUnixSeconds: number): string {
  const mins = Math.round((startAtUnixSeconds * 1000 - Date.now()) / 60000);
  const when = mins <= 6
    ? "¡arranca en minutos!"
    : `arranca el ${new Date(startAtUnixSeconds * 1000).toLocaleString("es-AR", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
      })} ART`;
  return `🏆 ¡El Torneo de Penales ${when}\n\nTodos los jugadores están inscriptos. Entrá para estar listo: ${SITE_URL}#tournament`;
}
