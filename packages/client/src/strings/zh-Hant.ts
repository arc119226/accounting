/**
 * 顯示文字正典（繁體中文）——**零 import 純資料葉檔**（ESLint 機器強制）。
 * 所有 UI 顯示字一律住這裡；元件經 `strings/ui.ts` 取用，不得散落字面量。
 */

export const APP = {
  name: '柴米帳',
  tagline: '兩個人的宣紙記帳本',
} as const;

export const NAV = {
  ledger: '帳本',
  entry: '記一筆',
  scan: '掃發票',
  stats: '統計',
  sync: '同步',
  settings: '設定',
  categories: '分類',
} as const;

export const CONFIRM = {
  cancel: '取消',
  ok: '確定',
} as const;

export const NOTICE = {
  updateReady: '新版本已就緒',
  updateBtn: '重新整理',
  saveFailed: '設定保存失敗——變更僅在本次有效',
} as const;

export const CRASH = {
  title: '出了點狀況',
  body: '畫面遇到錯誤。可先回帳本頁，或重新整理再試。',
  menu: '回帳本',
  reload: '重新整理',
} as const;

export const PLACEHOLDER = {
  wip: '此頁尚在鋪紙研墨…',
} as const;
