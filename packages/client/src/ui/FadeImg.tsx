import { useState, type ImgHTMLAttributes } from 'react';

/**
 * 載完才淡入的 `<img>`（移植自 sr2）。只做一件事：`opacity 0 → 1`（CSS 在 `.fade-img`），
 * 不碰版面。**刻意不接管 onError**——各處的缺圖回退語意不同（隱藏整格/降級繪製/alt 文案），
 * 要處理錯誤的呼叫端自己傳 `onError` 進來（這裡照樣轉發）。
 */
export function FadeImg({ className, onLoad, ...rest }: ImgHTMLAttributes<HTMLImageElement>) {
  const [ok, setOk] = useState(false);
  return (
    <img
      {...rest}
      className={`fade-img${ok ? ' loaded' : ''}${className ? ` ${className}` : ''}`}
      decoding="async"
      onLoad={(e) => {
        setOk(true);
        onLoad?.(e);
      }}
    />
  );
}
