// Routing guard for the verifyContributionAndDispatch onCreate trigger.
//
// Two code paths can dispatch a pickup:
//   - the createDonationRequest callable, which creates the doc AND verifies +
//     dispatches it synchronously. Its docs are tagged metadata.source
//     'public-web' (see CALLABLE_DOC_SOURCE).
//   - the onCreate trigger, a backstop for the frontend's direct-Firestore
//     fallback (docs tagged 'frontend_firestore_fallback'), used when the
//     callable fails or times out and the client writes the doc itself.
//
// Both fire on the same doc-create. Without this guard the trigger races the
// callable's inline dispatch — reading the doc's status before the callable has
// written its terminal value — and books a SECOND Roadie shipment plus a second
// donor email. The callable owns the docs it creates; the trigger must skip them
// and only act on the fallback path. See issue #112.

export const CALLABLE_DOC_SOURCE = 'public-web';

/**
 * True when a donation_requests doc was created by the createDonationRequest
 * callable (which dispatches synchronously) — in which case the onCreate trigger
 * must NOT dispatch it again.
 */
export function isCallableOwnedDoc(metadata: unknown): boolean {
  if (typeof metadata !== 'object' || metadata === null) {
    return false;
  }
  return (metadata as { source?: unknown }).source === CALLABLE_DOC_SOURCE;
}
