/**
 * QR 顯示（qrcode-generator 動態載入——只有主持同步時需要）。
 * 產出 data URL img：比 table DOM 輕、可被長按存圖。
 */
import { useEffect, useState } from 'react';

export function QrCode({ text, size = 220 }: { text: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    void import('qrcode-generator').then((m) => {
      if (dead) return;
      const qr = m.default(0, 'M');
      qr.addData(text);
      qr.make();
      // cellSize 4 足夠螢幕互掃；margin 4 模組=規範 quiet zone
      setSrc(qr.createDataURL(4, 4));
    });
    return () => {
      dead = true;
    };
  }, [text]);
  if (!src) return <div className="qr-box qr-loading"><span className="spinner" /></div>;
  return <img className="qr-box" src={src} width={size} height={size} alt={text} />;
}
