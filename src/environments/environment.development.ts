export const environment = {
  production: false,
  firebase: {
    apiKey: 'AIzaSyAF5yAlhxZuPMM0JxxMHXRcAge-06Kyk1o',
    authDomain: 'beauty-forward.firebaseapp.com',
    projectId: 'beauty-forward',
    storageBucket: 'beauty-forward.firebasestorage.app',
    messagingSenderId: '293598087208',
    appId: '1:293598087208:web:2119b006c72a18f9720d1d',
    measurementId: 'G-4YWCNPS3GS',
    functionsRegion: 'us-central1',
    useEmulators: true,
  },
  warehouse: {
    name: 'Beauty Forward Warehouse',
    line1: '14 53rd St',
    line2: '#614',
    city: 'Brooklyn',
    state: 'NY',
    postalCode: '11232',
    hours: 'Mon-Fri, 9 AM - 5 PM',
    deliveryNotes: 'TODO: ADD DELIVERY NOTES',
  },
  integrations: {
    givebutter: {
      publicCampaignUrl: 'https://givebutter.com/beauty-forward',
    },
    shippingLabel: {
      provider: 'mock',
      mockCheckoutUrl: 'https://shippo.com',
    },
  },
  email: 'info@beauty-forward.org',
  // Lowered from $15 in dev so the pickup-donation gate is testable without paying full price.
  pickupDonationMinimumUsd: 1,
};
