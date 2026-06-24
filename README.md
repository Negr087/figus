# Figus — Álbum del Mundial 2026 en Nostr

Álbum de figuritas del FIFA World Cup 2026™ construido sobre Nostr + Lightning. Sin base de datos — todo el estado vive en los relays (o en el disco durable del issuer para lo que necesita persistencia entre deploys). Desplegado en [figus.lacrypta.dev](https://figus.lacrypta.dev).

![Figus Mundial 2026](public/screenshot.png)

## Características

- **Sobres** — comprá paquetes de 7 figuritas al azar por 21 sats vía Lightning (NIP-57). El primer sobre es gratis.
- **Colección** — visualizá tu álbum con animaciones foil/shiny y un efecto de pasaje de página estilo revista (sombra de papel + lift 3D), filtrá por equipo y rareza, buscador de equipos.
- **Mercado P2P** — listá y comprá figuritas repetidas directamente entre usuarios, liquidado por zap.
- **Fixture** — calendario completo del Mundial 2026: fase de grupos (MD1–MD3) y eliminatorias (Ronda de 32 → Gran Final) con horarios en UTC y hora Argentina, y **tabla de posiciones en tiempo real** por grupo (datos en vivo de football-data.org).
- **Pronósticos** — predecí resultados de cada partido; los pronós se publican como eventos Nostr (kind 30302) y se actualizan automáticamente.
- **Penales 3D** — minijuego de penales con cancha WebGL. Si convertís, ganás un sobre gratis.
- **Penales P2P** — desafiá a otros usuarios a tandas de penales. **El ganador le roba una figurita aleatoria al perdedor** — el resultado queda grabado en Nostr.
- **Torneo de penales** — torneo de 8 jugadores con fase de grupos (todos contra todos), semifinales y final, con commit-reveal anti-trampa para cada tiro. El creador elige fecha y hora de inicio al inscribirse; el torneo arranca cuando se completa el cupo **o** llega esa hora, lo que pase después. Semifinal a 4 penales c/u, final a 5 c/u (formato mundialista) antes de muerte súbita. El campeón cobra el pozo completo vía Lightning, reclamable incluso después de que arranque el próximo torneo.
- **Apuestas P2P** — apostá sats en el resultado de cualquier partido (gana local / empate / gana visitante). El issuer detecta automáticamente el resultado vía football-data.org y paga al ganador vía Lightning. Fee del 2%.
- **Premios en sats** — completá la página de un equipo y recibís **210 sats**; completá el álbum entero y recibís **5.000 sats**. Pagados automáticamente por el issuer vía NWC.
- **Compartir en Nostr** — publicá tus figuritas brillantes como notas kind:1 con la imagen del card adjunta (subida a nostr.build).
- **Multi-idioma** — español e inglés.
- **Multi-firmante** — NIP-07 (extensión), NIP-46 (Nostr Connect / bunker), clave local (nsec), login por email (magic link vía el issuer centralizado de lacrypta.dev) o generación de clave nueva.

## Premios

| Logro | Premio |
|---|---|
| Completar la página de un equipo (todas sus figuritas) | ⚡ 210 sats |
| Completar el álbum entero (672 figuritas únicas) | ⚡ 5.000 sats |
| Ganar una tanda de penales P2P | Robar una figurita aleatoria del rival |
| Ganar el Torneo de Penales (8 jugadores) | ⚡ Pozo completo (210 sats × inscriptos) |
| Ganar una apuesta P2P en resultado de partido | El bote de la apuesta menos 2% de fee |

## Requisitos

- Node.js 18+
- Una Lightning Address para el issuer (Alby, Wallet of Satoshi, etc.)
- Opcionalmente: una wallet NWC para pagos automáticos de recompensas
- Opcionalmente: API key de [football-data.org](https://www.football-data.org/) para detección automática de resultados (apuestas)

## Puesta en marcha

```bash
npm install
cp .env.example .env.local
```

### 1. Generar las claves del issuer

```bash
npm run seed
```

La primera vez (sin `ISSUER_NSEC` en `.env.local`) imprime un par de claves nuevo. Copialo:

```
NEXT_PUBLIC_ISSUER_PUBKEY=<hex>
ISSUER_NSEC=nsec1...
```

### 2. Publicar el catálogo

Con las claves ya cargadas, corré el seed de nuevo — esta vez publica el álbum, las figuritas y las definiciones de sobres en los relays:

```bash
npm run seed
```

### 3. Levantar el issuer

Escucha zap receipts (NIP-57), emite grants de ownership, settlements de trades, pagos de recompensas vía NWC, y liquida apuestas automáticamente cuando terminan los partidos:

```bash
npm run issuer
```

### 4. Levantar el cliente

```bash
npm run dev
# http://localhost:3000
```

## Variables de entorno

| Variable | Descripción | Requerida |
|---|---|---|
| `NEXT_PUBLIC_ALBUM_ID` | Slug único del álbum en Nostr (d tag) | Sí |
| `NEXT_PUBLIC_ISSUER_PUBKEY` | Pubkey hex del issuer | Sí |
| `ISSUER_NSEC` | Clave privada del issuer (solo servidor) | Sí |
| `NEXT_PUBLIC_ISSUER_LN_ADDRESS` | Lightning address del issuer (destino de zaps) | Sí |
| `ISSUER_NWC` | NWC de la wallet receptora del issuer (emite/cobra facturas de sobres y compras). Si no se setea, cae a `REWARD_NWC` | No |
| `REWARD_NWC` | Nostr Wallet Connect para pagar recompensas, premios de torneo y apuestas | No |
| `ISSUER_PAYMENTS` | `mock` para tests (autoconfirma facturas sin sats reales). Vacío = producción | No |
| `REWARD_PAYMENTS` | `mock` para tests de premios (registra el reclamo sin pagar). Vacío = producción | No |
| `REWARD_PAGE_SATS` | Sats por completar una página de equipo (default: 210) | No |
| `REWARD_ALBUM_SATS` | Sats por completar el álbum entero (default: 5000) | No |
| `FOOTBALL_API_KEY` | API key de [football-data.org](https://www.football-data.org/) — resultados de apuestas y tabla de posiciones del fixture | No |
| `ISSUER_API_URL` / `ISSUER_API_SECRET` | URL + secret del HTTP API del issuer (cuando corre en un VPS separado del frontend en Vercel). Sin esto, el torneo y los claims de premio no funcionan en producción | No (recomendado en prod) |
| `ISSUER_HTTP_PORT` | Puerto donde el issuer expone su HTTP API (`/tournament`, `/claims/*`, `/ownership/*`) | No |
| `ORDER_POLL_MS` | Cada cuánto el issuer revisa si las facturas pendientes se pagaron (default: 6000) | No |
| `NEXT_PUBLIC_RELAYS` | Lista de relays separada por comas | No |
| `NEXT_PUBLIC_SITE_URL` | URL pública del deploy (para links en notas compartidas y DMs de torneo) | No |
| `NEXT_PUBLIC_LACRYPTA_EMAIL_LOGIN_API_BASE` | Override del issuer de login por email (default: `https://lacrypta.dev`) | No |

## Estructura

```
src/
  app/
    page.tsx                  # orquesta identidad, estado de juego y navegación por tabs
    layout.tsx                # layout raíz, fuentes
    globals.css               # tokens CSS, animaciones (foil, flip de álbum, shine)
    auth/lacrypta-email/      # callback del login por email (lacrypta.dev)
    api/
      tournament/route.ts       # proxy GET/DELETE hacia el HTTP API del issuer (estado del torneo)
      claim/route.ts             # reclamo de premio de página/álbum (LNURL + NWC)
      claim-tournament/route.ts  # reclamo del premio del campeón del torneo
      standings/route.ts         # proxy cacheado a football-data.org (tabla de posiciones)
  components/
    Album.tsx           # grilla del álbum con zoom de sticker + flip estilo revista
    Packs.tsx           # apertura de sobres + reveal animado
    Market.tsx          # mercado P2P (listings, compra, mis ventas)
    Fixture.tsx         # fixture completo: fase de grupos + tabla de posiciones + eliminatorias + pronósticos + apuestas
    BetPanel.tsx        # panel de apuestas P2P por partido
    PenaltyGame.tsx     # minijuego de penales (client-side)
    PenaltyMatch.tsx    # desafíos P2P de penales entre usuarios
    PenaltyScene3D.tsx  # escena 3D con Three.js / React Three Fiber
    Tournament.tsx           # torneo de 8 jugadores: inscripción, fecha programada, grupos, llaves, reclamo de premio
    TournamentMatchPanel.tsx # panel interactivo de un partido de torneo (commit-reveal + animación de victoria/derrota)
    StickerCard.tsx     # card de figurita (foil, shiny, gradient)
    Connect.tsx         # login (NIP-07, NIP-46 QR, bunker, clave local, email)
    ShareButton.tsx     # captura el card + sube a nostr.build + publica nota
    Leaderboard.tsx     # tabla de posiciones
    Traders.tsx         # historial de trades
    MyStickers.tsx      # mis figuritas con opción de venta
    InvoiceModal.tsx    # modal de pago Lightning
    SettingsModal.tsx   # configuración de usuario
    NostrAvatar.tsx     # avatar desde perfil Nostr
    Flag.tsx            # bandera de país
  hooks/
    useIdentity.ts      # gestión de sesión (NIP-07 / NIP-46 / local / email)
    useGameState.ts     # estado completo del juego desde relays
    usePenaltyMatch.ts  # lobby + partidas de penales P2P
    usePronosticos.ts   # pronósticos de partidos (kind 30302)
    useBets.ts          # apuestas P2P por partido (kind 30400 + 1592)
    useLeaderboard.ts   # ranking de jugadores
    useProfile.ts       # perfil Nostr de un pubkey
    useTraders.ts       # historial de intercambios
  lib/
    constants.ts                 # kinds de eventos, relays, ALBUM_ID, ISSUER_LN_ADDRESS
    catalog.ts                    # catálogo de figuritas, rarezas, sorteo
    identity.ts                    # firmado (NIP-07 / NIP-46 / local) + sesión
    lacryptaEmailLogin.ts           # helper request/consume del login por email
    lacryptaEmailLoginAdapter.ts     # persiste el nsec recibido como sesión local
    claim-ledger.ts                  # ledger anti-doble-reclamo (fallback local)
    claim-remote.ts                   # ledger anti-doble-reclamo vía HTTP API del issuer (durable)
    dm.ts                              # DMs de Nostr (desafíos, turno, aviso de torneo)
    share.ts                            # captura DOM con html2canvas, upload a nostr.build
    zap.ts                                # flujo NIP-57 (zap request → invoice → receipt)
    order.ts                              # flujo de orden (ORDER_REQUEST → ORDER_INVOICE del issuer)
    nwc.ts                                # Nostr Wallet Connect (pagos automáticos, cliente)
    nwc-server.ts                          # Nostr Wallet Connect (pagos automáticos, servidor/issuer)
    penalty.ts                              # lógica de partidas de penales P2P
    pool.ts                                  # capa de relays (nostr-tools SimplePool)
    parsers.ts                                # eventos Nostr → tipos del dominio
    i18n.ts                                    # strings en español e inglés
    types.ts                                    # tipos del dominio
issuer/
  index.ts              # listener de zap receipts + resultados de fútbol → grants, settlements, apuestas; HTTP API (torneo, claims, ownership)
  tournament.ts          # estado y reglas del torneo de penales (registro, grupos, llaves, timeouts, historial)
  store.ts               # persistencia en disco: órdenes, ownership, claims, watermarks
  bets.ts                # lógica de apuestas P2P: lock, match, settle
  football.ts            # cliente de football-data.org + polling de resultados
  payments.ts            # abstracción de pagos (NWC real o mock para tests)
  seed.ts                # genera claves + publica catálogo en relays
  lib.ts                 # helpers del issuer (pool, publish, sign)
.agents/skills/
  lacrypta-email-login/  # skill instalada para el login por email centralizado
docs/
  figus-modelo-datos-nostr.md  # esquemas de todos los eventos Nostr
```

## Eventos Nostr usados

| Kind | Nombre | Descripción |
|---|---|---|
| 1 | Note | Posts compartidos (figuritas, ganancias en penales) |
| 1573 | Grant | Figus entregadas al abrir un sobre (emitido por issuer) |
| 1574 | Settlement | Liquidación de un trade o apuesta (emitido por issuer) |
| 1575 | Claim | El cliente solicita un sobre o recompensa al issuer |
| 1576 | Penalty Commit | Compromiso de zona del pateador (hash) |
| 1577 | Penalty Block | Elección de columna del arquero |
| 1578 | Penalty Reveal | Revelación de zona + nonce del pateador |
| 1579 | Reward Claim | El cliente solicita el premio de página/álbum completo |
| 1580 | Steal Claim | Reclamo de figurita ganada en penales |
| 1583 | Order Request | El cliente pide factura para comprar sobre/figu o inscribirse al torneo |
| 1584 | Order Invoice | El issuer responde con el bolt11 que va a cobrar y verificar |
| 1591 | Bet Accept | Apostador B acepta una oferta de apuesta |
| 1592 | Bet Settle | Estado de apuesta publicado por el issuer (locked / matched / settled) |
| 9734 | Zap Request | Solicitud de pago para compra de sobre o apuesta |
| 9735 | Zap Receipt | Confirmación de pago — dispara grants o bet-lock |
| 30100 | Ownership | Figurita en posesión de un usuario (emitido por issuer) |
| 30200 | Listing | Figurita listada en el mercado P2P |
| 30301 | Penalty Match | Partida de penales P2P |
| 30302 | Pronóstico | Predicción de resultado de un partido (por usuario) |
| 30305 | Tourney Match | Partido interactivo del torneo (commit-reveal en vivo) |
| 30400 | Bet Offer | Oferta de apuesta P2P por resultado de partido |

## Flujo de apuestas P2P

1. **Apostador A** crea una oferta en el fixture: elige partido, resultado (local/empate/visitante) y monto en sats.
2. **Apostador A** paga vía zap al issuer con `figus-action: "bet-lock"` — el issuer publica una confirmación en Nostr.
3. **Apostador B** ve la oferta abierta, la acepta pagando el mismo monto vía zap — la apuesta queda "matched".
4. Cuando termina el partido, el issuer consulta football-data.org (polling cada 5 min), determina el resultado y paga automáticamente al ganador vía Lightning. El fee es del 2% del bote total.

## Torneo de penales

Torneo de 8 jugadores, inscripción vía Lightning (210 sats c/u — el pozo lo cobra el campeón).

1. **Inscripción** — el primer inscripto se convierte en el creador y elige fecha/hora de inicio (`scheduledAt`); los demás la ven desde que entran a inscribirse.
2. **Arranque** — cuando se completan los 8 cupos, el torneo entra en cuenta atrás: arranca en `scheduledAt` o 5 minutos después de completarse el cupo, lo que pase **después**. Así nunca arranca antes de la hora acordada, pero tampoco se cuelga esperando si la fecha ya pasó.
3. **Fase de grupos** — 2 grupos de 4, todos contra todos (3 penales c/u por partido). Cualquier usuario puede ver los partidos en curso, esté jugando o no.
4. **Semifinal** — ganadores de grupo cruzados, 4 penales c/u.
5. **Final** — 5 penales c/u (formato mundialista) antes de muerte súbita.
6. **Premio** — el campeón reclama el pozo completo vía Lightning desde la pestaña Torneo. El reclamo sigue disponible aunque ya haya arrancado el torneo siguiente (el issuer archiva los torneos terminados en `data/tournament-history.json`).

Cada tiro usa **commit-reveal**: el pateador publica un hash de su zona elegida, el arquero elige columna sin verlo, y solo entonces el pateador revela zona + nonce — así ninguno puede ver la jugada del otro antes de tiempo. Ausencias prolongadas (3 min sin actuar) se resuelven automáticamente: arquero ausente = gol, pateador ausente = atajada.

## Login

Cinco métodos soportados:

- **NIP-07** — extensión de navegador (Alby, nos2x, etc.). Solo aparece si la extensión está instalada.
- **Nostr Connect QR** — escaneá con Amber, nsec.app u otro firmante NIP-46.
- **Nostr Connect bunker** — pegá una URL `bunker://` o NIP-05 de firmante remoto.
- **Clave local** — generá o importá un nsec. Se guarda en localStorage. Útil para pruebas rápidas.
- **Email (magic link)** — login con email vía el issuer centralizado de [lacrypta.dev](https://lacrypta.dev) (skill `lacrypta-email-login`). El nsec se deriva determinísticamente del email normalizado — pensado como rampa de onboarding hacia self-custody, no como key management privado: la misma persona obtiene la misma identidad Nostr en cualquier app bajo `*.lacrypta.dev`. El callback (`/auth/lacrypta-email`) queda permitido automáticamente por estar en un subdominio de `lacrypta.dev`.

> **Usuarios de LibreWolf / Tor Browser:** `privacy.resistFingerprinting` bloquea el canvas API, lo que impide generar el QR. En ese caso usá bunker URL, clave local o email.

## Arquitectura

- **Sin base de datos** — todo el estado del juego se deriva de eventos Nostr en relays públicos; lo que necesita persistencia entre deploys (órdenes, claims, estado del torneo) vive en disco en el issuer.
- **Issuer trustless** — solo actúa ante un zap receipt `9735` válido firmado por la wallet del usuario, o una orden pagada (`ORDER_REQUEST` → factura propia → `ORDER_INVOICE`). Nunca custodia fondos más del tiempo de matching de apuestas.
- **Frontend en Vercel + issuer en VPS** — en producción, el frontend de Next.js (Vercel, filesystem efímero) habla con el issuer (proceso Node persistente en un VPS) vía un HTTP API simple protegido por `ISSUER_API_SECRET`. Todo lo que necesita durabilidad real (estado del torneo, ledger de claims) vive del lado del issuer.
- **Resultados automáticos** — el issuer hace polling a football-data.org cada 5 minutos durante el Mundial y liquida apuestas automáticamente sin intervención manual; el mismo feed alimenta la tabla de posiciones en vivo del fixture.
- **Imágenes de figuritas** — subidas a [nostr.build](https://nostr.build) en el momento de compartir (gratis, sin auth). Se adjuntan al note con tag NIP-92 `imeta`.
- **Pronósticos descentralizados** — cada usuario publica sus predicciones como eventos kind 30302 reemplazables. Sin servidor.
- **Persistencia de tab** — la URL usa el hash (`#fixture`, `#album`, etc.) para recordar la sección activa al refrescar.
