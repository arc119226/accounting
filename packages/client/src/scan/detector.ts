/**
 * QR 偵測器（lazy 單例）。
 *
 * 原生 BarcodeDetector 優先（Android Chrome：免載 1MB wasm）；
 * iOS/Firefox 走 barcode-detector ponyfill（zxing-wasm）。wasm 以 Vite ?url
 * 自架（hash 進 /assets → immutable 快取 + M5 SW precache = 離線可掃），
 * 不用套件預設的 jsDelivr 遠端載入。
 * 兩條路徑都回「一幀多碼」的 DetectedBarcode[]——台灣發票左右雙碼常同框。
 */
import type { DetectedBarcode } from 'barcode-detector/ponyfill';
// 靜態 ?url import：Rollup 對「動態 import + ?url 後綴」的組合解析不了（build 期炸），
// 靜態引只是拿 hashed 資產 URL 字串（幾十 bytes），且本檔已住在 ScanScreen lazy chunk 內
// ——wasm 本體仍是首掃才 fetch。
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

export type { DetectedBarcode };

interface QrDetector {
  detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>;
}

/** 原生 BarcodeDetector 的最小型別（DOM lib 尚未收錄） */
interface NativeBarcodeDetectorCtor {
  new (options?: { formats?: string[] }): QrDetector;
  getSupportedFormats?(): Promise<string[]>;
}

let detectorPromise: Promise<QrDetector> | null = null;

async function create(): Promise<QrDetector> {
  const native = (globalThis as { BarcodeDetector?: NativeBarcodeDetectorCtor }).BarcodeDetector;
  if (native) {
    try {
      const formats = (await native.getSupportedFormats?.()) ?? [];
      if (formats.includes('qr_code')) return new native({ formats: ['qr_code'] });
    } catch {
      // 原生偵測器壞掉（少見）→ 靜默退 ponyfill
    }
  }
  const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill');
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
    },
  });
  return new BarcodeDetector({ formats: ['qr_code'] });
}

export function getDetector(): Promise<QrDetector> {
  // 失敗要能重試：`??=` 對已存在的 rejected promise 不會重來，一次 wasm/chunk
  // fetch 失敗（電梯裡沒訊號、部署間隙的 404）就會讓掃描到**關掉 app 重開**前
  // 都是死的——連退路的【拍照辨識】也走這條。清掉快取再 rethrow，下次再試。
  detectorPromise ??= create().catch((err: unknown) => {
    detectorPromise = null;
    throw err;
  });
  return detectorPromise;
}
