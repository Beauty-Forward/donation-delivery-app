import { Injectable } from '@angular/core';
import { doc, getDoc, onSnapshot, runTransaction } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { environment } from '../../../environments/environment';
import {
  ContributionSessionResponse,
  CreateContributionSessionPayload,
  CreateDonationRequestPayload,
  DonationRequestDocument,
  DonationStatus,
  DonationSubmissionResult,
  DonationType,
} from '../models/donation.models';
import { FirebaseClientService } from './firebase-client.service';
import { WarehouseConfigService } from './warehouse-config.service';

@Injectable({
  providedIn: 'root',
})
export class DonationApiService {
  constructor(
    private readonly firebaseClient: FirebaseClientService,
    private readonly warehouseConfig: WarehouseConfigService,
  ) {}

  async createDonationRequest(
    payload: CreateDonationRequestPayload,
  ): Promise<DonationSubmissionResult> {
    try {
      // 45s timeout. The callable now runs synchronous Givebutter verification + Roadie
      // dispatch inline (~5–15s typical), so we need more headroom than the old fire-
      // and-forget flow. If we still time out, fall through to the direct-Firestore
      // fallback — the verifyContributionAndDispatch trigger backstops verification
      // out-of-band and the donor sees the failure pane (no false "success").
      const callable = httpsCallable<CreateDonationRequestPayload, DonationSubmissionResult>(
        this.firebaseClient.functions,
        'createDonationRequest',
        { timeout: 45_000 },
      );
      const result = await callable(payload);
      return result.data;
    } catch (err) {
      // Surface the callable's error so we can see which validator field rejected the
      // payload (Firebase callables put the message in err.message; sometimes the
      // server-side detail is in err.details). Without this log, we just see "400" in
      // Network tab and have no way to debug.
      console.warn(
        'createDonationRequest callable failed; falling back to direct Firestore write',
        err,
      );
      return this.createDonationRequestFallback(payload);
    }
  }

  /**
   * Subscribe to a donation_request's status in real time. `onStatus` fires on every
   * change with the doc's current status — the Givebutter webhook flips it to
   * 'queued_for_dispatch' once payment is confirmed and the courier is booked.
   * Returns an unsubscribe function; the caller MUST call it to stop listening.
   */
  watchDonationStatus(
    requestId: string,
    onStatus: (status: DonationStatus | undefined) => void,
  ): () => void {
    const ref = doc(this.firebaseClient.firestore, 'donation_requests', requestId);
    return onSnapshot(ref, (snap) => {
      onStatus(snap.data()?.['status'] as DonationStatus | undefined);
    });
  }

  async createContributionSession(
    payload: CreateContributionSessionPayload,
  ): Promise<ContributionSessionResponse> {
    try {
      const callable = httpsCallable<CreateContributionSessionPayload, ContributionSessionResponse>(
        this.firebaseClient.functions,
        'createContributionSession',
      );
      const result = await callable(payload);
      return result.data;
    } catch {
      return {
        provider: 'givebutter',
        sessionId: `gb_mock_${Date.now()}`,
        checkoutUrl: this.buildFallbackGivebutterUrl(payload.amountUsd),
      };
    }
  }

  private async createDonationRequestFallback(
    payload: CreateDonationRequestPayload,
  ): Promise<DonationSubmissionResult> {
    const nowIso = new Date().toISOString();
    const status = this.getInitialStatus(payload.donationType);

    const donationDocument: DonationRequestDocument = {
      ...payload,
      status,
      createdAt: nowIso,
      updatedAt: nowIso,
      warehouse: this.warehouseConfig.destination,
      metadata: {
        ...payload.metadata,
        source: 'frontend_firestore_fallback',
      },
    };

    const requestId = payload.requestId;
    const firestore = this.firebaseClient.firestore;
    const donationRef = doc(firestore, 'donation_requests', requestId);

    await runTransaction(firestore, async (tx) => {
      const existing = await tx.get(donationRef);
      if (existing.exists()) {
        return; // callable (or a prior retry) already created it — don't clobber
      }
      tx.set(donationRef, donationDocument);
    });

    // The callable may have advanced the doc past the initial status (e.g. to
    // queued_for_dispatch). Reflect whatever is actually persisted.
    const finalStatus =
      ((await getDoc(donationRef)).data()?.['status'] as DonationStatus) ?? status;

    return {
      requestId,
      donationType: payload.donationType,
      status: finalStatus,
      createdAt: nowIso,
      nextSteps: this.buildNextSteps(payload.donationType),
    };
  }

  private getInitialStatus(type: DonationType): DonationStatus {
    switch (type) {
      case 'pickup':
        // Matches the createDonationRequest function path. The verification trigger is
        // server-only; if we hit this fallback (callable failed), the doc still lands
        // in verifying_payment and the Givebutter webhook is the only recovery path.
        return 'verifying_payment';
      case 'shipping':
        return 'awaiting_shipment';
      case 'dropoff':
        return 'dropoff_requested';
      default:
        return 'submitted';
    }
  }

  private buildNextSteps(type: DonationType): string[] {
    if (type === 'pickup') {
      return [
        'We will confirm your courier assignment by email and text shortly.',
        'Please keep your donation packed and accessible during your selected window.',
      ];
    }

    if (type === 'shipping') {
      return [
        'Ship your items to the warehouse address in your confirmation email.',
        'After shipping, save your receipt so we can trace delivery if needed.',
      ];
    }

    return [
      'Bring your items to the warehouse during your selected window.',
      'Check in with your name at the front desk when you arrive.',
    ];
  }

  private buildFallbackGivebutterUrl(amountUsd?: number): string {
    const baseUrl = environment.integrations.givebutter.publicCampaignUrl;

    try {
      const url = new URL(baseUrl);
      if (amountUsd && amountUsd > 0) {
        url.searchParams.set('amount', Math.round(amountUsd).toString());
      }
      url.searchParams.set('utm_source', 'beauty_forward_donation_flow');
      return url.toString();
    } catch {
      return baseUrl;
    }
  }
}
