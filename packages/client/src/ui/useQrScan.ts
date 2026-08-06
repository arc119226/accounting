/**
 * 無頭 QR 掃描 hook：相機取流 + 每 250ms 偵測一幀，掃到什麼交給呼叫端判斷。
 *
 * **刻意不把 ScanScreen 改接這支 hook**：那頁的迴圈裡綁著發票左右碼的 1.5 秒配對窗，
 * 而它是全 app 最常用的功能。把它重構到共用 hook 上對使用者零收益、風險非零。
 * 這裡的重複是知情的決定；哪天真要 DRY，該是獨立一次、獨立驗證的變更。
 *
 * detector 用**動態 import**：SyncScreen 是靜態掛在 App 上的，靜態引入會把
 * ~1MB 的 wasm 引用吊進主 bundle。Android 走原生 BarcodeDetector＝零額外位元組；
 * iOS 走 ponyfill + wasm，而 SW 本來就 precache 了它（安裝後是讀磁碟不是下載）。
 */
import { useEffect, useRef, type RefObject } from 'react';
import { acquireCamera } from '../scan/camera';
import { logError } from '../errlog';

export type QrPhase = 'engine' | 'starting' | 'camera' | 'denied';

export function useQrScan(opts: {
  /** false 時完全不取流（相機指示燈不該為了沒開的畫面亮著） */
  readonly enabled: boolean;
  readonly videoRef: RefObject<HTMLVideoElement | null>;
  readonly onCodes: (texts: readonly string[]) => void;
  readonly onPhase: (p: QrPhase) => void;
}): void {
  const { enabled, videoRef } = opts;
  // 回呼鏡射進 ref：每次 render 都是新 closure，放進 effect deps 會讓相機不停重取流；
  // 不放又會讓 250ms 迴圈永遠拿著第一次 render 的舊 closure。ref 兩者都解。
  const cbRef = useRef(opts);
  cbRef.current = opts;

  useEffect(() => {
    if (!enabled) return;
    const onCodes = (texts: readonly string[]): void => cbRef.current.onCodes(texts);
    const onPhase = (p: QrPhase): void => cbRef.current.onPhase(p);
    let release: (() => void) | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let dead = false;
    void (async () => {
      try {
        onPhase('engine');
        const { getDetector } = await import('../scan/detector');
        const detector = await getDetector();
        if (dead || !videoRef.current) return;
        onPhase('starting');
        release = await acquireCamera(videoRef.current);
        if (dead) {
          release();
          return;
        }
        onPhase('camera');
        let busy = false;
        timer = setInterval(() => {
          const video = videoRef.current;
          if (busy || !video || video.readyState < 2) return;
          busy = true;
          void detector
            .detect(video)
            .then((codes) => onCodes(codes.map((c) => c.rawValue)))
            .catch(() => {/* 單幀偵測失敗=略過此幀 */})
            .finally(() => {
              busy = false;
            });
        }, 250);
      } catch (err) {
        // 相機被拒在 iOS standalone 是常態路徑（見 scan/camera.ts），不是錯誤畫面
        logError(`qr camera: ${String(err)}`);
        if (!dead) onPhase('denied');
      }
    })();
    return () => {
      dead = true;
      if (timer !== null) clearInterval(timer);
      release?.();
    };
  }, [enabled, videoRef]);
}
