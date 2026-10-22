'use strict';

/* ═══════════════════ Lumen — generative art engine ═══════════════════
 * Every artwork is a pure function of (params, size, time), so a saved
 * creation re-renders identically at any resolution.
 */

const Lumen = (() => {
  /* ───────── Randomness & colour ───────── */

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const hexToRgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const rgbToHex = (r, g, b) =>
    '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const rgba = (hex, a) => {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  };
  const mix = (h1, h2, t) => {
    const a = hexToRgb(h1), b = hexToRgb(h2);
    return rgbToHex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
  };
  const lighten = (hex, t) => (t >= 0 ? mix(hex, '#ffffff', t) : mix(hex, '#000000', -t));
  const luminance = (hex) => {
    const [r, g, b] = hexToRgb(hex).map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  function samplePalette(colors, u) {
    u = Math.max(0, Math.min(0.9999, u)) * (colors.length - 1);
    const i = Math.floor(u);
    return mix(colors[i], colors[i + 1] || colors[i], u - i);
  }

  function hsl(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
  }

  function randomPalette(seed) {
    const r = rng(seed);
    const base = r() * 360;
    const schemes = [
      [0, 25, 50, -25, 180],     // analogous + pop
      [0, 120, 240, 30, 150],    // triad
      [0, 150, 210, 20, 330],    // split complementary
      [0, 35, 70, 105, 140],     // wide sweep
      [0, 10, -10, 180, 190],    // complementary
    ];
    const offs = schemes[Math.floor(r() * schemes.length)];
    const colors = offs.map((o) => hsl((base + o + 360) % 360, 65 + r() * 30, 48 + r() * 22));
    return { name: 'Random', bg: hsl(base, 35, 3 + r() * 4), colors };
  }

  const PALETTES = [
    { name: 'Midnight',  bg: '#05060f', colors: ['#4f46e5', '#7c3aed', '#c026d3', '#2563eb', '#0ea5e9'] },
    { name: 'Synthwave', bg: '#0a0312', colors: ['#ff2e88', '#ff8a00', '#7b2ff7', '#f72585', '#00f0ff'] },
    { name: 'Aurora',    bg: '#020a0a', colors: ['#00ffa3', '#00b3ff', '#7d5fff', '#00e0c6', '#2bff88'] },
    { name: 'Ember',     bg: '#0c0402', colors: ['#ff4d00', '#ff9e00', '#ff006e', '#ffd000', '#c1121f'] },
    { name: 'Ocean',     bg: '#01060d', colors: ['#0077b6', '#00b4d8', '#90e0ef', '#023e8a', '#48cae4'] },
    { name: 'Candy',     bg: '#0b0710', colors: ['#ff9ff3', '#feca57', '#ff6b6b', '#48dbfb', '#a29bfe'] },
    { name: 'Forest',    bg: '#030805', colors: ['#2d6a4f', '#52b788', '#95d5b2', '#1b4332', '#d8f3dc'] },
    { name: 'Mono',      bg: '#050505', colors: ['#ffffff', '#a1a1aa', '#52525b', '#d4d4d8', '#71717a'] },
  ];

  /* ───────── Styles ───────── */

  const TAU = Math.PI * 2;

  function blob(ctx, x, y, rad, color, alpha) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, rgba(color, alpha));
    g.addColorStop(0.45, rgba(color, alpha * 0.45));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }

  const STYLES = {
    mesh: {
      label: 'Mesh',
      animated: true,
      draw(ctx, W, H, p, r, t) {
        const S = Math.min(W, H);
        const n = 5 + Math.round(p.complexity * 9);
        const move = (sp, ph) => [Math.sin(t * sp + ph) * S * 0.12, Math.cos(t * sp * 0.8 + ph * 1.3) * S * 0.12];
        for (let i = 0; i < n; i++) {
          const color = p.palette.colors[i % p.palette.colors.length];
          const ph = r() * TAU, sp = 0.15 + r() * 0.25;
          const [dx, dy] = move(sp, ph);
          const x = r() * W + dx, y = r() * H + dy;
          const rad = S * (0.3 + r() * 0.4) * (0.6 + p.scale * 0.8);
          const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
          g.addColorStop(0, rgba(color, 0.95));
          g.addColorStop(0.55, rgba(color, 0.4));
          g.addColorStop(1, rgba(color, 0));
          ctx.fillStyle = g;
          ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
        }
        ctx.globalCompositeOperation = 'screen';
        const highlights = 2 + Math.round(p.complexity * 2);
        for (let i = 0; i < highlights; i++) {
          const ph = r() * TAU;
          const [dx, dy] = move(0.2, ph);
          blob(ctx, r() * W + dx, r() * H + dy, S * (0.15 + r() * 0.2), lighten(p.palette.colors[i % 5], 0.35), 0.25 + p.glow * 0.45);
        }
      },
    },

    waves: {
      label: 'Waves',
      animated: true,
      draw(ctx, W, H, p, r, t) {
        const S = Math.min(W, H);
        const layers = 5 + Math.round(p.complexity * 8);
        const steps = 160;
        for (let i = 0; i < layers; i++) {
          const color = p.palette.colors[i % p.palette.colors.length];
          const base = H * (0.28 + (i / layers) * 0.62);
          const amp = H * (0.03 + r() * 0.07) * (0.5 + p.scale);
          const f1 = ((1 + r() * 2.2) * TAU) / W;
          const f2 = f1 * (2 + r() * 1.5);
          const ph = r() * TAU + t * (0.25 + r() * 0.35) * (i % 2 ? 1 : -1);

          const ys = [];
          for (let s = 0; s <= steps; s++) {
            const x = (s / steps) * W;
            ys.push(base + Math.sin(x * f1 + ph) * amp + Math.sin(x * f2 - ph * 1.7) * amp * 0.35);
          }
          const trace = () => {
            ctx.beginPath();
            ys.forEach((y, s) => (s ? ctx.lineTo((s / steps) * W, y) : ctx.moveTo(0, y)));
          };

          trace();
          ctx.lineTo(W, H);
          ctx.lineTo(0, H);
          ctx.closePath();
          const g = ctx.createLinearGradient(0, base - amp * 1.5, 0, H);
          g.addColorStop(0, rgba(color, 0.9));
          g.addColorStop(0.55, rgba(mix(color, p.palette.bg, 0.75), 0.95));
          g.addColorStop(1, rgba(p.palette.bg, 1));
          ctx.fillStyle = g;
          ctx.fill();

          trace();
          ctx.shadowColor = color;
          ctx.shadowBlur = S * 0.035 * p.glow;
          ctx.strokeStyle = rgba(lighten(color, 0.45), 0.55 + p.glow * 0.45);
          ctx.lineWidth = Math.max(1, S * 0.0022);
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      },
    },

    nebula: {
      label: 'Nebula',
      animated: true,
      draw(ctx, W, H, p, r, t) {
        const S = Math.min(W, H);
        const area = (W * H) / (1920 * 1080);
        ctx.globalCompositeOperation = 'screen';
        const clouds = 6 + Math.round(p.complexity * 6);
        for (let i = 0; i < clouds; i++) {
          const color = p.palette.colors[i % p.palette.colors.length];
          const x = W * (0.15 + r() * 0.7) + Math.sin(t * 0.1 + i) * S * 0.03;
          const y = H * (0.15 + r() * 0.7) + Math.cos(t * 0.08 + i) * S * 0.03;
          blob(ctx, x, y, S * (0.2 + r() * 0.4) * (0.6 + p.scale * 0.8), color, 0.3 + p.glow * 0.35);
        }

        ctx.globalCompositeOperation = 'lighter';
        const stars = Math.round(area * (500 + p.complexity * 2000));
        const unit = S / 1080;
        for (let i = 0; i < stars; i++) {
          const x = r() * W, y = r() * H;
          const size = (r() ** 3 * 1.6 + 0.35) * unit;
          const tw = 0.55 + 0.45 * Math.sin(t * (1 + r() * 2) + r() * TAU);
          const tint = r() < 0.25 ? p.palette.colors[Math.floor(r() * 5)] : '#ffffff';
          ctx.fillStyle = rgba(lighten(tint, 0.6), (0.35 + r() * 0.65) * tw);
          ctx.beginPath();
          ctx.arc(x, y, size, 0, TAU);
          ctx.fill();
        }

        const bright = 3 + Math.round(p.complexity * 4);
        for (let i = 0; i < bright; i++) {
          const x = r() * W, y = r() * H;
          const color = lighten(p.palette.colors[i % 5], 0.5);
          const tw = 0.75 + 0.25 * Math.sin(t * 1.5 + i * 2);
          const len = S * (0.02 + r() * 0.04) * (0.5 + p.glow) * tw;
          blob(ctx, x, y, len * 0.9, color, 0.9);
          const flare = (dx, dy) => {
            const g = ctx.createLinearGradient(x - dx, y - dy, x + dx, y + dy);
            g.addColorStop(0, rgba(color, 0));
            g.addColorStop(0.5, rgba('#ffffff', 0.9));
            g.addColorStop(1, rgba(color, 0));
            ctx.strokeStyle = g;
            ctx.lineWidth = Math.max(1, unit * 1.2);
            ctx.beginPath();
            ctx.moveTo(x - dx, y - dy);
            ctx.lineTo(x + dx, y + dy);
            ctx.stroke();
          };
          flare(len * 2, 0);
          flare(0, len * 2);
        }
      },
    },

    flow: {
      label: 'Flow',
      animated: false,
      draw(ctx, W, H, p, r) {
        const S = Math.min(W, H);
        const area = (W * H) / (1920 * 1080);
        const k = (1.2 + r() * 2.5) * (1.4 - p.scale * 0.8);
        const f = [r(), r(), r()].map((v) => ((0.6 + v * 1.8) * k) / S);
        const ph = [r() * TAU, r() * TAU, r() * TAU];
        const turn = 0.8 + r() * 1.2;
        const angle = (x, y) =>
          (Math.sin(x * f[0] + ph[0]) + Math.sin(y * f[1] + ph[1]) + Math.sin((x + y) * f[2] + ph[2])) * turn;

        ctx.globalCompositeOperation = 'screen';
        for (let i = 0; i < 4; i++) {
          blob(ctx, r() * W, r() * H, S * (0.35 + r() * 0.3), p.palette.colors[i % 5], 0.12 + p.glow * 0.15);
        }

        const count = Math.round(area * (900 + p.complexity * 2600));
        const steps = 90 + Math.round(p.complexity * 60);
        const stepLen = S * 0.0035;
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(0.8, S * (0.0012 + p.glow * 0.0018));
        const gAngle = r() * TAU, gx = Math.cos(gAngle), gy = Math.sin(gAngle);

        for (let i = 0; i < count; i++) {
          let x = r() * W * 1.2 - W * 0.1, y = r() * H * 1.2 - H * 0.1;
          const u = ((x / W - 0.5) * gx + (y / H - 0.5) * gy) + 0.5 + (r() - 0.5) * 0.3;
          ctx.strokeStyle = rgba(samplePalette(p.palette.colors, u), 0.3 + p.glow * 0.35);
          ctx.beginPath();
          ctx.moveTo(x, y);
          for (let s = 0; s < steps; s++) {
            const a = angle(x, y);
            x += Math.cos(a) * stepLen;
            y += Math.sin(a) * stepLen;
            ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      },
    },

    rings: {
      label: 'Orbit',
      animated: true,
      draw(ctx, W, H, p, r, t) {
        const S = Math.min(W, H);
        const cx = W * (0.3 + r() * 0.4), cy = H * (0.3 + r() * 0.4);
        ctx.globalCompositeOperation = 'screen';
        blob(ctx, cx, cy, S * 0.55 * (0.6 + p.scale * 0.8), p.palette.colors[0], 0.35 + p.glow * 0.3);

        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        const n = 7 + Math.round(p.complexity * 20);
        for (let i = 0; i < n; i++) {
          const color = p.palette.colors[i % p.palette.colors.length];
          const rad = S * (0.06 + (i / n) * 0.85) * (0.55 + p.scale * 0.8);
          const dir = r() < 0.5 ? -1 : 1;
          const start = r() * TAU + t * (0.08 + r() * 0.25) * dir;
          const len = Math.PI * (0.25 + r() * 1.5);
          const w = Math.max(1, S * (0.0015 + r() * 0.008));

          ctx.strokeStyle = rgba(color, 0.07);
          ctx.lineWidth = Math.max(1, S * 0.001);
          ctx.beginPath();
          ctx.arc(cx, cy, rad, 0, TAU);
          ctx.stroke();

          const a = Math.cos(start), b = Math.sin(start);
          const g = ctx.createLinearGradient(cx + a * rad, cy + b * rad, cx - a * rad, cy - b * rad);
          g.addColorStop(0, rgba(lighten(color, 0.3), 1));
          g.addColorStop(1, rgba(color, 0.15));
          ctx.strokeStyle = g;
          ctx.lineWidth = w;
          ctx.shadowColor = color;
          ctx.shadowBlur = S * 0.025 * p.glow;
          ctx.beginPath();
          ctx.arc(cx, cy, rad, start, start + len);
          ctx.stroke();
          ctx.shadowBlur = 0;

          if (r() < 0.45) {
            const e = start + len;
            const dx = cx + Math.cos(e) * rad, dy = cy + Math.sin(e) * rad;
            blob(ctx, dx, dy, w * 5 + S * 0.01 * p.glow, lighten(color, 0.5), 0.9);
          }
        }
      },
    },

    prism: {
      label: 'Prism',
      animated: true,
      draw(ctx, W, H, p, r, t) {
        const cols = Math.round((7 + p.complexity * 22) * (1.3 - p.scale * 0.6));
        const cell = W / cols;
        const rows = Math.ceil(H / cell) + 1;
        const pts = [];
        for (let j = 0; j <= rows; j++) {
          pts.push([]);
          for (let i = 0; i <= cols; i++) {
            const edgeX = i === 0 || i === cols;
            const jx = edgeX ? 0 : (r() - 0.5) * cell * 0.85;
            const jy = j === 0 ? 0 : (r() - 0.5) * cell * 0.85;
            pts[j].push([i * cell + jx, j * cell + jy]);
          }
        }
        const gA = r() * TAU, gx = Math.cos(gA), gy = Math.sin(gA);
        const lx = W * (0.2 + r() * 0.6), ly = H * (0.2 + r() * 0.6);
        const D = Math.hypot(W, H);
        const tri = (a, b, c, k) => {
          const mx = (a[0] + b[0] + c[0]) / 3, my = (a[1] + b[1] + c[1]) / 3;
          const u = (mx / W - 0.5) * gx + (my / H - 0.5) * gy + 0.5 + (r() - 0.5) * 0.12;
          let col = samplePalette(p.palette.colors, u);
          const light = 1 - Math.hypot(mx - lx, my - ly) / (D * 0.7);
          const shimmer = Math.sin(t * 1.2 + k * 0.7) * 0.06;
          col = lighten(col, (light - 0.5) * (0.4 + p.glow * 0.6) + (r() - 0.5) * 0.18 + shimmer);
          col = mix(col, p.palette.bg, 0.08 + (1 - p.glow) * 0.25);
          ctx.fillStyle = col;
          ctx.strokeStyle = col;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
          ctx.lineTo(c[0], c[1]);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        };
        let k = 0;
        for (let j = 0; j < rows; j++) {
          for (let i = 0; i < cols; i++) {
            const a = pts[j][i], b = pts[j][i + 1], c = pts[j + 1][i], d = pts[j + 1][i + 1];
            if ((i + j) % 2) { tri(a, b, d, k++); tri(a, d, c, k++); }
            else { tri(a, b, c, k++); tri(b, d, c, k++); }
          }
        }
        ctx.globalCompositeOperation = 'screen';
        blob(ctx, lx, ly, Math.min(W, H) * 0.6, lighten(p.palette.colors[0], 0.3), 0.25 * p.glow);
      },
    },
  };

  /* ───────── Post-processing ───────── */

  const grainTiles = new Map();
  function grainTile(seed) {
    if (grainTiles.has(seed)) return grainTiles.get(seed);
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const img = g.createImageData(256, 256);
    const r = rng(seed ^ 0x9e3779b9);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = r() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    grainTiles.set(seed, c);
    return c;
  }

  function render(ctx, W, H, params, t = 0) {
    const style = STYLES[params.style] || STYLES.mesh;
    const r = rng(params.seed);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.fillStyle = params.palette.bg;
    ctx.fillRect(0, 0, W, H);

    style.draw(ctx, W, H, params, r, t);

    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowBlur = 0;
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, rgba(params.palette.bg, 0.55));
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);

    if (params.grain > 0.01) {
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = params.grain * 0.14;
      ctx.fillStyle = ctx.createPattern(grainTile(1), 'repeat');
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  return { STYLES, PALETTES, render, rng, randomPalette, luminance, mix, lighten };
})();
