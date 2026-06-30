import { afterEach, describe, expect, it, vi } from 'vitest';
import { GivebutterService } from './givebutter.service.js';

interface TxnSeed {
  id: string;
  // Becomes utm_parameters.utm_campaign. Omit to simulate a transaction that did not
  // come through our flow (a direct campaign donation) — those carry no UTM.
  utmCampaign?: string;
  amount?: number;
}

// Stub global.fetch with one page of transactions. amount defaults above the $15
// donation minimum, so a seeded transaction verifies unless a test says otherwise.
function mockTransactions(seeds: TxnSeed[]): void {
  const data = seeds.map(({ id, utmCampaign, amount = 25 }) => ({
    id,
    amount,
    utm_parameters: utmCampaign ? { utm_campaign: utmCampaign } : null,
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ data }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  );
}

// apiKey must be non-empty or the service short-circuits to an error result.
function makeService(): GivebutterService {
  return new GivebutterService('https://api.test/v1', 'test-key');
}

describe('GivebutterService.findRecentTransactionForDonor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('verifies the transaction whose utm_campaign matches the requestId', async () => {
    mockTransactions([{ id: 'txn_1', utmCampaign: 'req_abc', amount: 25 }]);

    const result = await makeService().findRecentTransactionForDonor('req_abc');

    expect(result).toEqual({ outcome: 'verified', amountUsd: 25, transactionId: 'txn_1' });
  });

  it('finds the matching requestId among unrelated transactions', async () => {
    mockTransactions([
      { id: 'txn_other', utmCampaign: 'req_zzz', amount: 50 },
      { id: 'txn_mine', utmCampaign: 'req_abc', amount: 25 },
    ]);

    const result = await makeService().findRecentTransactionForDonor('req_abc');

    expect(result.outcome).toBe('verified');
    if (result.outcome === 'verified') expect(result.transactionId).toBe('txn_mine');
  });

  it('skips transactions with no utm_parameters without crashing', async () => {
    // Most transactions on the campaign are direct donations with no UTM; the scan
    // must step over them (optional chaining) rather than throwing.
    mockTransactions([
      { id: 'txn_direct' }, // utm_parameters: null
      { id: 'txn_mine', utmCampaign: 'req_abc', amount: 25 },
    ]);

    const result = await makeService().findRecentTransactionForDonor('req_abc');

    expect(result.outcome).toBe('verified');
    if (result.outcome === 'verified') expect(result.transactionId).toBe('txn_mine');
  });

  it('rejects below_minimum when the matched transaction is under the donation minimum', async () => {
    mockTransactions([{ id: 'txn_low', utmCampaign: 'req_abc', amount: 5 }]);

    const result = await makeService().findRecentTransactionForDonor('req_abc');

    expect(result).toEqual({ outcome: 'rejected', reason: 'below_minimum' });
  });

  it('rejects not_found when no transaction matches the requestId', async () => {
    mockTransactions([{ id: 'txn_1', utmCampaign: 'req_other', amount: 25 }]);

    const result = await makeService().findRecentTransactionForDonor('req_abc');

    expect(result).toEqual({ outcome: 'rejected', reason: 'not_found' });
  });

  it('returns an error when the API key is not configured', async () => {
    const result = await new GivebutterService(
      'https://api.test/v1',
      '',
    ).findRecentTransactionForDonor('req_abc');

    expect(result).toEqual({ outcome: 'error', reason: 'givebutter_api_key_not_configured' });
  });

  it('returns an error when the API responds non-OK', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 500 })),
    );

    const result = await makeService().findRecentTransactionForDonor('req_abc');

    expect(result).toEqual({ outcome: 'error', reason: 'givebutter_http_500' });
  });

  it('returns an error when the fetch throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    const result = await makeService().findRecentTransactionForDonor('req_abc');

    expect(result).toEqual({ outcome: 'error', reason: 'givebutter_failure' });
  });
});
