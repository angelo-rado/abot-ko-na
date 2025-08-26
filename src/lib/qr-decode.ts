// src/lib/qr-decode.ts
'use client'

type BarcodeDetectorCtor = new (opts: { formats?: string[] }) => {
  detect(source: any): Promise<Array<{ rawValue?: string }>>
}

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorCtor
  }
}

export async function decodeQrFromFile(file: File): Promise<string | null> {
  // First try the native BarcodeDetector (Chrome/Edge/Android)
  try {
    if (typeof window !== 'undefined' && typeof window.BarcodeDetector !== 'undefined') {
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
      const bitmap = await createImageBitmap(file)
      const results = await detector.detect(bitmap as any)
      if (Array.isArray(results) && results[0]?.rawValue) {
        return String(results[0].rawValue)
      }
    }
  } catch {}

  // Fallback to zxing (needs dependency @zxing/browser)
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - types provided via src/types/zxing-browser.d.ts
    const { BrowserQRCodeReader } = await import('@zxing/browser')
    const reader = new BrowserQRCodeReader()
    const url = URL.createObjectURL(file)
    try {
      const res = await reader.decodeFromImageUrl(url)
      URL.revokeObjectURL(url)
      // Support either getText() or .text
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      return res?.getText ? res.getText() : (res?.text ?? null)
    } catch {
      URL.revokeObjectURL(url)
      return null
    }
  } catch {
    return null
  }
}
