import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { NextResponse } from 'next/server'

/**
 * Client-upload token handler for delivery screenshots (Vercel Blob).
 *
 * The browser uploads the file directly to Blob storage using a short-lived
 * token issued here, which avoids the serverless request body size limit and
 * keeps large screenshots off the API route. Requires a Blob store connected
 * to the project (provides the BLOB_READ_WRITE_TOKEN env var).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
        maximumSizeInBytes: 10 * 1024 * 1024, // 10 MB
        addRandomSuffix: true,
      }),
      // No-op: the client writes the resulting URL onto the delivery doc.
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
