# Beauty Forward Donation Logistics

Public-facing donation logistics app: donors schedule a courier pickup, ship products to the warehouse themselves, or reserve a drop-off slot. Built with Angular + Firebase, with real integrations for courier dispatch (Roadie), donations (Givebutter), CRM (HubSpot), and transactional email (Resend).

**Live:** https://donation-delivery-app--beauty-forward.us-east4.hosted.app/

## How It Works

Donors pick one of three methods and complete a short wizard:

- **Schedule Pickup** — capture donor + pickup address, a preferred date/time window, and a fixed (non-editable) warehouse destination. A pay-what-you-wish Givebutter contribution is part of this flow; **courier dispatch is gated on a verified contribution** at or above `PICKUP_DONATION_MIN_USD`.
- **Ship Products** — capture sender details. The donor ships the package to the warehouse themselves; there is no prepaid label. The request is recorded as `awaiting_shipment`.
- **Schedule Drop-Off** — capture donor details and a slot request; a drop-off reference code is generated for the donor to bring in.

No authentication is required. The data model leaves room for accounts (`donorAccountId`) but nothing sets it yet.

## Tech Stack

- **Frontend:** Angular 21 + TypeScript (standalone components), mobile-first SCSS
- **Backend:** Firebase Cloud Functions v2 (single `donor` codebase), TypeScript
- **Data:** Firestore
- **Integrations:** Roadie (courier), Givebutter (donations), HubSpot (CRM), Resend (email)
- **Tests:** Vitest (functions), Karma/Jasmine via `ng test` (frontend)

## Architecture at a Glance

```text
Donor (browser, Angular wizard)
   │  createDonationRequest (onCall)
   ▼
Cloud Functions ──► Firestore (donation_requests + type-specific collections)
   │                     │
   │                     └─ onDocumentCreated ──► verifyContributionAndDispatch (backstop)
   ├─► Givebutter  (verify contribution against /v1/transactions)
   ├─► Roadie      (book courier for verified pickups)
   ├─► HubSpot     (upsert donor contact)
   └─► Resend      (confirmation email)
```

The pickup happy path verifies the donation and dispatches the courier **synchronously** inside `createDonationRequest`. `verifyContributionAndDispatch` is a Firestore `onCreate` trigger that re-runs the same logic as a **backstop** if the synchronous path didn't resolve (e.g. the donor paid after submitting). `handleGivebutterWebhook` is a further recovery path.

## Project Structure

```text
src/app/
├── core/
│   ├── constants/        time-windows.ts, us-states.ts
│   ├── guards/           flow.guard.ts
│   ├── models/           donation.models.ts
│   └── services/
│       ├── donation-wizard-state.service.ts   # state machine behind the wizard
│       ├── donation-api.service.ts            # calls the Cloud Functions / Firestore
│       ├── warehouse-config.service.ts
│       ├── contribution.service.ts
│       ├── firebase-client.service.ts
│       └── donation-flow-state.service.ts
├── features/
│   ├── wizard/           donation-wizard-page.component.*  ← the donor flow (all methods)
│   ├── method-selection/ pickup/ dropoff/   ← earlier per-step components (see note)
├── shared/components/    contribution-panel/, donation-option-card/
└── app.routes.ts

functions/src/
├── index.ts              # all Cloud Functions entry points
├── models.ts             # shared types (DonationStatus, payloads, etc.)
├── validators.ts         # Zod schemas for inbound payloads
├── dispatch-routing.ts   # routing guard for the verify+dispatch trigger
├── firestore-utils.ts
├── constants/warehouse.ts
├── providers/            # courier-provider.ts (interface), roadie-provider.ts (real),
│                         #   mock-roadie-provider.ts (fallback)
├── services/             # givebutter, hubspot, resend, dispatch
├── email/templates/      # base-layout + pickup/shipping/dropoff/recovery emails
└── utils/dropoff-reference.ts

firebase.json · firestore.rules · firestore.indexes.json
```

> **Note on the donor UI:** all three flows are rendered by the single
> `features/wizard/donation-wizard-page.component.ts`, switched by the route's
> `data.mode`. The standalone components under `features/method-selection`,
> `features/pickup`, and `features/dropoff` are earlier per-step versions and are
> **not currently routed** — don't edit them expecting to change the live flow.

## Routing

Every route loads the wizard component; `data.mode` tells it which step to render.

- `/` — method selection (home)
- `/pickup` → `/pickup/review` → `/pickup/confirmation`
- `/shipping` → `/shipping/review` → `/shipping/confirmation`
- `/dropoff` → `/dropoff/review` → `/dropoff/confirmation`

## Firestore Data Model

### Primary collection — `donation_requests/{requestId}`

```ts
{
  donationType: 'pickup' | 'shipping' | 'dropoff',
  donor: { fullName, email, phone, donorAccountId? },
  contribution: {
    provider: 'givebutter',
    status: 'not_started' | 'checkout_started' | 'completed' | 'skipped',
    amountUsd?, checkoutUrl?, gbSessionId?
  },
  pickup?:   { pickupAddress, preferredDate, preferredTimeWindow, courierNotes?, warehouseAddress },
  shipping?: { senderAddress, packageNotes? },
  dropoff?:  { preferredDate, preferredTimeWindow, dropoffNotes?, locationName, locationAddress, referenceCode? },
  status: DonationStatus,
  createdAt, updatedAt, metadata
}
```

