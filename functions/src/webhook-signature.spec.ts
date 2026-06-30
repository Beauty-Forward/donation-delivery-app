import { describe, expect, it } from 'vitest';
import { isValidGivebutterSignature } from './webhook-signature.js';

describe('isValidGivebutterSignature', () => {
  it('accepts a header that exactly matches the secret', () => {
    expect(isValidGivebutterSignature('s3cr3t-token', 's3cr3t-token')).toBe(true);
  });

  it('rejects a header that does not match the secret', () => {
    expect(isValidGivebutterSignature('wrong-token', 's3cr3t-token')).toBe(false);
  });

  it('rejects when the provided header is missing or empty', () => {
    expect(isValidGivebutterSignature(undefined, 's3cr3t-token')).toBe(false);
    expect(isValidGivebutterSignature('', 's3cr3t-token')).toBe(false);
  });

  it('rejects when the expected secret is not configured (fail closed)', () => {
    expect(isValidGivebutterSignature('anything', undefined)).toBe(false);
    expect(isValidGivebutterSignature('anything', '')).toBe(false);
  });

  it('rejects a value that is only a prefix of the secret', () => {
    expect(isValidGivebutterSignature('s3cr3t', 's3cr3t-token')).toBe(false);
  });
});
