import { ContributionSessionResponse, CreateContributionSessionPayload } from '../models.js';

// How a transaction was matched back to the donor. `email` is the strong signal
// (donor's wizard email == transaction email). `name_fallback` means the email
// didn't match anything in the window but the donor's full name did — see #63.
// Persisted on the verification doc so ops can audit fallback matches.
export type VerificationMatchType = 'email' | 'name_fallback';

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
  | { kind: 'verified'; amountUsd: number; transactionId: string; matchType: VerificationMatchType }
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
  //
  // Matching priority (see #63): an email match always wins and short-circuits the
  // scan. If no email matches anywhere in the window, we fall back to matching the
  // donor's full name against the transaction's first/last name — this rescues donors
  // who paid under a different/typo'd email than they typed in the wizard.
  //
  // Name comparison (see #119) is order-insensitive and diacritic-insensitive: both
  // sides are tokenized after NFKD-normalizing and stripping combining marks, so
  // "Jose Garcia" matches "José"/"García", "Donor Jane" matches "Jane"/"Donor", and a
  // wizard middle name ("Jane Q Donor") still matches "Jane"/"Donor". We deliberately
  // stop short of typo-tolerant fuzzy matching (Levenshtein) — see the issue's
  // out-of-scope list. Givebutter's transaction fields are confirmed to be top-level
  // `first_name` / `last_name` / `email` (there is no standalone combined `name`; the
  // `giving_space.name` field is a display label, not a reliable donor identity, so we
  // don't match on it). A genuinely ambiguous window (name matches across two or more
  // *distinct* emails) is still rejected rather than risk dispatching for the wrong
  // donation.
  async findRecentTransactionForDonor(
    donorEmail: string,
    donorFullName: string,
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

    const donorTokens = nameTokens(donorFullName);

    const cutoffMs = Date.now() - lookbackMinutes * 60_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.verificationTimeoutMs);

    // Name-fallback candidates collected while scanning. Only consulted if no
    // transaction matched by email. Keyed by transaction email so we can tell a
    // single donor (one email, possibly two donations) apart from genuinely
    // ambiguous matches (the same name across two different emails).
    const nameCandidates = new Map<string, { amountUsd: number; transactionId: string }>();

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
            first_name?: string;
            last_name?: string;
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

          const status = typeof txn.status === 'string' ? txn.status.toLowerCase() : '';
          if (status && status !== 'succeeded' && status !== 'completed' && status !== 'paid') {
            // Payment status isn't terminal-success — skip for both match paths.
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

          if (amountPaid === undefined || amountPaid < minimumUsd) {
            // Below our minimum (or unparseable). Givebutter's widget enforces the
            // minimum on its side, so this shouldn't happen for app-originated
            // donations; ignore for both email and name matching.
            continue;
          }

          const txnEmail = (txn.email ?? txn.contact_email ?? '').trim().toLowerCase();
          if (txnEmail === normalizedEmail) {
            // Strong signal — short-circuit immediately.
            return {
              kind: 'verified',
              amountUsd: amountPaid,
              transactionId: typeof txn.id === 'string' ? txn.id : '',
              matchType: 'email',
            };
          }

          // No email match. Stash as a name-fallback candidate if the name lines up.
          if (
            donorTokens.size > 0 &&
            nameTokensMatch(donorTokens, nameTokens(`${txn.first_name ?? ''} ${txn.last_name ?? ''}`)) &&
            !nameCandidates.has(txnEmail)
          ) {
            // First (most recent) transaction per distinct email wins.
            nameCandidates.set(txnEmail, {
              amountUsd: amountPaid,
              transactionId: typeof txn.id === 'string' ? txn.id : '',
            });
          }
        }

        if (crossedCutoff) {
          break;
        }
        const lastPage = body.meta?.last_page;
        if (typeof lastPage === 'number' && page >= lastPage) {
          break;
        }
      }

      // No email match anywhere in the window — try the name fallback.
      if (nameCandidates.size === 1) {
        const [candidate] = [...nameCandidates.values()];
        return {
          kind: 'verified',
          amountUsd: candidate.amountUsd,
          transactionId: candidate.transactionId,
          matchType: 'name_fallback',
        };
      }
      if (nameCandidates.size > 1) {
        // Same name across two or more distinct emails — too ambiguous to safely
        // auto-dispatch. Reject; the donor falls into the recovery path.
        console.warn('Givebutter name fallback ambiguous; rejecting', {
          donorTokens: [...donorTokens].join(' '),
          distinctEmails: nameCandidates.size,
        });
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

// Tokenize a name for order- and diacritic-insensitive comparison (see #119):
//   1. NFKD-normalize and strip combining marks so "José" -> "jose", "García" -> "garcia".
//   2. Lowercase and replace any non-letter/non-number (commas, periods, hyphens) with
//      whitespace so "Donor, Jane" and "Anne-Marie" tokenize cleanly.
//   3. Split on whitespace into a set of distinct tokens.
// Returns an empty set for empty/whitespace-only input, which callers treat as
// "no name to match on".
function nameTokens(name: string): Set<string> {
  const tokens = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return new Set(tokens);
}

// Decide whether two tokenized names refer to the same person. Order-insensitive by
// construction (sets). A match requires one token set to be contained in the other:
//   - Equal sets always match (covers reversed order, accents, and mononyms).
//   - A strict subset matches only when the smaller set has 2+ tokens, so a wizard
//     middle name ("jane q donor" ⊇ "jane donor") or an uneven first/last split is
//     tolerated, but a lone common first name ("jane" ⊆ "jane donor") is NOT enough.
// Empty sets never match. The multi-email ambiguity guard still applies upstream.
function nameTokensMatch(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of small) {
    if (!large.has(token)) return false;
  }
  if (small.size === large.size) return true;
  return small.size >= 2;
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
