import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { token, userId } = await req.json()

    if (!token || !userId) {
      return NextResponse.json({ error: 'Missing token or userId' }, { status: 400 })
    }

    // TODO: Save the token to your database, e.g. Firestore or SQL
    // await db.saveFcmToken(userId, token)

    console.log(`Saving token for user ${userId}: ${token}`)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error saving token:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
