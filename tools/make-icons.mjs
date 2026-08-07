/**
 * PWA icons 產生器：favicon.svg → icon-192 / icon-512（any）
 * / icon-maskable-512（安全區 80%）/ apple-touch-icon。
 * 用法：node tools/make-icons.mjs（sharp 在 root devDeps）
 *
 * **any 與 maskable 是兩張不同的圖**（審查修正）。舊版只產一張帶 80% 內縮的圖，
 * 兩個 purpose 都指它，必然有一邊是錯的：
 * - 當 maskable 用：它**沒有 flatten**，favicon.svg 的圓角是透明的 ⇒ 內縮後那圈
 *   透明角落還在，Android adaptive icon 合成時會穿底缺角；而且圖裡已經自帶圓角，
 *   OS 再套一次自己的遮罩＝雙重內縮，圖示比同排其他 app 明顯小一圈。
 * - 當 any 用：any 要的就是這種帶留白的設計，所以 any 反而是對的那一邊。
 * 現在 any 走滿版、maskable 走安全區，兩張都 flatten 成不透明。
 */
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pub = resolve(root, 'packages/client/public');
const svg = readFileSync(resolve(pub, 'favicon.svg'));
/** 宣紙底。圖示不隨 app 主題變（主題是執行期的事，圖示是安裝時就烙進系統的） */
const PAPER = '#e7dcc3';

/** any：滿版。flatten 讓 favicon.svg 的透明圓角補成紙色，不留穿底 */
async function any(size, out) {
  await sharp(svg).resize(size, size).flatten({ background: PAPER }).png().toFile(resolve(pub, out));
  console.log(out, 'ok (any)');
}

/** maskable：內容縮到 80% 安全區、外圍補紙色，**且整張不透明**（OS 會自己裁形狀） */
async function maskable(size, out) {
  const inner = Math.round(size * 0.8);
  const pad = Math.round((size - inner) / 2);
  await sharp(svg)
    .resize(inner, inner)
    .flatten({ background: PAPER }) // 先補掉圓角的透明，再 extend
    .extend({ top: pad, bottom: size - inner - pad, left: pad, right: size - inner - pad, background: PAPER })
    .flatten({ background: PAPER }) // 保險：extend 後仍保證整張不透明
    .png()
    .toFile(resolve(pub, out));
  console.log(out, 'ok (maskable)');
}

await any(192, 'icon-192.png');
await any(512, 'icon-512.png');
await maskable(512, 'icon-maskable-512.png');
// apple-touch-icon：iOS 自己會加圓角，給滿版即可
await sharp(svg).resize(180, 180).flatten({ background: PAPER }).png().toFile(resolve(pub, 'apple-touch-icon.png'));
console.log('apple-touch-icon.png ok');
