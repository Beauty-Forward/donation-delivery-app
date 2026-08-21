# Accounts & Services

> **Who this is for:** Whoever keeps the donation app running. This is the key ring —
> every outside account the app depends on, who owns it, where to sign in, and where its
> keys live.
>
> **This document contains no passwords and no secret key values.** It says *where* each
> secret lives and *how* to change it — never the secret itself. Keep it that way.

---

## Ownership & handover status

| Service | Owned by | Status |
| --- | --- | --- |
| **Firebase / Google Cloud** | Currently the developer's personal Google account | ⏳ **To be transferred to Beauty Forward** as part of project close-out |
| **Givebutter** | Beauty Forward | ✅ Owned by BF — *confirm campaign visibility (below)* |
| **Roadie** | Beauty Forward | ✅ Owned by BF; team has their own logins |
| **Resend** | Beauty Forward (`info@beauty-forward.org`) | ✅ Owned by BF |
| **GitHub** | Beauty Forward org | ✅ BF has admin on the repo |

> The two things that still need to happen are the **Firebase/Google Cloud transfer** and
> **confirming Givebutter campaign visibility** — both are in the *Handover checklist* at
> the end.

---

## Firebase / Google Cloud

The backbone. Hosts the database, the backend, the secrets, and the live website.

- **What it runs:** the database (Firestore, the `donation_requests` collection), the
  backend (Cloud Functions), the secret store (Secret Manager), and the public website
  (Firebase App Hosting). Project ID: **`beauty-forward`**.
