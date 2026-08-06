import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/.wrangler/**'] },
  ...tseslint.configs.recommended,
  {
    // core 純度鐵律：零依賴、零 I/O、無非決定性來源（HLC 的牆鐘一律由呼叫端參數餵入）
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'core 不可碰 DOM' },
        { name: 'document', message: 'core 不可碰 DOM' },
        { name: 'fetch', message: 'core 不可做 I/O' },
        { name: 'localStorage', message: 'core 不可做 I/O' },
        { name: 'indexedDB', message: 'core 不可做 I/O（IDB 住 client/db/）' },
        { name: 'crypto', message: 'ID 產生住 client/ids.ts，core 收現成的 id 參數' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'core 必須決定論：隨機由呼叫端餵入' },
        { object: 'Date', property: 'now', message: 'core 必須決定論：牆鐘以 wallMs 參數餵入' },
      ],
      'no-restricted-imports': [
        'error',
        { patterns: [{ regex: '^[^.]', message: 'core 不可 import 外部套件（相對路徑除外）' }] },
      ],
    },
  },
  {
    // 顯示文字正典的零 import 鐵律：strings 是純資料葉，任何 import 都會招來求值順序問題
    files: ['packages/client/src/strings/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { regex: '^[^.]', message: 'strings/ 不可 import 外部套件（文字層必須是葉節點）' },
            { regex: '^\\.\\.', message: 'strings/ 不可往外 import：文字層不得依賴 store/ui，否則會生成循環' },
          ],
        },
      ],
    },
  },
);
