import { getPickupDonationMinUsd } from '../validators.js';

export type GivebutterVerification =
  | {
      outcome: 'verified';
      amountUsd: number;
      transactionId: string;
    }
  | { outcome: 'rejected'; reason: 'not_found' | 'below_minimum' }
  | { outcome: 'error'; reason: string };

export class GivebutterService {
  constructor(
    private readonly apiBaseUrl: string = process.env['GIVEBUTTER_API_BASE_URL'] ??
      'https://api.givebutter.com/v1',
    private readonly apiKey: string = process.env['GIVEBUTTER_API_KEY'] ?? '',
  ) {}

  async findRecentTransactionForDonor(requestId: string): Promise<GivebutterVerification> {
    if (!this.apiKey) {
      return { outcome: 'error', reason: 'givebutter_api_key_not_configured' };
    }

    const minimumUsd = getPickupDonationMinUsd();
    const timeoutMs = 8000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const url = `${this.apiBaseUrl}/transactions?sortByDesc=created_at`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        return { outcome: 'error', reason: `givebutter_http_${res.status}` };
      }

      const body = await res.json();
      const transactions = body.data;
      for (const transaction of transactions) {
        if (transaction.utm_parameters?.utm_campaign === requestId) {
          return transaction.amount >= minimumUsd
            ? {
                outcome: 'verified',
                amountUsd: transaction.amount,
                transactionId: transaction.id,
              }
            : { outcome: 'rejected', reason: 'below_minimum' };
        }
      }

      // if we never find a matching transaction
      return { outcome: 'rejected', reason: 'not_found' };
    } catch (err) {
      console.error(err);
      return { outcome: 'error', reason: 'givebutter_failure' };
    } finally {
      clearTimeout(timer);
    }
  }
}
