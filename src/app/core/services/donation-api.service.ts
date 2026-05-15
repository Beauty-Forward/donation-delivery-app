import { Injectable } from '@angular/core';
import { addDoc, collection, doc, setDoc } from 'firebase/firestore';
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

    const donationRef = await addDoc(
      collection(this.firebaseClient.firestore, 'donation_requests'),
      donationDocument,
    );

    const typedCollectionName = `${payload.donationType}_requests`;
    const typedDocRef = doc(this.firebaseClient.firestore, typedCollectionName, donationRef.id);
    await setDoc(typedDocRef, {
      donationRequestId: donationRef.id,
      ...donationDocument,
    });

    const dropoffReference =
      payload.donationType === 'dropoff'
        ? `BFD-${nowIso.slice(0, 10).replace(/-/g, '')}-${donationRef.id.slice(0, 6).toUpperCase()}`
        : undefined;

    return {
      requestId: donationRef.id,
      donationType: payload.donationType,
      status,
      createdAt: nowIso,
      dropoffReference,
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
        return 'pending_label_purchase';
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
        'We will send shipping label instructions to your email address.',
        'After shipping, save your receipt so we can trace delivery if needed.',
      ];
    }

    return [
      'Bring your items to the warehouse during your selected window.',
      'Share your drop-off reference at check-in for faster handoff.',
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
