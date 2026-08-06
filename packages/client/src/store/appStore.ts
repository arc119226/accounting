/**
 * App 單一 store（sr2 gameStore 模式：單 store + slices，手動持久化）。
 * slice 以 `import type { AppStore }` 反向引用（type-only=編譯期抹除，不成值循環）。
 * 選取一律窄 selector（`useAppStore((s) => s.xxx)`），不取整個 store。
 */
import { create } from 'zustand';
import { createLedgerSlice, type LedgerSlice } from './ledgerSlice';
import { createSettingsSlice, type SettingsSlice } from './settingsSlice';
import { createSyncSlice, type SyncSlice } from './syncSlice';

export type Screen = 'ledger' | 'scan' | 'stats' | 'sync' | 'settings' | 'categories';

export interface ShellSlice {
  screen: Screen;
  setScreen(screen: Screen): void;
}

export type AppStore = ShellSlice & LedgerSlice & SettingsSlice & SyncSlice;

export const useAppStore = create<AppStore>()((set, get, store) => ({
  screen: 'ledger',
  setScreen: (screen) => set({ screen }),
  ...createLedgerSlice(set, get, store),
  ...createSettingsSlice(set, get, store),
  ...createSyncSlice(set, get, store),
}));
