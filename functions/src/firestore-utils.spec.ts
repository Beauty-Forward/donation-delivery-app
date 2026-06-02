import { describe, expect, it } from 'vitest';
import { isAlreadyExistsError } from './firestore-utils.js';

describe('isAlreadyExistsError', () => {
  it('detects the gRPC ALREADY_EXISTS numeric code (firebase-admin)', () => {
    expect(isAlreadyExistsError({ code: 6 })).toBe(true);
  });

  it('detects the string code and message variants', () => {
    expect(isAlreadyExistsError({ code: 'already-exists' })).toBe(true);
    expect(isAlreadyExistsError({ message: '6 ALREADY_EXISTS: entity already exists' })).toBe(true);
  });

  it('returns false for unrelated errors and non-objects', () => {
    expect(isAlreadyExistsError({ code: 5 })).toBe(false); // NOT_FOUND
    expect(isAlreadyExistsError(new Error('network blip'))).toBe(false);
    expect(isAlreadyExistsError(undefined)).toBe(false);
    expect(isAlreadyExistsError(null)).toBe(false);
    expect(isAlreadyExistsError('already-exists')).toBe(false);
  });
});
