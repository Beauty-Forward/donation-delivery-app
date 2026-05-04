import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onRequest } from 'firebase-functions/v2/https';
import { SchemaType, VertexAI } from '@google-cloud/vertexai';
import {
  CreateContributionSessionPayload,
  CreateDonationRequestPayload,
  DonationStatus,
  DonationSubmissionResult
} from './models.js';
import { MockRoadieCourierProvider } from './providers/mock-roadie-provider.js';
import { MockShippingLabelProvider } from './providers/mock-shipping-label-provider.js';
import { GivebutterService } from './services/givebutter.service.js';
import { HubspotService } from './services/hubspot.service.js';
import { generateDropoffReference } from './utils/dropoff-reference.js';
import {
  createContributionSessionSchema,
  createDonationRequestSchema
} from './validators.js';

initializeApp();

const db = getFirestore();
// Strip undefined values from documents instead of throwing. The donation
// payload has three optional sub-objects (pickup / shipping / dropoff), only
// one of which is populated per request — without this, the runTransaction
// below fails with "Cannot use \"undefined\" as a Firestore value".
db.settings({ ignoreUndefinedProperties: true });
const courierProvider = new MockRoadieCourierProvider();
const shippingLabelProvider = new MockShippingLabelProvider();
const givebutterService = new GivebutterService();
const hubspotService = new HubspotService();

export const createDonationRequest = onCall({ region: 'us-central1' }, async (request) => {
  const parsed = createDonationRequestSchema.safeParse(request.data);

  if (!parsed.success) {
    throw new HttpsError('invalid-argument', parsed.error.flatten().formErrors.join(' '));
  }

  const payload = parsed.data as CreateDonationRequestPayload;
  const createdAt = Timestamp.now();
  const requestRef = db.collection('donation_requests').doc();

  let status: DonationStatus = 'submitted';
  let dropoffReference: string | undefined;
  let courierDispatchId: string | undefined;
  let shippingLabelReference: string | undefined;

  if (payload.donationType === 'pickup' && payload.pickup) {
    const dispatch = await courierProvider.dispatchPickup({
      requestId: requestRef.id,
      donor: payload.donor,
      pickup: payload.pickup
    });
    status = 'queued_for_dispatch';
    courierDispatchId = dispatch.dispatchId;
  }

  if (payload.donationType === 'shipping' && payload.shipping) {
    status = 'pending_label_purchase';

    if (payload.shipping.shippingLabelRequested) {
      const labelIntent = await shippingLabelProvider.createLabelIntent({
        requestId: requestRef.id,
        shipping: payload.shipping
      });
      shippingLabelReference = labelIntent.quoteId;
    }
  }

  if (payload.donationType === 'dropoff' && payload.dropoff) {
    status = 'dropoff_requested';
    dropoffReference = generateDropoffReference();
    payload.dropoff.referenceCode = dropoffReference;
  }

  const baseDoc = {
    donationType: payload.donationType,
    donor: payload.donor,
    contribution: payload.contribution,
    pickup: payload.pickup,
    shipping: payload.shipping,
    dropoff: payload.dropoff,
    status,
    createdAt,
    updatedAt: createdAt,
    metadata: {
      ...payload.metadata,
      source: 'public-web',
      courierDispatchId,
      shippingLabelReference
    }
  };

  const typedCollectionName = `${payload.donationType}_requests`;

  await db.runTransaction(async (transaction) => {
    transaction.set(requestRef, baseDoc);
    transaction.set(db.collection(typedCollectionName).doc(requestRef.id), {
      donationRequestId: requestRef.id,
      ...baseDoc
    });
  });

  const metaCity =
    typeof payload.metadata?.['city'] === 'string'
      ? (payload.metadata['city'] as string)
      : undefined;
  const metaState =
    typeof payload.metadata?.['state'] === 'string'
      ? (payload.metadata['state'] as string)
      : undefined;
  const city =
    metaCity ?? payload.pickup?.pickupAddress?.city ?? payload.shipping?.senderAddress?.city;
  const state =
    metaState ?? payload.pickup?.pickupAddress?.state ?? payload.shipping?.senderAddress?.state;
  const packageSize =
    typeof payload.metadata?.['packageSize'] === 'string'
      ? (payload.metadata['packageSize'] as string)
      : undefined;

  await hubspotService
    .upsertDonorContact({
      email: payload.donor.email,
      fullName: payload.donor.fullName,
      phone: payload.donor.phone,
      donationMethod: payload.donationType,
      donationAmountUsd: payload.contribution.amountUsd,
      city,
      state,
      packageSize
    })
    .catch((err) => console.warn('HubSpot upsert failed', err));

  return {
    requestId: requestRef.id,
    donationType: payload.donationType,
    status,
    createdAt: createdAt.toDate().toISOString(),
    dropoffReference,
    courierDispatchId,
    shippingLabelReference,
    nextSteps: buildNextSteps(payload.donationType)
  } satisfies DonationSubmissionResult;
});

