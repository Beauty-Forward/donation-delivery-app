import { ContributionSessionResponse, CreateContributionSessionPayload } from '../models.js';

// Discriminated union returned by findRecentTransactionForDonor. The verification
// path branches on `kind` to decide whether to dispatch the courier, mark the
// request as failed (and email the donor), or fall back to the webhook recovery path.
//
// `reason: 'not_found'` is the only rejection variant today: the Givebutter widget
// enforces the donation minimum on its side, and widget payments are atomic (either
// they happened or they didn't — there's no "incomplete" state we observe).
// `incomplete` and `amount_below_minimum` were defensive branches; both were dead.
// If Givebutter's behavior diverges in the future, expand this union explicitly.
export type GivebutterVerification =
  | { kind: 'verified'; amountUsd: number; transactionId: string }
  | { kind: 'rejected'; reason: 'not_found' }
  | { kind: 'error'; reason: string };

export class GivebutterService {
  // The Givebutter REST API base. Override in tests / staging via env.
  private readonly apiBaseUrl: string;
  private readonly apiKey: string;
  private readonly verificationTimeoutMs: number;

  constructor(
    private readonly campaignUrl = process.env['GIVEBUTTER_CAMPAIGN_URL'] ??
      'https://givebutter.com/beauty-forward',
    apiBaseUrl: string = process.env['GIVEBUTTER_API_BASE_URL'] ?? 'https://api.givebutter.com/v1',
    apiKey: string = process.env['GIVEBUTTER_API_KEY'] ?? '',
    verificationTimeoutMs = 8000,
  ) {
    this.apiBaseUrl = apiBaseUrl;
    this.apiKey = apiKey;
    this.verificationTimeoutMs = verificationTimeoutMs;
  }

  async createCheckoutSession(
    payload: CreateContributionSessionPayload,
  ): Promise<ContributionSessionResponse> {
    // TODO: Replace this URL builder with a real Givebutter API session creation call.
    const checkoutUrl = new URL(this.campaignUrl);

    if (payload.amountUsd) {
      checkoutUrl.searchParams.set('amount', Math.round(payload.amountUsd).toString());
    }

    if (payload.requestId) {
      checkoutUrl.searchParams.set('requestId', payload.requestId);
    }

    checkoutUrl.searchParams.set('utm_source', 'beauty_forward_donation_flow');

    return {
      provider: 'givebutter',
      sessionId: `gb_mock_${Date.now()}`,
      checkoutUrl: checkoutUrl.toString(),
    };
  }

  // Server-to-server verification by donor email. The Widgets SDK's donation.complete
  // event doesn't reliably propagate from the iframe to our parent page (especially
  // through Google Pay popups), so we can't capture a sessionId client-side. Instead,
  // after the donor explicitly confirms they've finished donating, we paginate
  // Givebutter's /v1/transactions endpoint and look for a recent transaction matching
  // the donor's email + amount >= minimum + within the lookback window.
  //
  // Note: Givebutter's API does not support server-side filtering by email, date, or
  // amount as of this writing (community feedback request open since Dec 2023). We
  // pull pages of transactions sorted by recency and filter in-process. This is
  // acceptable for Beauty Forward's volume; revisit if the dataset grows large.
  async findRecentTransactionForDonor(
    donorEmail: string,
    minimumUsd: number,
    lookbackMinutes: number,
  ): Promise<GivebutterVerification> {
    if (!this.apiKey) {
      return { kind: 'error', reason: 'givebutter_api_key_not_configured' };
    }

    const normalizedEmail = donorEmail.trim().toLowerCase();
    if (!normalizedEmail) {
      return { kind: 'rejected', reason: 'not_found' };
    }

    const cutoffMs = Date.now() - lookbackMinutes * 60_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.verificationTimeoutMs);

    try {
      const maxPages = 5;
      const perPage = 50;

      for (let page = 1; page <= maxPages; page += 1) {
        const url = `${this.apiBaseUrl}/transactions?per_page=${perPage}&page=${page}`;
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'application/json',
          },
          signal: controller.signal,
        });

        if (!res.ok) {
          return { kind: 'error', reason: `givebutter_http_${res.status}` };
        }

        const body = (await res.json()) as {
          data?: Array<{
            id?: string;
            email?: string;
            contact_email?: string;
            amount?: number;
            amount_paid?: number;
            total?: number;
            status?: string;
            created_at?: string;
            timestamp?: string | number;
          }>;
          meta?: { current_page?: number; last_page?: number };
        };

        const transactions = body.data ?? [];
        if (transactions.length === 0) {
          break;
        }

        // Walk this page; bail early once we cross the lookback cutoff (recent-first).
        let crossedCutoff = false;
        for (const txn of transactions) {
          const createdMs = parseTransactionTimestamp(txn.created_at, txn.timestamp);
          if (createdMs !== undefined && createdMs < cutoffMs) {
            crossedCutoff = true;
            break;
          }

          const txnEmail = (txn.email ?? txn.contact_email ?? '').trim().toLowerCase();
          if (txnEmail !== normalizedEmail) {
            continue;
          }

          const status = typeof txn.status === 'string' ? txn.status.toLowerCase() : '';
          if (status && status !== 'succeeded' && status !== 'completed' && status !== 'paid') {
            // Email match but payment status isn't terminal-success — skip.
            continue;
          }

          const amountPaid =
            typeof txn.amount_paid === 'number'
              ? txn.amount_paid
              : typeof txn.amount === 'number'
                ? txn.amount
                : typeof txn.total === 'number'
                  ? txn.total
                  : undefined;

          if (amountPaid === undefined) {
            continue;
          }

          if (amountPaid >= minimumUsd) {
            return {
              kind: 'verified',
              amountUsd: amountPaid,
              transactionId: typeof txn.id === 'string' ? txn.id : '',
            };
          }

          // Email match but under our minimum — Givebutter's widget enforces the
          // minimum on its side, so this shouldn't happen for app-originated donations.
          // Treat as not_found (donor never made a valid pickup donation).
        }

        if (crossedCutoff) {
          break;
        }
        const lastPage = body.meta?.last_page;
        if (typeof lastPage === 'number' && page >= lastPage) {
          break;
        }
      }

      return { kind: 'rejected', reason: 'not_found' };
    } catch (err) {
      const reason =
        err instanceof Error && err.name === 'AbortError'
          ? 'givebutter_timeout'
          : 'givebutter_network_error';
      return { kind: 'error', reason };
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseTransactionTimestamp(
  createdAt?: string,
  timestamp?: string | number,
): number | undefined {
  if (typeof createdAt === 'string') {
    const ms = Date.parse(createdAt);
    if (!Number.isNaN(ms)) return ms;
  }
  if (typeof timestamp === 'number') {
    // Givebutter sometimes returns unix seconds; bump to ms if it looks like seconds.
    return timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  }
  if (typeof timestamp === 'string') {
    const ms = Date.parse(timestamp);
    if (!Number.isNaN(ms)) return ms;
  }
  return undefined;
}
