// import { initializeApp } from 'firebase/app';
// import { getAnalytics } from 'firebase/analytics';

export const environment = {
  production: true,
  firebase: {
    apiKey: 'AIzaSyAF5yAlhxZuPMM0JxxMHXRcAge-06Kyk1o',
    authDomain: 'beauty-forward.firebaseapp.com',
    projectId: 'beauty-forward',
    storageBucket: 'beauty-forward.firebasestorage.app',
    messagingSenderId: '293598087208',
    appId: '1:293598087208:web:9239b95af7e5e3f5720d1d',
    measurementId: 'G-94QQH12XPC',
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

// // Initialize Firebase
// const app = initializeApp(environment);
// const analytics = getAnalytics(app);
