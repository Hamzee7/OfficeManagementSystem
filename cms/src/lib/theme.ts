/** Brand colour helpers. Guarantees readable text on buttons and links whatever colour an organization picks. */
type RGB = [number, number, number];

export function parseHex(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (c: RGB) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
function lum([r, g, b]: RGB): number {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrast(a: RGB, b: RGB): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const WHITE: RGB = [255, 255, 255], BLACK: RGB = [15, 23, 42], PAGE_DARK: RGB = [25, 33, 42], PAGE_LIGHT: RGB = [255, 255, 255];

/** Move `c` towards `target` until it reaches `min` contrast against `bg`. */
function ensureContrast(c: RGB, bg: RGB, target: RGB, min: number): RGB {
  let out = c;
  for (let i = 0; i < 20 && contrast(out, bg) < min; i++) out = mix(out, target, 0.12);
  return out;
}

export function themeCss(brandHex: string, pill: boolean): string {
  let brand = parseHex(brandHex) ?? parseHex("#0f6b66")!;
  const ink = contrast(brand, WHITE) >= contrast(brand, BLACK) ? WHITE : BLACK;
  // Mid-tone colours can fail with both white and dark text: move the button colour away from the text colour until it passes.
  brand = ensureContrast(brand, ink, ink === WHITE ? BLACK : WHITE, 4.5);
  const hover = mix(brand, ink === WHITE ? BLACK : WHITE, 0.14);
  const textLight = ensureContrast(brand, PAGE_LIGHT, BLACK, 4.5);
  const textDark = ensureContrast(brand, PAGE_DARK, WHITE, 4.5);
  const softLight = mix(brand, WHITE, 0.86);
  const softDark = mix(brand, PAGE_DARK, 0.78);
  return [
    `:root{--brand:${toHex(brand)};--brand-hover:${toHex(hover)};--brand-ink:${toHex(ink)};--brand-soft:${toHex(softLight)};--brand-text:${toHex(textLight)};--chart-1:${toHex(textLight)}}`,
    `@media (prefers-color-scheme:dark){:root{--brand-soft:${toHex(softDark)};--brand-text:${toHex(textDark)};--chart-1:${toHex(textDark)}}}`,
    pill ? `.btn{border-radius:999px}.badge{border-radius:999px}` : "",
  ].join("");
}
