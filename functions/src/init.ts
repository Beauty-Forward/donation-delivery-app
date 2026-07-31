// Initialize firebase-admin + load env BEFORE any function module is imported.
// index.ts imports this first, so by the time the function files (which call
// getFirestore() at module load) are evaluated, the default app already exists
// and env is loaded. Without this, those top-level getFirestore() calls would run
// before initializeApp() and throw "The default Firebase app does not exist".
import { config as loadDotenv } from 'dotenv';
import { join } from 'path';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// .env.local — emulator-only overrides (sandbox creds)
if (process.env['FUNCTIONS_EMULATOR'] === 'true') {
  loadDotenv({ path: join(__dirname, '..', '.env.local'), override: true });
}
// .env — deployed config; loaded without override so it never clobbers secrets
loadDotenv({ path: join(__dirname, '..', '.env') });

initializeApp();

/* 
Strip undefined values from writes instead of throwing. Donation docs carry
three optional sub-objects (pickup / shipping / dropoff), only one populated
per request — the other two are undefined and would otherwise fail every write.
*/
getFirestore().settings({ ignoreUndefinedProperties: true });
