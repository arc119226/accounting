/**
 * App 單一 store（sr2 gameStore 模式：單 store + slices，手動持久化）。
 * M0 只有殼層狀態（screen 切換）；M1 起以 slice 擴充（ledger/stats/sync/settings），
 * slice 以 `import type { AppStore }` 反向引用（type-only=編譯期抹除，不成值循環）。
 */
import { create } from 'zustand';

export type Screen = 'ledger' | 'scan' | 'stats' | 'sync' | 'settings' | 'categories';

export interface AppStore {
  screen: Screen;
  setScreen(screen: Screen): void;
}

export const useAppStore = create<AppStore>((set) => ({
  screen: 'ledger',
  setScreen: (screen) => set({ screen }),
}));
