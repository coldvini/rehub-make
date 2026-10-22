'use strict';

/* ═══════════════════ Lumen — colour mixing ═══════════════════
 * Two ways to mix:
 *   paint: works in RYB space like real pigments (blue + yellow = green)
 *   light: averages in OKLab, a perceptual space, like overlapping lights
 * Plus k-means colour extraction for "mix from a photo".
 */

const Mixer = (() => {
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const hexToRgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };
  const rgbToHex = ([r, g, b]) =>
    '#' + [r, g, b].map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('');

  /* ───────── RYB (Sugita & Takahashi, "Paint-like colour mixing") ───────── */

  function rgbToRyb([R, G, B]) {
    const w = Math.min(R, G, B);
    let r = R - w, g = G - w, b = B - w;
    const mg = Math.max(r, g, b);
    let y = Math.min(r, g);
    r -= y; g -= y;
    if (b > 0 && g > 0) { b /= 2; g /= 2; }
    y += g; b += g;
    const my = Math.max(r, y, b);
    if (my > 0) { const n = mg / my; r *= n; y *= n; b *= n; }
    const k = Math.min(1 - R, 1 - G, 1 - B);
    return [r + k, y + k, b + k];
  }

  function rybToRgb([R, Y, B]) {
    const k = Math.min(R, Y, B);
    let r = R - k, y = Y - k, b = B - k;
    const my = Math.max(r, y, b);
    let g = Math.min(y, b);
    y -= g; b -= g;
    if (b > 0 && g > 0) { b *= 2; g *= 2; }
    r += y; g += y;
    const mg = Math.max(r, g, b);
    if (mg > 0) { const n = my / mg; r *= n; g *= n; b *= n; }
    // Red and blue pigment absorb each other: deepen toward purple, not magenta.
    const rb = Math.min(R - k, B - k);
    if (rb > 0 && my > 0) { const d = 1 - 0.45 * (rb / my); r *= d; g *= d; b *= d; }
    const w = Math.min(1 - R, 1 - Y, 1 - B);
    return [r + w, g + w, b + w];
  }

  function mixPaint(items) {
    const total = items.reduce((s, i) => s + i.amount, 0) || 1;
    const acc = [0, 0, 0];
    let strength = 0;
    for (const { color, amount } of items) {
      const ryb = rgbToRyb(hexToRgb(color));
      const w = amount / total;
      ryb.forEach((v, i) => (acc[i] += v * w));
      // Keep pigment strength: pure blue + pure yellow should give a full green, not a pale one.
      const k = Math.min(...ryb);
      strength += (Math.max(...ryb) - k) * w;
    }
    const k = Math.min(...acc);
    const chroma = Math.max(...acc) - k;
    if (chroma > 0) {
      const s = strength / chroma;
      for (let i = 0; i < 3; i++) acc[i] = clamp01(k + (acc[i] - k) * s);
    }
    return rgbToHex(rybToRgb(acc));
  }

  /* ───────── OKLab ───────── */

  const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

  function rgbToOklab(rgb) {
    const [r, g, b] = rgb.map(toLinear);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  }

  function oklabToRgb([L, a, b]) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ].map((c) => toGamma(clamp01(c)));
  }

  function mixLight(items) {
    const total = items.reduce((s, i) => s + i.amount, 0) || 1;
    const acc = [0, 0, 0];
    for (const { color, amount } of items) {
      rgbToOklab(hexToRgb(color)).forEach((v, i) => (acc[i] += (v * amount) / total));
    }
    return rgbToHex(oklabToRgb(acc));
  }

  const mix = (items, mode = 'paint') => {
    const list = items.filter((i) => i.amount > 0);
    if (!list.length) return '#000000';
    return mode === 'light' ? mixLight(list) : mixPaint(list);
  };

  /* ───────── Palette from a mix ───────── */

  // Walk from the first ingredient to the last, blending neighbours along the
  // way, with the full mix at the centre: the five colours read as a "stroke"
  // of paint being mixed.
  function paletteFrom(items, mode = 'paint') {
    const list = items.filter((i) => i.amount > 0);
    if (!list.length) return null;
    const center = mix(list, mode);
    const first = list[0].color;
    const last = list[list.length - 1].color;
    const one = (c) => ({ color: c, amount: 1 });
    let colors;
    if (list.length === 1) {
      const c = first;
      colors = [mix([one(c), { color: '#000000', amount: 1.2 }], 'light'), mix([one(c), { color: '#000000', amount: 0.4 }], 'light'), c,
        mix([one(c), { color: '#ffffff', amount: 0.35 }], 'light'), mix([one(c), { color: '#ffffff', amount: 1 }], 'light')];
    } else {
      colors = [first, mix([one(first), one(center)], mode), center, mix([one(center), one(last)], mode), last];
    }
    const bg = mix([{ color: center, amount: 1 }, { color: '#000000', amount: 5 }], 'light');
    return { name: 'Mixed', bg, colors, center };
  }

  /* ───────── Colour from a photo (k-means in OKLab) ───────── */

  function extract(imageData, k = 5) {
    const px = [];
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      px.push(rgbToOklab([d[i] / 255, d[i + 1] / 255, d[i + 2] / 255]));
    }
    if (!px.length) return [];
    const dist = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

    // k-means++ seeding, deterministic: always take the farthest point.
    const centers = [px[Math.floor(px.length / 2)]];
    while (centers.length < k && centers.length < px.length) {
      let best = 0, bestD = -1;
      for (let i = 0; i < px.length; i += 3) {
        const md = Math.min(...centers.map((c) => dist(px[i], c)));
        if (md > bestD) { bestD = md; best = i; }
      }
      centers.push(px[best]);
    }

    let counts = [];
    for (let iter = 0; iter < 12; iter++) {
      const sums = centers.map(() => [0, 0, 0]);
      counts = centers.map(() => 0);
      for (const p of px) {
        let ci = 0, cd = Infinity;
        centers.forEach((c, i) => { const dd = dist(p, c); if (dd < cd) { cd = dd; ci = i; } });
        sums[ci][0] += p[0]; sums[ci][1] += p[1]; sums[ci][2] += p[2];
        counts[ci]++;
      }
      centers.forEach((c, i) => { if (counts[i]) centers[i] = sums[i].map((v) => v / counts[i]); });
    }

    return centers
      .map((c, i) => ({ color: rgbToHex(oklabToRgb(c)), amount: counts[i] / px.length, chroma: Math.hypot(c[1], c[2]) }))
      .filter((c) => c.amount > 0.01)
      .sort((a, b) => b.amount - a.amount);
  }

  /* ───────── A friendly name for a colour ───────── */

  const HUES = [
    [15, 'Red'], [38, 'Orange'], [46, 'Amber'], [68, 'Yellow'], [90, 'Lime'], [150, 'Green'], [170, 'Mint'],
    [185, 'Teal'], [200, 'Cyan'], [215, 'Sky'], [240, 'Blue'], [260, 'Indigo'], [280, 'Violet'],
    [306, 'Purple'], [325, 'Magenta'], [345, 'Pink'], [360, 'Red'],
  ];

  function name(hex) {
    const [r, g, b] = hexToRgb(hex);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
    if (s < 0.12) {
      if (l < 0.12) return 'Ink Black';
      if (l > 0.9) return 'Snow White';
      return l < 0.45 ? 'Charcoal Grey' : l < 0.7 ? 'Stone Grey' : 'Mist Grey';
    }
    let h = 0;
    if (max === r) h = ((g - b) / (max - min)) % 6;
    else if (max === g) h = (b - r) / (max - min) + 2;
    else h = (r - g) / (max - min) + 4;
    h = (h * 60 + 360) % 360;
    const hue = HUES.find(([lim]) => h < lim)[1];
    if (hue === 'Orange' && l < 0.35) return 'Deep Brown';
    const tone = l < 0.22 ? 'Deep ' : l < 0.38 ? 'Dark ' : l > 0.8 ? 'Pale ' : l > 0.65 ? 'Soft ' : s > 0.8 ? 'Vivid ' : '';
    return tone + hue;
  }

  return { mix, paletteFrom, extract, name, hexToRgb, rgbToHex };
})();

if (typeof module !== 'undefined') module.exports = Mixer;
