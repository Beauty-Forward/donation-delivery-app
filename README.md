# Beauty Forward Donation Logistics

Public-facing donation logistics app: donors schedule a courier pickup, ship products to the warehouse themselves, or drop items off in person. Built with Angular + Firebase, with real integrations for courier dispatch (Roadie), donations (Givebutter), and transactional email (Resend).

**Live:** https://donation-delivery-app--beauty-forward.us-east4.hosted.app/

## 📚 Documentation

Full documentation for the team and future maintainers lives in [`docs/`](docs/) — start
with the **[System Overview](docs/system-overview.md)** *([quick version](docs/system-overview-simple.md))*,
which indexes everything: architecture, the donation lifecycle & troubleshooting,
accounts, and the user guides. Those docs are kept accurate against the code; where this
README and the docs disagree, trust the docs.

## How It Works

Donors pick one of three methods and complete a short wizard — no login required:

- **Schedule Pickup** — a courier (Roadie) collects the items. Dispatch is gated on a verified Givebutter contribution at or above `PICKUP_DONATION_MIN_USD`.
- **Ship Products** — the donor mails the items to the warehouse themselves (no prepaid label).
- **Drop-Off** — the donor brings the items to the front desk during opening hours.

For the donor-facing walkthrough, see the **[External User Guide](docs/user-guide-external.md)**;
for day-to-day operations, see the **[Internal User Guide](docs/user-guide-internal.md)**.

## Tech Stack

- **Frontend:** Angular 21 + TypeScript (standalone components), mobile-first SCSS
- **Backend:** Firebase Cloud Functions v2 (single `donor` codebase), TypeScript
- **Data:** Firestore
- **Integrations:** Roadie (courier), Givebutter (donations), Resend (email)
- **Tests:** Vitest (functions), Karma/Jasmine via `ng test` (frontend)

## How It Works Under the Hood

The full technical picture — the moving parts, the donation lifecycle and its statuses,
the Firestore data model, the Cloud Functions, and the integrations — lives in the docs,
kept accurate against the code:

- **[Architecture](docs/architecture-donation-app.md)** — the components, data flow, data model, and Cloud Functions *([quick version](docs/architecture-donation-app-simple.md))*
- **[Donation Lifecycle & State Machine](docs/donation-lifecycle-state-machine.md)** — every status, how a donation moves, and how to troubleshoot a stuck one *([quick version](docs/donation-lifecycle-simple.md))*
- **[Accounts & Services](docs/accounts-and-services.md)** — the integrations, who owns each, and where keys live *([quick version](docs/accounts-and-services-simple.md))*

> **Donor UI note:** a single component renders all three donor flows
> (`features/wizard/donation-wizard-page.component.ts`), switched by each route's
> `data.mode`. The earlier per-step components under `features/method-selection`,
> `features/pickup`, and `features/dropoff` are **not routed** — don't edit them
> expecting to change the live flow.

## Environment Configuration

Frontend config lives in `src/environments/environment.ts` and `environment.development.ts`
(Firebase web keys, warehouse config, Givebutter campaign URL).

Backend config is in `functions/.env` (copy from `functions/.env.example`, which documents
every variable). Highlights:

- **Firebase secrets** (Secret Manager, never in `.env`), set via `firebase functions:secrets:set <NAME>`: `ROADIE_API_KEY` and `GIVEBUTTER_WEBHOOK_SIGNATURE`. A Roadie sandbox key goes in `.env.local` for local dev.
- `ROADIE_API_BASE_URL`, `WAREHOUSE_CONTACT_NAME`, `WAREHOUSE_CONTACT_PHONE`
- `GIVEBUTTER_CAMPAIGN_URL`, `GIVEBUTTER_API_KEY`
- `PICKUP_DONATION_MIN_USD` — minimum verified contribution to unlock pickup dispatch
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- Local-only escape hatches (`.env.local`): `SKIP_GIVEBUTTER_VERIFICATION`, `FIRESTORE_EMULATOR_HOST`, a throwaway `GIVEBUTTER_WEBHOOK_SIGNATURE`

> `.env` is deployed to Cloud Functions (no true secrets); `.env.local` is never deployed.
> Both are gitignored. For account ownership and key-rotation details, see
> **[Accounts & Services](docs/accounts-and-services.md)**.

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
checkout session API call, a real prepaid shipping-label provider, an admin dashboard, and
hardening the Firestore rules. Promote an item back to a GitHub issue when it's scoped for
a build cycle.
