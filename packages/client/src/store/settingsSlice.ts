/**
 * 設定 slice（sr2 settingsSlice 樣板）：本機限定，localStorage 手動持久化。
 * type-only 反向引用 AppStore（編譯期抹除，不成值循環）。
 */
import type { StateCreator } from 'zustand';
import type { AppStore } from './appStore';
import { loadSettings, saveSettings, type Settings } from '../settings';

export interface SettingsSlice {
  settings: Settings;
  /**
   * 瀏覽器有沒有承諾不回收這個 origin 的儲存空間。null=還沒問到。
   * **不是設定**（使用者改不了），是環境事實——但它決定備份提醒要多積極：
   * WebKit 在分頁模式下不給持久性，且「7 天沒開站就把 IDB 連同 SW 一起清掉」。
   */
  persisted: boolean | null;
  updateSettings(patch: Partial<Settings>): void;
  setPersisted(v: boolean): void;
}

export const createSettingsSlice: StateCreator<AppStore, [], [], SettingsSlice> = (set, get) => ({
  settings: loadSettings(),
  persisted: null,
  updateSettings(patch) {
    const settings = { ...get().settings, ...patch };
    saveSettings(settings); // 先落盤再 set（寫失敗會走 saveFailed 通知，記憶體照樣前進）
    set({ settings });
  },
  setPersisted(v) {
    set({ persisted: v });
  },
});