export const createContributionSession = onCall({ region: 'us-central1' }, async (request) => {
  const parsed = createContributionSessionSchema.safeParse(request.data);

  if (!parsed.success) {
    throw new HttpsError('invalid-argument', parsed.error.flatten().formErrors.join(' '));
  }

  const payload = parsed.data as CreateContributionSessionPayload;
  return givebutterService.createCheckoutSession(payload);
});

export const handleGivebutterWebhook = onRequest({ region: 'us-central1' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const eventType = typeof req.body?.type === 'string' ? req.body.type : 'unknown';
  const requestId =
    typeof req.body?.data?.metadata?.requestId === 'string'
      ? req.body.data.metadata.requestId
      : undefined;

  // TODO: Validate Givebutter webhook signatures before processing production traffic.
  if (requestId && eventType.includes('payment')) {
    await db.collection('donation_requests').doc(requestId).set(
      {
        contribution: {
          status: 'completed'
        },
        updatedAt: Timestamp.now()
      },
      { merge: true }
    );

    const snapshot = await db.collection('donation_requests').doc(requestId).get();
    const data = snapshot.data();
    const completedAmount =
      typeof req.body?.data?.amount === 'number'
        ? req.body.data.amount
        : data?.['contribution']?.amountUsd;

    if (data?.['donor']?.email) {
      const meta = data?.['metadata'] ?? {};
      const docCity =
        (typeof meta['city'] === 'string' ? meta['city'] : undefined) ??
        data?.['pickup']?.pickupAddress?.city ??
        data?.['shipping']?.senderAddress?.city;
      const docState =
        (typeof meta['state'] === 'string' ? meta['state'] : undefined) ??
        data?.['pickup']?.pickupAddress?.state ??
        data?.['shipping']?.senderAddress?.state;
      await hubspotService
        .upsertDonorContact({
          email: data['donor'].email,
          fullName: data['donor'].fullName ?? '',
          phone: data['donor'].phone ?? '',
          donationMethod: data['donationType'],
          donationAmountUsd: completedAmount,
          city: docCity,
          state: docState,
          packageSize:
            typeof meta['packageSize'] === 'string' ? meta['packageSize'] : undefined,
          refreshOnly: true
        })
        .catch((err) => console.warn('HubSpot webhook upsert failed', err));
    }
  }

  res.status(200).json({ ok: true });
});

// ============================================================
// Inventory Management System (IMS) functions
// ============================================================
// Called by the warehouse-facing IMS to look up donation metadata
// using the drop-off reference code that donors receive from this app.

