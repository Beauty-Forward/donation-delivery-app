import { Injectable } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  Firestore,
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
} from 'firebase/firestore';
import { Functions, connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class FirebaseClientService {
  readonly app: FirebaseApp;
  readonly firestore: Firestore;
  readonly functions: Functions;

  constructor() {
    this.app = getApps().length ? getApp() : initializeApp(environment.firebase);
    // In emulator mode, force long-polling instead of gRPC/WebChannel streams.
    // Workaround for a firebase-js-sdk regression that crashes onSnapshot listeners
    // with "INTERNAL ASSERTION FAILED ... ve:-1" when talking to the Firestore
    // emulator. See firebase/firebase-js-sdk#8593 and related. initializeFirestore
    // must be called before any other Firestore call, hence before getFirestore.
    this.firestore = environment.firebase.useEmulators
      ? initializeFirestore(this.app, { experimentalForceLongPolling: true })
      : getFirestore(this.app);
    this.functions = getFunctions(this.app, environment.firebase.functionsRegion);

    if (environment.firebase.useEmulators) {
      this.connectToEmulators();
    }
  }

  private connectToEmulators(): void {
    try {
      connectFirestoreEmulator(this.firestore, '127.0.0.1', 8080);
      connectFunctionsEmulator(this.functions, '127.0.0.1', 5001);
    } catch {
      // Emulator connections are no-op if already connected.
    }
  }
}
