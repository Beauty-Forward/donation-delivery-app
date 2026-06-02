// True when a Firestore write failed because the document already exists — i.e.
// a `transaction.create()` / `DocumentReference.create()` against a doc that's
// already there. Used by the deterministic-doc-id path (#113 L1) so the callable
// and the direct-Firestore fallback can race to create the same doc id and the
// loser backs off instead of throwing.
//
// firebase-admin surfaces this as gRPC ALREADY_EXISTS (numeric code 6); some
// layers use the string 'already-exists' or only the message, so we check all.
export function isAlreadyExistsError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const { code, message } = err as { code?: number | string; message?: string };
  return code === 6 || code === 'already-exists' || /ALREADY_EXISTS/i.test(message ?? '');
}
