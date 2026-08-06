/**
 * 設定 slice（sr2 settingsSlice 樣板）：本機限定，localStorage 手動持久化。
 * type-only 反向引用 AppStore（編譯期抹除，不成值循環）。
 */
import type { StateCreator } from 'zustand';
import type { AppStore } from './appStore';
import { loadSettings, saveSettings, type Settings } from '../settings';

export interface SettingsSlice {
  settings: Settings;
  updateSettings(patch: Partial<Settings>): void;
}

export const createSettingsSlice: StateCreator<AppStore, [], [], SettingsSlice> = (set, get) => ({
  settings: loadSettings(),
  updateSettings(patch) {
    const settings = { ...get().settings, ...patch };
    saveSettings(settings); // 先落盤再 set（寫失敗會走 saveFailed 通知，記憶體照樣前進）
    set({ settings });
  },
});