export const lookupDonationByReference = onCall(
  { region: 'us-central1' },
  async (request) => {
    const code =
      typeof request.data?.referenceCode === 'string'
        ? request.data.referenceCode.trim()
        : '';

    if (!code) {
      throw new HttpsError('invalid-argument', 'referenceCode is required');
    }

    const snapshot = await db
      .collection('donation_requests')
      .where('dropoff.referenceCode', '==', code)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return { found: false };
    }

    const doc = snapshot.docs[0];
    const data = doc.data();

    return {
      found: true,
      requestId: doc.id,
      donationType: data['donationType'],
      status: data['status'],
      donor: data['donor'],
      dropoff: data['dropoff'],
      pickup: data['pickup'],
      shipping: data['shipping'],
      createdAt: data['createdAt']?.toDate?.()?.toISOString?.() ?? null,
    };
  }
);

// Creates a minimal donation_request document for walk-in donations
// (donations that arrive at the warehouse without coming through this app).
// Keeps the delivery app as the single source of truth for all donations.
export const createWalkInDonation = onCall(
  { region: 'us-central1' },
  async (request) => {
    const donor = request.data?.donor;
    if (
      !donor ||
      typeof donor.fullName !== 'string' ||
      typeof donor.email !== 'string' ||
      typeof donor.phone !== 'string'
    ) {
      throw new HttpsError(
        'invalid-argument',
        'donor { fullName, email, phone } is required'
      );
    }

    const notes =
      typeof request.data?.notes === 'string' ? request.data.notes : '';
    const createdAt = Timestamp.now();
    const requestRef = db.collection('donation_requests').doc();
    const dropoffReference = generateDropoffReference();

    const donorDoc: Record<string, string> = {
      fullName: donor.fullName,
      email: donor.email,
      phone: donor.phone,
    };
    if (typeof donor.donorAccountId === 'string') {
      donorDoc['donorAccountId'] = donor.donorAccountId;
    }

    const baseDoc = {
      donationType: 'dropoff',
      donor: donorDoc,
      contribution: {
        provider: 'givebutter',
        status: 'skipped',
      },
      dropoff: {
        preferredDate: createdAt.toDate().toISOString().slice(0, 10),
        preferredTimeWindow: 'walk-in',
        dropoffNotes: notes,
        locationName: 'Beauty Forward Warehouse',
        locationAddress: {
          line1: '14 53rd St',
          line2: '#614',
          city: 'Brooklyn',
          state: 'NY',
          postalCode: '11232',
        },
        referenceCode: dropoffReference,
      },
      status: 'dropoff_requested' satisfies DonationStatus,
      createdAt,
      updatedAt: createdAt,
      metadata: {
        source: 'ims-walk-in',
      },
    };

    await db.runTransaction(async (transaction) => {
      transaction.set(requestRef, baseDoc);
      transaction.set(db.collection('dropoff_requests').doc(requestRef.id), {
        donationRequestId: requestRef.id,
        ...baseDoc,
      });
    });

    return {
      requestId: requestRef.id,
      dropoffReference,
      createdAt: createdAt.toDate().toISOString(),
    };
  }
);

