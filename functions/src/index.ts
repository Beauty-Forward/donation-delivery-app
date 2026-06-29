// `./init` MUST be imported first. It runs initializeApp() + loads env before any
// function module below is evaluated — those modules call getFirestore() at load
// time, which throws if the default app doesn't exist yet. Imports are hoisted and
// evaluate in source order, so this side-effect import runs ahead of the re-exports.
// (Putting initializeApp() inline below does NOT work — the re-exports hoist above it.)
import './init.js';

export { handleGivebutterWebhook } from './givebutter-webhook.js';
export { sendStalledRecoveryEmails, sendStalledDonationSlaEmails } from './sendSlaEmails.js';
export { createDonationRequest } from './create-donation-request.js';
