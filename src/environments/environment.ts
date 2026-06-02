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
    line1: '14 53rd St',
    line2: '#614',
    city: 'Brooklyn',
    state: 'NY',
    postalCode: '11232',
    hours: 'Mon-Fri, 9 AM - 5 PM',
    deliveryNotes: '',
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
  pickupDonationMinimumUsd: 15,
};

// // Initialize Firebase
// const app = initializeApp(environment);
// const analytics = getAnalytics(app);