// Proxies the Open Food Facts public API for barcode lookup.
// Called when a scanned barcode isn't in the local product_catalog cache.
// Open Food Facts covers beauty/personal care products under "obf" (Open Beauty Facts).
export const lookupProductByBarcode = onCall(
  { region: 'us-central1' },
  async (request) => {
    const barcode =
      typeof request.data?.barcode === 'string'
        ? request.data.barcode.trim()
        : '';

    if (!barcode || barcode.length < 6) {
      throw new HttpsError('invalid-argument', 'barcode is required');
    }

    // Tier 1: Open Beauty Facts (beauty-specific crowdsourced DB)
    // Tier 2: Open Food Facts (food DB, occasionally has beauty items)
    const openFactsEndpoints = [
      `https://world.openbeautyfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`,
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`,
    ];

    for (const url of openFactsEndpoints) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'BeautyForwardIMS/1.0' },
        });
        if (!res.ok) continue;
        const body = (await res.json()) as {
          status?: number;
          product?: Record<string, unknown>;
        };
        if (body.status !== 1 || !body.product) continue;

        const p = body.product;
        const name =
          (p['product_name'] as string) || (p['generic_name'] as string) || '';
        if (!name) continue;

        return {
          found: true,
          barcode,
          name,
          brand: (p['brands'] as string)?.split(',')[0]?.trim() ?? '',
          ingredients: (p['ingredients_text'] as string) ?? '',
          categories: (p['categories'] as string) ?? '',
          imageUrl: (p['image_url'] as string) ?? null,
          source: url.includes('openbeautyfacts')
            ? 'open_beauty_facts'
            : 'open_food_facts',
        };
      } catch (err) {
        console.warn(`Open Facts lookup failed for ${url}`, err);
      }
    }

    // Tier 3: UPCitemdb — broader US retail coverage than OBF/OFF.
    // Trial endpoint is free at ~100 lookups/day, no key. Set
    // UPCITEMDB_API_KEY to use the paid tier with higher limits.
    try {
      const apiKey = process.env['UPCITEMDB_API_KEY'];
      const upcItemDbUrl = apiKey
        ? `https://api.upcitemdb.com/prod/v1/lookup?upc=${encodeURIComponent(barcode)}`
        : `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`;
      const headers: Record<string, string> = {
        'User-Agent': 'BeautyForwardIMS/1.0',
      };
      if (apiKey) headers['user_key'] = apiKey;

      const res = await fetch(upcItemDbUrl, { headers });
      if (res.ok) {
        const body = (await res.json()) as {
          code?: string;
          items?: Array<{
            title?: string;
            brand?: string;
            category?: string;
            images?: string[];
          }>;
        };
        const item = body.items?.[0];
        if (body.code === 'OK' && item?.title) {
          return {
            found: true,
            barcode,
            name: item.title,
            brand: item.brand ?? '',
            ingredients: '',
            categories: item.category ?? '',
            imageUrl: item.images?.[0] ?? null,
            source: 'upcitemdb',
          };
        }
      }
    } catch (err) {
      console.warn('UPCitemdb lookup failed', err);
    }

    // Tier 4: Gemini text fallback — ask the model to identify the product
    // from the UPC/EAN alone. Lower accuracy than the DBs above, so results
    // are flagged low/medium confidence and the UI prompts the volunteer
    // to verify. Only fires for numeric barcodes.
    if (/^\d{8,14}$/.test(barcode)) {
      try {
        const vertex = getVertex();
        const model = vertex.getGenerativeModel({
          model: 'gemini-1.5-flash',
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: extractionSchema,
            temperature: 0.2,
          },
        });
        const prompt =
          `A volunteer at a beauty product donation warehouse scanned UPC/EAN "${barcode}". ` +
          'Identify the product from this barcode using your product knowledge. ' +
          'Product type MUST be one of the enum values (snake_case). ' +
          'Set confidence "high" only if certain, "medium" if probable, ' +
          '"low" if guessing. If you have no knowledge of this barcode, ' +
          'return confidence "low" and leave name/brand empty.';

        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        });
        const text =
          result.response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        if (text) {
          const parsed = JSON.parse(text) as {
            name?: string;
            brand?: string;
            type?: string;
            confidence?: 'high' | 'medium' | 'low';
          };
          if (parsed.name && parsed.brand && parsed.confidence !== 'low') {
            return {
              found: true,
              barcode,
              name: parsed.name,
              brand: parsed.brand,
              type: parsed.type,
              ingredients: '',
              categories: '',
              imageUrl: null,
              confidence: parsed.confidence,
              source: 'gemini_text',
            };
          }
        }
      } catch (err) {
        console.warn('Gemini text lookup failed', err);
      }
    }

    return { found: false, barcode };
  }
);

// ============================================================
// Photo-based product identification (IMS Phase 7b)
// ============================================================
// Sends a product photo to Gemini and returns structured fields
// constrained to our beauty product schema. Used when barcode
// lookup returns nothing useful.

