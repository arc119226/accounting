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
        // 地區化＝非決定論：同一份帳本在兩台裝置上必須排出位元一致的順序
        { name: 'Intl', message: 'core 必須決定論：地區化住顯示層（client/strings）' },
        { name: 'performance', message: 'core 必須決定論：時間以參數餵入' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'core 必須決定論：隨機由呼叫端餵入' },
        { object: 'Date', property: 'now', message: 'core 必須決定論：牆鐘以 wallMs 參數餵入' },
      ],
      // no-restricted-globals 只比對裸識別字、no-restricted-properties 要指定 object，
      // 兩者都看不見 `new Date()` 與任意字串上的 .localeCompare()——而這兩個正是
      // 最自然的破口：前者是最順手的牆鐘取用方式，後者曾經真的漏進 categories.ts
      // （hlc.ts 的檔頭早就寫明禁用，但沒有機器守著就是會發生）。
      'no-restricted-syntax': [
        'error',
        {
          selector: 'NewExpression[callee.name="Date"]',
          message: 'core 必須決定論：牆鐘以 wallMs 參數餵入，不可 new Date()',
        },
        {
          selector: 'MemberExpression[property.name=/^(localeCompare|toLocaleString|toLocaleDateString|toLocaleTimeString)$/]',
          message: 'core 必須決定論：locale/ICU 資料會漂移，字串比較請逐碼位（見 categories.ts cmpStr）',
        },
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
