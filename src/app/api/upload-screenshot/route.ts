import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * Client-upload token handler for delivery screenshots (Vercel Blob).
 *
 * Requires a valid Firebase ID token (sent by the client as `clientPayload`)
 * before issuing an upload token — so only signed-in users can upload, not
 * anonymous callers. Requires a Blob store connected to the project
 * (BLOB_READ_WRITE_TOKEN) and Firebase admin creds in env.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const admin = await import('firebase-admin')
        if (!admin.apps.length) {
          admin.initializeApp({
            credential: admin.credential.cert({
              projectId: process.env.FIREBASE_PROJECT_ID,
              clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
              privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
            }),
          })
        }

        if (!clientPayload) throw new Error('Unauthorized: missing auth token')
        let uid: string
        try {
          const decoded = await admin.auth().verifyIdToken(clientPayload)
          uid = decoded.uid
        } catch {
          throw new Error('Unauthorized: invalid auth token')
        }

        return {
          allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
          maximumSizeInBytes: 10 * 1024 * 1024, // 10 MB
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ uid }),
        }
      },
      onUploadCompleted: async () => {},
    })

    return NextResponse.json(jsonResponse)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 400 }
    )
  }
}