const PRODUCT_TYPE_ENUM = [
  'shampoo', 'conditioner', 'hair_oil', 'hair_mask', 'styling_product',
  'moisturizer', 'cleanser', 'serum', 'sunscreen', 'toner',
  'lipstick', 'lip_gloss', 'foundation', 'concealer', 'eyeshadow',
  'mascara', 'blush', 'bronzer',
  'soap', 'body_wash', 'deodorant', 'toothpaste', 'toothbrush', 'feminine_products',
  'nail_polish', 'nail_polish_remover', 'nail_tools',
  'perfume', 'body_spray', 'body_lotion',
] as const;

const extractionSchema = {
  type: SchemaType.OBJECT,
  properties: {
    name: { type: SchemaType.STRING, description: 'Product name on the package' },
    brand: { type: SchemaType.STRING, description: 'Brand name' },
    type: { type: SchemaType.STRING, enum: PRODUCT_TYPE_ENUM as unknown as string[] },
    color: { type: SchemaType.STRING, description: 'Specific color/shade if visible' },
    colorCategory: { type: SchemaType.STRING, description: 'Broad category like warm nude, rose, cool pink' },
    keyIngredients: { type: SchemaType.STRING, description: 'Comma-separated key ingredients if visible' },
    size: { type: SchemaType.STRING, description: 'Package size, e.g. 8oz or 250ml' },
    confidence: { type: SchemaType.STRING, enum: ['high', 'medium', 'low'] },
  },
  required: ['name', 'brand', 'type', 'confidence'],
};

let _vertex: VertexAI | null = null;
function getVertex(): VertexAI {
  if (!_vertex) {
    _vertex = new VertexAI({
      project: process.env['GCLOUD_PROJECT'] || 'beauty-forward',
      location: 'us-central1',
    });
  }
  return _vertex;
}

export const extractProductFromImage = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 60 },
  async (request) => {
    const imageBase64 =
      typeof request.data?.imageBase64 === 'string'
        ? request.data.imageBase64
        : '';
    const mimeType =
      typeof request.data?.mimeType === 'string'
        ? request.data.mimeType
        : 'image/jpeg';

    if (!imageBase64 || imageBase64.length < 100) {
      throw new HttpsError('invalid-argument', 'imageBase64 is required');
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
      throw new HttpsError('invalid-argument', 'unsupported mimeType');
    }

    const vertex = getVertex();
    const model = vertex.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: extractionSchema,
        temperature: 0.2,
      },
    });

    const prompt =
      'You are helping a beauty product donation warehouse catalog products. ' +
      'Examine this product photo and extract the visible fields. ' +
      'Product type MUST be one of the enum values (use snake_case exactly). ' +
      'If a field is not visible or you are uncertain, omit it. ' +
      'Set confidence to "high" if the product is clearly identified, ' +
      '"medium" if partial, "low" if unsure.';

    try {
      const result = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { mimeType, data: imageBase64 } },
            ],
          },
        ],
      });

      const text =
        result.response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      if (!text) {
        return { found: false, reason: 'empty response' };
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { found: false, reason: 'invalid JSON', raw: text };
      }

      return {
        found: true,
        source: 'gemini_vision',
        ...parsed,
      };
    } catch (err) {
      console.error('Gemini image extraction failed', err);
      throw new HttpsError(
        'internal',
        'Image extraction failed. Check Vertex AI API is enabled.',
      );
    }
  }
);

function buildNextSteps(type: CreateDonationRequestPayload['donationType']): string[] {
  if (type === 'pickup') {
    return [
      'We will confirm your courier assignment by email and text shortly.',
      'Please keep your donation packed and accessible during your selected window.'
    ];
  }

  if (type === 'shipping') {
    return [
      'We will send shipping label instructions to your email address.',
      'After shipping, save your receipt so we can trace delivery if needed.'
    ];
  }

  return [
    'Bring your donation during the selected window.',
    'Share your drop-off reference at check-in for fast verification.'
  ];
}
