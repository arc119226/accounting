/**
 * 通用拖拽手勢辨識（純 DOM，零依賴；移植自 sr2 gesture.ts）——滑鼠+觸控通吃（Pointer Events）。
 * 位移越過 threshold 才算拖拽；回報相對起點的累計位移；放開/取消時回報是否曾拖拽。
 * 用途：主帳頁左右滑切月、分類管理拖曳排序。
 */
export interface DragHandlers {
  /** 位移越過 threshold、判定為拖拽的第一刻（單次） */
  onStart?: () => void;
  /** 拖拽中每次移動：dx/dy = 相對起點的累計位移（px，右/下為正） */
  onMove?: (dx: number, dy: number) => void;
  /** 指標放開/取消：dx/dy = 最終累計位移，dragged = 是否曾越過 threshold */
  onEnd?: (dx: number, dy: number, dragged: boolean) => void;
}

/** 掛拖拽辨識到元素，回傳解除函式（dispose 時呼叫）。單指：拖拽中忽略後續指標。 */
export function attachDrag(el: HTMLElement, handlers: DragHandlers, threshold = 10): () => void {
  let pid: number | null = null;
  let sx = 0;
  let sy = 0;
  let dragging = false;

  const onDown = (e: PointerEvent): void => {
    if (pid !== null) return; // 已有一指在追蹤=忽略後續（單指手勢）
    pid = e.pointerId;
    sx = e.clientX;
    sy = e.clientY;
    dragging = false;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* 某些環境不支援=忽略，退回一般冒泡 */
    }
  };

  const onMove = (e: PointerEvent): void => {
    if (e.pointerId !== pid) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (!dragging) {
      if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
      dragging = true;
      handlers.onStart?.();
    }
    handlers.onMove?.(dx, dy);
  };

  const finish = (e: PointerEvent): void => {
    if (e.pointerId !== pid) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    const was = dragging;
    pid = null;
    dragging = false;
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    handlers.onEnd?.(dx, dy, was);
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', finish);
  el.addEventListener('pointercancel', finish);
  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', finish);
    el.removeEventListener('pointercancel', finish);
  };
}
