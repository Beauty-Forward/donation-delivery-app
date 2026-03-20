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
    useEmulators: false,
  },
  warehouse: {
    name: 'Beauty Forward Warehouse',
    line1: '555 ForGood Way',
    line2: 'Suite 100',
    city: 'New York',
    state: 'NY',
    postalCode: '11238',
    deliveryNotes: 'Use receiving dock B for donations and ring the donation bell on arrival.',
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
};