- **Sign in:** [console.firebase.google.com](https://console.firebase.google.com) →
  project `beauty-forward`.
- **Who owns it today:** the developer's personal Google account, on the developer's
  card. **This is the one account that still needs to be handed over** — both the
  Firebase project and the underlying Google Cloud billing account. See the handover
  checklist.
- **Amount spent to date:** ⬜ *(to be filled from the Google Cloud billing console for
  the handover conversation)*.
- **How access works:** there's no day-to-day API key to rotate here. Access is by
  **who's invited to the Google project** (permissions), plus the Firebase command-line
  tool for deploying. The website's Firebase config that appears in the app's code
  (`src/environments/`) is **public by design** — it is not a secret; the database
  security rules are what actually protect the data.

---

## Givebutter — donations

Takes the donor's pay-what-you-wish contribution. For pickups, a confirmed contribution
is what unlocks the courier.

- **Sign in:** [givebutter.com](https://givebutter.com). Public campaign:
  [givebutter.com/beauty-forward](https://givebutter.com/beauty-forward).
- **Owned by:** Beauty Forward. **The team logs in here today.**
- **⚠️ Confirm:** the campaigns were originally created from the developer's account.
  Verify that the Beauty Forward login sees **the same campaigns** — if not, they need to
  be shared/transferred to the BF account. *(Handover checklist item.)*
- **Minimum contribution for a pickup:** **$15** (adjustable — see the appendix).
- **Two keys, two homes:**
  - The lookup key lives in the backend's plain settings file.
  - The **webhook signing secret** — the shared password that proves a "payment
    happened" message really came from Givebutter — lives in **Firebase's secret store.**
    You find its value in Givebutter under **Settings → Webhooks**.
  - **Rotating the webhook secret is a two-step move:** change it in Givebutter *and*
    update the Firebase secret **together**. If they don't match, the backend rejects
    every payment message (it's built to fail safe), and pickups will silently stop being
    dispatched.

---

## Roadie — courier

Books and runs the courier who collects a pickup and brings it to the warehouse.

- **Sign in:** [connect.roadie.com](https://connect.roadie.com) (live) /
  [connect-sandbox.roadie.com](https://connect-sandbox.roadie.com) (test).
- **Owned by:** Beauty Forward. **The team has their own Roadie logins** and can view
  and rebook couriers directly.
- **Key:** the Roadie API key lives in **Firebase's secret store** (never in the plain
  settings file). A separate *test* key is used only for local development.
- **Worth confirming once:** that production Roadie is actually live (not still pointing
  at the test environment) — see the handover checklist.

---

## Resend — email

Sends every automated email: the confirmations, the "finish your donation" reminder, and
the "we're on it" reassurance note.

- **Sign in:** [resend.com](https://resend.com).
- **Owned by:** Beauty Forward, under **`info@beauty-forward.org`**.
- **Keys:** the Resend API key and the "from" address live in the backend's plain
  settings file.
- **Good to know:** if the Resend key is missing, emails simply don't send (the app logs
  a warning) — **it never blocks a donation from being recorded.** So a donor could
  successfully donate but not receive an email if Resend is misconfigured; the donation
  is still safe in the database.
- **Sending address:** emails send from a `beauty-forward.org` address. For emails to
  reach *all* donors (not just the account owner), the sending domain must be verified in
  Resend via DNS. Confirm the domain is verified in production.

---

## GitHub — the code

- **Org:** `Beauty-Forward`. **Repo:**
  [donation-delivery-app](https://github.com/Beauty-Forward/donation-delivery-app).
- **Access:** Beauty Forward has **admin** on the repo. This is only needed for making
  code changes or deploying — not for day-to-day operations.

---

## Where every key physically lives

Three different homes, by sensitivity:

| Home | What's in it | Who can see it |
| --- | --- | --- |
| **Firebase secret store** (Secret Manager) | The most sensitive keys: the Roadie key and the Givebutter webhook signing secret | Only people with access to the Firebase project |
| **Backend settings file** (`functions/.env`) | Less-sensitive backend settings: the Givebutter lookup key, the Resend key + from-address, the courier/warehouse details | In the deployed backend; **not** in the public code repo |
| **Public website config** (`src/environments/`) | The Firebase web config — **public by design, not a secret** | Anyone (it's in the shipped website) |

> **Never** put a Firebase-secret-store value into the plain settings file or the code
> repo. The split exists on purpose.

---

## Handover checklist

The open items to close out ownership:

- ⬜ **Transfer the Firebase project and Google Cloud billing** from the developer's
  personal Google account to a Beauty Forward-owned account. *(Tied to project
  close-out / final payment.)*
- ⬜ **Record the Firebase/Google Cloud spend to date** for the handover conversation.
- ⬜ **Confirm the Beauty Forward Givebutter login sees the same campaigns** the app
  uses (they were created from the developer's account).
- ⬜ **Confirm production Roadie is live** and the production key — not the test key — is
  set as the Firebase secret.
- ⬜ **Confirm the Resend sending domain is verified** so emails reach all donors.

---

## Appendix — for the technical successor

**Secret store vs env, by exact name.**
- **Firebase secrets** (`firebase functions:secrets:set <NAME>`): `ROADIE_API_KEY`,
  `GIVEBUTTER_WEBHOOK_SIGNATURE`. These are declared as secrets in code
  (`defineSecret`) and are **not** in `.env.example`.
- **`functions/.env`** (deployed with the backend, no true secrets, gitignored):
  `ROADIE_API_BASE_URL`, `WAREHOUSE_CONTACT_NAME`, `WAREHOUSE_CONTACT_PHONE`,
  `PICKUP_DONATION_MIN_USD`, `GIVEBUTTER_API_KEY`, `GIVEBUTTER_CAMPAIGN_URL`,
  `RESEND_API_KEY`, `RESEND_FROM_EMAIL`. Template is `functions/.env.example`.
- **`functions/.env.local`** (local dev only, never deployed): a Roadie sandbox key
  overriding production, `SKIP_GIVEBUTTER_VERIFICATION` to bypass the payment gate, and a
  throwaway `GIVEBUTTER_WEBHOOK_SIGNATURE` for local webhook testing.
- **Frontend** (`src/environments/environment.ts` / `.development.ts`): public Firebase
  web config, the Givebutter campaign URL (`givebutter.com/beauty-forward`), the contact
  email (`info@beauty-forward.org`), and warehouse display config. All public.

**Firebase specifics.** Project `beauty-forward`; Cloud Functions codebase `donor`,
region `us-central1`; frontend on App Hosting (live at the `*.us-east4.hosted.app` URL).
Deploys use the Firebase CLI (`firebase login`, then `firebase deploy --only
functions:donor` from `functions/`).

**Contribution minimum.** `PICKUP_DONATION_MIN_USD` (defaults to `15` if unset); read at
call-time so it can be lowered in non-production for testing.

**Warehouse details.** Currently hardcoded in `functions/src/warehouse.ts` (address,
contact name, phone) — change them there, not in an env var.
