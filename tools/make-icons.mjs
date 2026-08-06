/**
 * PWA icons 產生器：favicon.svg → icon-192 / icon-512（maskable 安全區 80%）/ apple-touch-icon。
 * 用法：node tools/make-icons.mjs（sharp 在 root devDeps）
 */
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pub = resolve(root, 'packages/client/public');
const svg = readFileSync(resolve(pub, 'favicon.svg'));

/** maskable：內容縮到 80% 安全區、外圍補宣紙底色（Android 圓形裁切不掉章） */
async function maskable(size, out) {
  const inner = Math.round(size * 0.8);
  const pad = Math.round((size - inner) / 2);
  await sharp(svg)
    .resize(inner, inner)
    .extend({ top: pad, bottom: size - inner - pad, left: pad, right: size - inner - pad, background: '#e7dcc3' })
    .png()
    .toFile(resolve(pub, out));
  console.log(out, 'ok');
}

await maskable(192, 'icon-192.png');
await maskable(512, 'icon-512.png');
// apple-touch-icon：iOS 自己會加圓角，給滿版即可
await sharp(svg).resize(180, 180).flatten({ background: '#e7dcc3' }).png().toFile(resolve(pub, 'apple-touch-icon.png'));
console.log('apple-touch-icon.png ok');