`DonationStatus` is one of: `submitted`, `verifying_payment`, `awaiting_payment`,
`payment_verification_failed`, `queued_for_dispatch`, `dispatch_requested`,
`awaiting_shipment`, `dropoff_requested`, `completed`.

### Type-specific collections

`pickup_requests/{requestId}`, `shipping_requests/{requestId}`, `dropoff_requests/{requestId}` — each mirrors the base document and includes `donationRequestId`.

### Security rules

`firestore.rules` is create-only: every collection is `allow create: if true`, with
reads, updates, and deletes denied. Validation is enforced server-side by the Cloud
Functions callables and their Zod validators; direct client `create` is a fallback path.

## Cloud Functions

All in `functions/src/index.ts`, region `us-central1`, codebase `donor`:

| Function | Trigger | Purpose |
| --- | --- | --- |
| `createDonationRequest` | `onCall` | Validates payload, writes `donation_requests` + the type-specific doc, generates a drop-off reference for drop-offs, and (for pickups) verifies the Givebutter contribution and dispatches Roadie synchronously. Marks shipping requests `awaiting_shipment`. |
| `createContributionSession` | `onCall` | Returns a Givebutter checkout URL for the pickup contribution flow. |
| `verifyContributionAndDispatch` | `onDocumentCreated` | Backstop: re-verifies the contribution and dispatches the courier if the synchronous path didn't resolve. |
| `handleGivebutterWebhook` | `onRequest` | Recovery path for contribution status updates. ⚠️ Signature verification is not yet implemented. |
| `lookupDonationByReference` | `onCall` | Looks up a donation by its drop-off reference code. |

## Integrations

### Roadie (courier dispatch)

- `CourierDispatchProvider` interface with two implementations: `RoadieCourierProvider` (real API) and `MockRoadieCourierProvider`.
- The **real** provider runs when `ROADIE_API_KEY` is present; otherwise the mock runs, so local dev without keys is harmless.
- A client-generated `idempotencyKey` is forwarded to Roadie to prevent duplicate bookings.

### Givebutter (donations)

- `GivebutterService` verifies contributions **server-to-server** against Givebutter's `/v1/transactions` endpoint (matching donor email + amount within a lookback window) before dispatch.
- Checkout **session creation** is still a URL builder, not a real Givebutter session API call (tracked in the v2 backlog).

### HubSpot (CRM)

- `HubSpotService` upserts the donor as a contact on submission. No-ops with a warning if `HUBSPOT_SERVICE_KEY` is unset.

### Resend (email)

- `ResendService` sends pickup / shipping / drop-off confirmation emails (templates in `functions/src/email/templates/`). No-ops with a warning if `RESEND_API_KEY` is unset, so the happy path never breaks in unconfigured environments.

## Environment Configuration

Frontend config lives in `src/environments/environment.ts` and `environment.development.ts`
(Firebase web keys, warehouse config, Givebutter campaign URL).

Backend config is in `functions/.env` (copy from `functions/.env.example`, which documents
every variable). Highlights:

- `ROADIE_API_KEY` — **secret**, set via `firebase functions:secrets:set ROADIE_API_KEY` (Secret Manager), never in `.env`. Sandbox key goes in `.env.local` for local dev.
- `ROADIE_API_BASE_URL`, `WAREHOUSE_CONTACT_NAME`, `WAREHOUSE_CONTACT_PHONE`
- `GIVEBUTTER_CAMPAIGN_URL`, `GIVEBUTTER_API_KEY`, `GIVEBUTTER_DONATION_LOOKBACK_MINUTES`
- `PICKUP_DONATION_MIN_USD` — minimum verified contribution to unlock pickup dispatch
- `HUBSPOT_SERVICE_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- Local-only escape hatches (`.env.local`): `SKIP_GIVEBUTTER_VERIFICATION`, `FIRESTORE_EMULATOR_HOST`

> `.env` is deployed to Cloud Functions (no secrets); `.env.local` is never deployed.
> Both are gitignored.

## Local Setup

```bash
# Frontend
npm install
npm run start          # ng serve

# Cloud Functions
npm run functions:install
npm run functions:build

# Build everything
npm run build:all
```

Run the functions against the Firestore emulator:

```bash
cd functions
npm run serve          # build + firebase emulators:start --only functions:donor,firestore
```

Deploy functions: `cd functions && npm run deploy` (`firebase deploy --only functions:donor`).

## Tests

```bash
npm test                       # frontend (ng test)
cd functions && npm test       # backend (vitest run)
```

## Future Work

Post-v1 / nice-to-have items live in the Notion backlog, not in GitHub issues, so the
tracker stays focused on active work:

**[Beauty Forward — v2 / Next Iteration Backlog](https://www.notion.so/3732e4b9dae981efbbd8c61476c4a43e)**

Current donation-app items there include Firebase Auth + donor accounts, a real Givebutter
checkout session API call, Givebutter webhook signature verification, a real prepaid
shipping-label provider, an admin dashboard, and hardening the Firestore rules. Promote an
item back to a GitHub issue when it's scoped for a build cycle.
