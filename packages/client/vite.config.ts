import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json';

// 版本識別（移植自 sr2）：package.json 版本 + build 時間戳（分鐘精度）。
// dev 模式 define 同樣生效=設定頁照樣顯示；version.json 只在 build 產出
// （dev 下 checkForUpdate 有 DEV 早退，見 src/version.ts）。
const buildId = `${pkg.version}+${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(buildId) },
  plugins: [
    react(),
    {
      // 更新偵測的真相源：dist/version.json（_headers 對它 no-store=永遠拿到最新）
      name: 'zb-version-json',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: buildId }) });
      },
    },
    // PWA：generateSW + autoUpdate——此 app 核心價值是**離線記帳**，
    // 殼+JS+字體+zxing wasm 全 precache（有別於 sr2「殼頁級 SW 永不快取 bundle」的取捨：
    // sr2 是線上遊戲，reload=新版比離線重要）。staleness 由 autoUpdate（skipWaiting+
    // clientsClaim）夾在一個啟動內，再疊 version.json 輪詢的使用者可見 toast。
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false, // 用 public/ 的手寫 manifest.webmanifest（zh-Hant 欄位齊全）
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2,wasm,png,webmanifest}'],
        // version.json 刻意不在 patterns（.json 未列）：它必須永遠走網路
        maximumFileSizeToCacheInBytes: 3_000_000, // zxing wasm ~1.07MB 要放行
        navigateFallback: 'index.html',
      },
    }),
  ],
  server: { port: 5173 },
});
