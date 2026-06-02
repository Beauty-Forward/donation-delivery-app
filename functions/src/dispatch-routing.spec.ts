import { describe, expect, it } from 'vitest';
import { CALLABLE_DOC_SOURCE, isCallableOwnedDoc } from './dispatch-routing.js';

describe('isCallableOwnedDoc', () => {
  it('returns true for callable-created docs so the trigger skips them (no double dispatch)', () => {
    expect(isCallableOwnedDoc({ source: CALLABLE_DOC_SOURCE })).toBe(true);
    // extra metadata fields must not matter
    expect(isCallableOwnedDoc({ source: 'public-web', courierDispatchId: 'abc' })).toBe(true);
  });

  it('returns false for the direct-Firestore fallback so the trigger still backstops it', () => {
    expect(isCallableOwnedDoc({ source: 'frontend_firestore_fallback' })).toBe(false);
  });

  it('returns false when source is missing or metadata is absent', () => {
    expect(isCallableOwnedDoc({})).toBe(false);
    expect(isCallableOwnedDoc({ source: undefined })).toBe(false);
    expect(isCallableOwnedDoc(undefined)).toBe(false);
    expect(isCallableOwnedDoc(null)).toBe(false);
    expect(isCallableOwnedDoc('public-web')).toBe(false);
  });
});
