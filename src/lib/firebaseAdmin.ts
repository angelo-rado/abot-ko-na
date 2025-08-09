// src/lib/firebaseAdmin.ts
import * as admin from 'firebase-admin'

if (!admin.apps.length) {
  admin.initializeApp({
    // Optionally specify credentials or leave default for env variables
    // credential: admin.credential.applicationDefault(),
  })
}

export const firestore = admin.firestore()
export const FieldValue = admin.firestore.FieldValue
