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
import { noteChunkLoadFailure } from '../version';

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
  let mod: typeof import('barcode-detector/ponyfill');
  try {
    mod = await import('barcode-detector/ponyfill');
  } catch (err) {
    // 動態 import 失敗，十之八九＝新版部署清掉了舊 chunk。
    // **這條在同一個分頁裡救不回來**：HTML 規範的 module map 會把「抓失敗」記在那個
    // URL 上，之後同一個 specifier 的 import() 直接回同一個失敗、不會重抓。
    // （實測：把 dev server 停掉讓它失敗、再開回來，那支 chunk 用 fetch 拿得到 200，
    // 但 import() 仍然失敗；換一個 query string 才成功——證明是 module map 在快取。）
    // 所以清掉 detectorPromise 只夠救「非 import 的失敗」，chunk 失效的唯一出路是
    // 重新整理。走與 syncSlice.begin 同一條路：提示使用者有新版本。
    noteChunkLoadFailure();
    throw err;
  }
  const { BarcodeDetector, prepareZXingModule } = mod;
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
    },
  });
  return new BarcodeDetector({ formats: ['qr_code'] });
}

export function getDetector(): Promise<QrDetector> {
  // 失敗要能重試：`??=` 對已存在的 rejected promise 不會重來，一次失敗就讓掃描到
  // **關掉 app 重開**前都是死的——連退路的【拍照辨識】也走這條。清掉快取再 rethrow。
  // 救得到的是「非 import 的失敗」（prepareZXingModule / BarcodeDetector 建構丟錯、
  // 原生偵測器路徑出事）；chunk 抓不到的那條由 create() 內的 noteChunkLoadFailure
  // 負責，理由見那裡。
  detectorPromise ??= create().catch((err: unknown) => {
    detectorPromise = null;
    throw err;
  });
  return detectorPromise;
}
