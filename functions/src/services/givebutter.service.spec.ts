import { afterEach, describe, expect, it, vi } from 'vitest';
import { GivebutterService } from './givebutter.service.js';

interface TxnSeed {
  id: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  amount_paid?: number;
  status?: string;
  // ISO string; defaults to "now" so it falls inside any positive lookback window.
  created_at?: string;
}

// Stub global.fetch to return a single page of transactions (last_page = 1 so the
// service stops after one fetch). All seeds default to a recent, succeeded payment.
function mockTransactions(seeds: TxnSeed[]): void {
  const data = seeds.map((s) => ({
    status: 'succeeded',
    amount_paid: 25,
    created_at: new Date().toISOString(),
    ...s,
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ data, meta: { current_page: 1, last_page: 1 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  );
}

// apiKey must be non-empty or the service short-circuits to an error result.
function makeService(): GivebutterService {
  return new GivebutterService(undefined, 'https://api.test/v1', 'test-key');
}

const MIN_USD = 20;
const LOOKBACK_MIN = 30;

describe('GivebutterService.findRecentTransactionForDonor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('verifies via exact email match', async () => {
    mockTransactions([
      {
        id: 'txn_1',
        email: 'jane@gmail.com',
        first_name: 'Jane',
        last_name: 'Donor',
        amount_paid: 25,
      },
    ]);

    const result = await makeService().findRecentTransactionForDonor(
      'jane@gmail.com',
      'Jane Donor',
      MIN_USD,
      LOOKBACK_MIN,
    );

    expect(result).toEqual({
      outcome: 'verified',
      amountUsd: 25,
      transactionId: 'txn_1',
      matchType: 'email',
    });
  });

  it('email match is case-insensitive and whitespace-trimmed', async () => {
    mockTransactions([{ id: 'txn_1', email: 'jane@gmail.com', amount_paid: 25 }]);

    const result = await makeService().findRecentTransactionForDonor(
      '  JANE@Gmail.com ',
      'Jane Donor',
      MIN_USD,
      LOOKBACK_MIN,
    );

    expect(result.outcome).toBe('verified');
    if (result.outcome === 'verified') expect(result.matchType).toBe('email');
  });

  it('falls back to name match when the email differs (typo / different account)', async () => {
    // Donor paid under jane@gmail.com but typed jane@gmial.com in the wizard.
    mockTransactions([
      {
        id: 'txn_1',
        email: 'jane@gmail.com',
        first_name: 'Jane',
        last_name: 'Donor',
        amount_paid: 30,
      },
    ]);

    const result = await makeService().findRecentTransactionForDonor(
      'jane@gmial.com',
      'Jane Donor',
      MIN_USD,
      LOOKBACK_MIN,
    );

    expect(result).toEqual({
      outcome: 'verified',
      amountUsd: 30,
      transactionId: 'txn_1',
      matchType: 'name_fallback',
    });
  });

  it('name match is case-insensitive and whitespace-normalized', async () => {
    mockTransactions([
      {
        id: 'txn_1',
        email: 'other@x.com',
        first_name: 'jane',
        last_name: 'donor',
        amount_paid: 25,
      },
    ]);

    const result = await makeService().findRecentTransactionForDonor(
      'wizard@x.com',
      '  Jane   Donor ',
      MIN_USD,
      LOOKBACK_MIN,
    );

    expect(result.outcome).toBe('verified');
    if (result.outcome === 'verified') expect(result.matchType).toBe('name_fallback');
  });

  // --- #119: order- and diacritic-insensitive name matching. Each case below is a
  // row from the issue's false-negatives table that the v1 exact matcher missed. ---

  it('matches when the wizard name carries a middle name the GB record lacks', async () => {
    mockTransactions([
      {
        id: 'txn_1',
        email: 'other@x.com',
        first_name: 'Jane',
        last_name: 'Donor',
        amount_paid: 25,
      },
    ]);

    const result = await makeService().findRecentTransactionForDonor(
      'wizard@x.com',
      'Jane Q Donor',
      MIN_USD,
      LOOKBACK_MIN,
    );

    expect(result.outcome).toBe('verified');
    if (result.outcome === 'verified') expect(result.matchType).toBe('name_fallback');
  });

  it('matches when the wizard name has first/last reversed', async () => {
    mockTransactions([
      {
        id: 'txn_1',
        email: 'other@x.com',
        first_name: 'Jane',
        last_name: 'Donor',
        amount_paid: 25,
      },
    ]);

    const result = await makeService().findRecentTransactionForDonor(
      'wizard@x.com',
      'Donor Jane',
      MIN_USD,
      LOOKBACK_MIN,
    );

    expect(result.outcome).toBe('verified');
    if (result.outcome === 'verified') expect(result.matchType).toBe('name_fallback');
  });

  it('matches the "Last, First" comma form', async () => {
    mockTransactions([
      {
        id: 'txn_1',
        email: 'other@x.com',
        first_name: 'Jane',
        last_name: 'Donor',
        amount_paid: 25,
      },
    ]);

    const result = await makeService().findRecentTransactionForDonor(
      'wizard@x.com',
      'Donor, Jane',
      MIN_USD,
      LOOKBACK_MIN,
    );

    expect(result.outcome).toBe('verified');
    if (result.outcome === 'verified') expect(result.matchType).toBe('name_fallback');
  });

  it('matches across accents/diacritics (José García == Jose Garcia)', async () => {
    mockTransactions([
      {
        id: 'txn_1',
        email: 'other@x.com',
        first_name: 'José',
        last_name: 'García',
        amount_paid: 25,
      },
    ]);

    const result = await makeService().findRecentTransactionForDonor(
      'wizard@x.com',
      'Jose Garcia',
      MIN_USD,
      LOOKBACK_MIN,
    );

    expect(result.outcome).toBe('verified');
    if (result.outcome === 'verified') expect(result.matchType).toBe('name_fallback');
  });

  it('matches an uneven first/last split (Mary Anne Smith == Mary / Anne Smith)', async () => {
    mockTransactions([
      {
        id: 'txn_1',
        email: 'other@x.com',
        first_name: 'Mary',
        last_name: 'Anne Smith',
        amount_paid: 25,
      },
    ]);

    const result = await makeService().findRecentTransactionForDonor(
      'wizard@x.com',
      'Mary Anne Smith',
      MIN_USD,
      LOOKBACK_MIN,
    );

    expect(result.outcome).toBe('verified');
    if (result.outcome === 'verified') expect(result.matchType).toBe('name_fallback');
  });

  it('does NOT match on a lone shared first name (guards against over-loosening)', async () => {
    // Wizard supplied only "Jane"; GB record is "Jane Donor". A single shared token
    // must not be enough to dispatch — otherwise any "Jane" would match.
    mockTransactions([
      {
        id: 'txn_1',
        email: 'other@x.com',
        first_name: 'Jane',
        last_name: 'Donor',
        amount_paid: 25,
      },
    ]);

    const result = await makeService().findRecentTransactionForDonor(
      'wizard@x.com',
      'Jane',
      MIN_USD,
      LOOKBACK_MIN,
    );

    expect(result).toEqual({ outcome: 'rejected', reason: 'not_found' });
  });

  it('still rejects genuinely different names that share no tokens', async () => {
    mockTransactions([
      { id: 'txn_1', email: 'other@x.com', first_name: 'Bob', last_name: 'Smith', amount_paid: 25 },
    ]);

    const result = await makeService().findRecentTransactionForDonor(
      'wizard@x.com',
      'Jane Donor',
      MIN_USD,
      LOOKBACK_MIN,
    );

    expect(result).toEqual({ outcome: 'rejected', reason: 'not_found' });
  });

  it('keeps the ambiguity guard under loosened matching (diacritic variants, distinct emails)', async () => {
    // Two distinct donors whose names both normalize to "jose garcia" — still too
    // ambiguous to auto-dispatch even though the loosened matcher now hits both.
    mockTransactions([
      {
        id: 'txn_a',
        email: 'jose.a@x.com',
        first_name: 'José',
        last_name: 'García',
        amount_paid: 25,
      },
      {
        id: 'txn_b',
        email: 'jose.b@y.com',
        first_name: 'Jose',
        last_name: 'Garcia',
        amount_paid: 25,
      },
    ]);

    const result = await makeService().findRecentTransactionForDonor(
      'wizard@x.com',
      'Jose Garcia',
      MIN_USD,
      LOOKBACK_MIN,
    );

    expect(result).toEqual({ outcome: 'rejected', reason: 'not_found' });
  });

  it('rejects when neither email nor name match', async () => {
    mockTransactions([
      {
        id: 'txn_1',
        email: 'someone@else.com',
        first_name: 'Bob',
        last_name: 'Smith',
        amount_paid: 25,
      },
    ]);

    const result = await makeService().findRecentTransactionForDonor(
      'jane@gmail.com',
      'Jane Donor',
      MIN_USD,
      LOOKBACK_MIN,
    );

    expect(result).toEqual({ outcome: 'rejected', reason: 'not_found' });
  });

  it('prefers the email match even when a name-only match also exists', async () => {
    mockTransactions([
      // Name match under a different email appears first (more recent)...
      {
        id: 'txn_name',
        email: 'imposter@x.com',
        first_name: 'Jane',
        last_name: 'Donor',
        amount_paid: 99,
      },
      // ...but the real email match should win.
      {
        id: 'txn_email',
        email: 'jane@gmail.com',
        first_name: 'Jane',
        last_name: 'Donor',
        amount_paid: 25,
      },
    ]);

    const result = await makeService().findRecentTransactionForDonor(
      'jane@gmail.com',
      'Jane Donor',
      MIN_USD,
      LOOKBACK_MIN,
    );

    expect(result.outcome).toBe('verified');
    if (result.outcome === 'verified') {
      expect(result.transactionId).toBe('txn_email');
      expect(result.matchType).toBe('email');
    }
  });

  it('rejects ambiguous name matches across two distinct emails', async () => {
    // Two different people named "Jane Donor", neither matching the wizard email.
    mockTransactions([
      {
        id: 'txn_a',
        email: 'jane.a@x.com',
        first_name: 'Jane',
        last_name: 'Donor',
        amount_paid: 25,
      },
      {
        id: 'txn_b',
        email: 'jane.b@y.com',
        first_name: 'Jane',
        last_name: 'Donor',
        amount_paid: 25,
      },
    ]);

    const result = await makeService().findRecentTransactionForDonor(
      'jane@gmail.com',
      'Jane Donor',
      MIN_USD,
      LOOKBACK_MIN,
    );

    expect(result).toEqual({ outcome: 'rejected', reason: 'not_found' });
  });

  it('treats two donations from the same non-matching email as a single (non-ambiguous) name match', async () => {
    mockTransactions([
      {
        id: 'txn_new',
        email: 'jane.work@x.com',
        first_name: 'Jane',
        last_name: 'Donor',
        amount_paid: 40,
      },
      {
        id: 'txn_old',
        email: 'jane.work@x.com',
        first_name: 'Jane',
        last_name: 'Donor',
        amount_paid: 25,
      },
    ]);

    const result = await makeService().findRecentTransactionForDonor(
      'jane@gmail.com',
      'Jane Donor',
      MIN_USD,
      LOOKBACK_MIN,
    );

    expect(result.outcome).toBe('verified');
    if (result.outcome === 'verified') {
      // First (most recent) transaction for that email wins.
      expect(result.transactionId).toBe('txn_new');
      expect(result.matchType).toBe('name_fallback');
    }
  });

  it('ignores name matches below the donation minimum', async () => {
    mockTransactions([
      {
        id: 'txn_low',
        email: 'other@x.com',
        first_name: 'Jane',
        last_name: 'Donor',
        amount_paid: 5,
      },
    ]);

    const result = await makeService().findRecentTransactionForDonor(
      'jane@gmail.com',
      'Jane Donor',
      MIN_USD,
      LOOKBACK_MIN,
    );

    expect(result).toEqual({ outcome: 'rejected', reason: 'not_found' });
  });

  it('does not name-match when the donor name is empty', async () => {
    mockTransactions([
      { id: 'txn_1', email: 'other@x.com', first_name: '', last_name: '', amount_paid: 25 },
    ]);

    const result = await makeService().findRecentTransactionForDonor(
      'jane@gmail.com',
      '   ',
      MIN_USD,
      LOOKBACK_MIN,
    );

    expect(result).toEqual({ outcome: 'rejected', reason: 'not_found' });
  });

  it('returns an error result when the API key is not configured', async () => {
    const svc = new GivebutterService(undefined, 'https://api.test/v1', '');
    const result = await svc.findRecentTransactionForDonor(
      'jane@gmail.com',
      'Jane Donor',
      MIN_USD,
      LOOKBACK_MIN,
    );
    expect(result).toEqual({ outcome: 'error', reason: 'givebutter_api_key_not_configured' });
  });
});
