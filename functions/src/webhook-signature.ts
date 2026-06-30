import { createHash, timingSafeEqual } from 'crypto';

/**
 * Constant-time comparison of the Givebutter `Signature` header against our stored
 * signing secret. Givebutter sends the same static secret string in the header on
 * every delivery (it is NOT an HMAC of the payload) — it must equal the signing
 * secret shown for this webhook in the Givebutter dashboard.
 *
 * Both sides are hashed to fixed-length SHA-256 digests before comparison so that
 * timingSafeEqual never throws on a length mismatch, and so the secret's length is
 * not leaked through timing.
 */
export function isValidGivebutterSignature(
  provided: string | undefined,
  expected: string | undefined,
): boolean {
  if (!provided || !expected) {
    return false;
  }
  const providedDigest = createHash('sha256').update(provided).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}
