/**
 * 分類籤條的顯示名。
 *
 * 為什麼要截：籤條是**直書**（`writing-mode: vertical-rl` + `white-space: nowrap`），
 * 於是「不換行的方向」是**高度**、而且沒有上限——8 字分類名在 100% 字級就是 174px，
 * 系統字級放到 200% 是 330px，一條籤就吃掉半個抽屜。
 * （順帶一提 `line-height` 在直書下管的是**水平寬度**，調它不會讓籤條變矮。）
 *
 * 不加省略號：U+2026 在 `text-orientation: upright` 下會被立起來，在紙籤上看起來像印壞，
 * 而印章 glyph 已經足夠識別；完整名字由 aria-label/title 帶回。
 * 逐 code point 截斷（比照 core 的 digestItems）：分類名可能含 surrogate pair，
 * 直接 slice 會把一個字剖成兩半。
 */
export const CAT_TAG_CHARS = 4;

export function catTagName(name: string): string {
  return [...name].slice(0, CAT_TAG_CHARS).join('');
}
