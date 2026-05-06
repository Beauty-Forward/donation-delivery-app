// MOCK Resend integration. Mirrors the existing MockRoadieCourierProvider /
// MockShippingLabelProvider pattern: log what would be sent so the rest of the
// pipeline (verifyContributionAndDispatch trigger) can be verified end-to-end
// without a real Resend account. A follow-up PR will replace the body of
// `sendDonationIssueEmail` with a real Resend API call.
//
// Real implementation reference: https://resend.com/docs/send-with-node

export type DonationVerificationFailureReason =
  | 'not_found'
  | 'incomplete'
  | 'amount_below_minimum';

export interface DonationIssueEmailParams {
  donorEmail: string;
  donorName: string;
  requestId: string;
  reason: DonationVerificationFailureReason;
  amountPaid?: number;
  minimumUsd: number;
}

export class ResendEmailService {
  private readonly apiKey: string;

  constructor(apiKey: string = process.env['RESEND_API_KEY'] ?? '') {
    this.apiKey = apiKey;
  }

  async sendDonationIssueEmail(params: DonationIssueEmailParams): Promise<void> {
    // TODO: replace with a real Resend API call. For now, log so the trigger flow
    // is verifiable end-to-end. The follow-up PR will use this.apiKey to authenticate.
    console.warn('[mock-resend] would send donation-issue email', {
      to: params.donorEmail,
      donorName: params.donorName,
      subject: "There was an issue with your donation",
      requestId: params.requestId,
      reason: params.reason,
      amountPaid: params.amountPaid,
      minimumUsd: params.minimumUsd,
      apiKeyConfigured: this.apiKey.length > 0
    });
  }
}
