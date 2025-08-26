// src/types/zxing-browser.d.ts
declare module '@zxing/browser' {
  export class BrowserQRCodeReader {
    decodeFromImageUrl(url: string): Promise<{ getText?: () => string; text?: string }>;
  }
}
