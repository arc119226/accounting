import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
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
  ],
  server: { port: 5173 },
});
