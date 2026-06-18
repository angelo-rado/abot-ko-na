# Abot Ko Na

> _"Abot ko na"_ (Filipino) — roughly *"I've got it / I've arrived."*

A realtime **family presence & delivery-tracking** Progressive Web App. Families
share a single space where members can see **who's home** and keep track of
**incoming deliveries**, with push notifications when a package is on its way or
when someone arrives/leaves home.

## Features

- **Who's Home** — realtime presence per family member. Set manually
  (_I'm Home / I'm Out_) or automatically via geolocation against a saved family
  home location (geofence-based auto-presence).
- **Deliveries** — log packages with expected dates, recipients and line items;
  mark them `pending → in_transit → delivered`; per-delivery notes thread.
- **Notifications** — Firebase Cloud Messaging push + an in-app notifications
  feed, driven by Cloud Functions (in-transit alerts, daily 8AM summary,
  presence changes). Includes a Safari/iOS fallback queue.
- **Families** — create or join via invite link / QR code, with owner/admin
  roles and member management.
- **Offline-first PWA** — installable, service worker caching, and a Dexie
  (IndexedDB) mirror for offline reads.

## Tech stack

| Layer        | Technology |
|--------------|------------|
| Framework    | Next.js 15 (App Router, parallel routes), React 19, TypeScript |
| Styling      | Tailwind CSS v4, shadcn/ui, framer-motion |
| Backend      | Firebase — Auth (Google), Firestore, Cloud Messaging, Cloud Functions v2 |
| Maps         | Leaflet + leaflet-geosearch (home-location picker) |
| Offline      | next-pwa (Workbox) service worker, Dexie / IndexedDB |
| Hosting      | Vercel (web) + Firebase (functions, rules, indexes) |
| Functions TZ | `asia-southeast1`, schedules in `Asia/Manila` |

## Project structure

```
src/
  app/
    (main)/            App Router routes — parallel slots (@home, @deliveries,
                       @family, @settings, @notifications) + swipe/standalone shells
    components/        Feature components (delivery cards, modals, presence, maps)
    api/save-fcm-token/  Route handler for persisting FCM tokens
    login/ onboarding/   Auth & onboarding flows
  components/ui/       shadcn/ui primitives
  lib/                 Firebase init, hooks, presence/delivery/family logic, Dexie db
functions/src/         Cloud Functions (notifications, schedulers, triggers)
firestore.rules        Firestore security rules
firebase.indexes.json  Composite index definitions
```

## Getting started

### Prerequisites
- Node.js 20+ (Cloud Functions target Node 22)
- A Firebase project with Auth (Google), Firestore and Cloud Messaging enabled
- Firebase CLI (`npm i -g firebase-tools`) for deploying functions/rules

### 1. Install
```bash
npm install
```

### 2. Configure environment
Create `.env.local` from the example and fill in your Firebase web config:
```bash
cp .env.example .env.local
```
```
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=
NEXT_PUBLIC_VAPID_KEY=          # Web Push certificate key pair (FCM)
```
> `NEXT_PUBLIC_VAPID_KEY` comes from Firebase Console → Project Settings →
> Cloud Messaging → Web Push certificates.

The same variables must be configured in your hosting environment (Vercel)
before deploying — see `vercel.json` for the expected secret names.

### 3. Run
```bash
npm run dev          # start dev server (Turbopack) at http://localhost:3000
```

## Scripts

| Command            | Description |
|--------------------|-------------|
| `npm run dev`      | Dev server (Turbopack) |
| `npm run build`    | Production build |
| `npm run start`    | Serve the production build |
| `npm run lint`     | ESLint (next lint) |
| `npm run typecheck`| `tsc --noEmit` |

## Deployment

**Web (Vercel):** push to the deploy branch; ensure the `NEXT_PUBLIC_*` env vars
above are set in the Vercel project. `vercel.json` maps them to Vercel secrets
and configures PWA/service-worker headers.

**Firebase (functions, rules, indexes):**
```bash
firebase deploy --only functions      # Cloud Functions (builds via predeploy)
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

## Data model (Firestore)

```
users/{uid}                         profile, fcmTokens[], autoPresence, isSafari
families/{familyId}                 name, createdBy, members[], homeLocation
  members/{uid}                     name, photoURL, status, statusSource, updatedAt
  deliveries/{deliveryId}           title, recipient, status, expectedDate, createdBy
    items/{itemId}                  line items
  events/{eventId}                  in-app notification feed (targets[], type, createdAt)
system/...                          idempotency markers for notifications
```

## License

Private project.
