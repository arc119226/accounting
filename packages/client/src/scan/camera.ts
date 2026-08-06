/**
 * 相機取流生命週期。掛載取流、卸載必釋放（iOS 忘記 stop 會佔住鏡頭指示燈）。
 * getUserMedia 被拒（iOS standalone PWA 權限不持久是常態）由呼叫端接手
 * 切到拍照辨識——那是一級路徑不是錯誤路徑。
 */

export async function acquireCamera(video: HTMLVideoElement): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: 'environment',
      // 1080p 上限：發票左碼是 QR V6+ 高密度、EC level 只有 L(7%)，解析度太低解不開
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: false,
  });
  video.srcObject = stream;
  // iOS：沒有 playsinline 會被劫持成全螢幕原生播放器
  video.setAttribute('playsinline', '');
  await video.play();
  return () => {
    for (const t of stream.getTracks()) t.stop();
    video.srcObject = null;
  };
}
