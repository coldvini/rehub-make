'use strict';

/* ═══════════════════════════ Mix tab ═══════════════════════════ */

(() => {
  const PAINTS = [
    ['Red', '#e3262b'], ['Yellow', '#ffd400'], ['Blue', '#1e4fd8'], ['White', '#ffffff'], ['Black', '#141414'],
    ['Green', '#17a34a'], ['Orange', '#ff7a00'], ['Pink', '#ff5fa2'], ['Purple', '#7b3fe4'], ['Cyan', '#00c2e0'],
  ];
  const MAX = 8;

  const mix = {
    mode: store.load('mixMode', 'paint'),
    items: store.load('mixItems', null) || [
      { id: 'a', color: '#1e4fd8', amount: 1 },
      { id: 'b', color: '#ffd400', amount: 1 },
    ],
    result: null,
    // Stirring animation
    stir: 1,
    stirStart: 0,
    from: [],
    spin: 0,
  };

  const m$ = {
    bowl: $('#bowl'),
    glow: $('#bowlGlow'),
    name: $('#mixName'),
    hex: $('#mixHex'),
    strip: $('#resultStrip'),
    list: $('#ingredients'),
    count: $('#ingCount'),
    paints: $('#paints'),
    mode: $('#mixMode'),
    modeNote: $('#modeNote'),
    photoDrop: $('#photoDrop'),
    photoInput: $('#photoInput'),
    photoThumb: $('#photoThumb'),
    photoTitle: $('#photoTitle'),
    photoSub: $('#photoSub'),
  };
  const bctx = m$.bowl.getContext('2d');

  const save = () => { store.save('mixItems', mix.items); store.save('mixMode', mix.mode); };
  const uidOf = () => Math.random().toString(36).slice(2, 9);

  /* ───────── Compute ───────── */

  function recompute({ animate = true } = {}) {
    const pal = Mixer.paletteFrom(mix.items, mix.mode);
    mix.result = pal;
    const center = pal ? pal.center : '#222222';
    m$.name.textContent = pal ? Mixer.name(center) : 'Add a colour';
    m$.hex.textContent = center.toUpperCase();
    m$.glow.style.setProperty('--mix', center);

    m$.strip.innerHTML = '';
    if (pal) {
      pal.colors.forEach((c, i) => {
        const b = document.createElement('button');
        b.style.background = c;
        b.style.animationDelay = i * 40 + 'ms';
        if (i === 2) b.classList.add('center');
        b.innerHTML = `<span>${c.toUpperCase()}</span>`;
        b.title = 'Copy ' + c.toUpperCase();
        b.addEventListener('click', () => copy(c));
        m$.strip.append(b);
      });
    }
    $('#useMix').disabled = !pal;
    m$.count.textContent = `${mix.items.length} / ${MAX}`;
    if (animate) startStir();
    save();
  }

  async function copy(c) {
    try {
      await navigator.clipboard.writeText(c.toUpperCase());
      toast(`Copied ${c.toUpperCase()}`);
    } catch {
      toast('Could not copy', true);
    }
  }
  m$.hex.addEventListener('click', () => mix.result && copy(mix.result.center));

  /* ───────── Ingredients list ───────── */

  function renderList() {
    m$.list.innerHTML = '';
    for (const it of mix.items) {
      const li = document.createElement('li');
      li.className = 'ing';
      li.innerHTML = `
        <label class="swatch" style="background:${it.color}"><input type="color" value="${it.color}" /></label>
        <span class="ing-text"><b>${Mixer.name(it.color)}</b><span>${it.color.toUpperCase()}</span></span>
        <span class="parts-label">parts</span>
        <span class="stepper"><button data-d="-1" aria-label="Less">−</button><output>${it.amount}</output><button data-d="1" aria-label="More">+</button></span>
        <button class="ing-del" aria-label="Remove"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;
      const input = $('input', li);
      input.addEventListener('input', () => {
        it.color = input.value;
        $('.swatch', li).style.background = it.color;
        $('.ing-text b', li).textContent = Mixer.name(it.color);
        $('.ing-text span', li).textContent = it.color.toUpperCase();
        recompute();
      });
      $$('.stepper button', li).forEach((b) => b.addEventListener('click', () => {
        it.amount = Math.max(1, Math.min(10, it.amount + Number(b.dataset.d)));
        $('output', li).textContent = it.amount;
        recompute();
      }));
      $('.ing-del', li).addEventListener('click', () => {
        mix.items = mix.items.filter((x) => x !== it);
        renderList();
        recompute();
      });
      m$.list.append(li);
    }
  }

  function addColor(color) {
    const same = mix.items.find((x) => x.color.toLowerCase() === color.toLowerCase());
    if (same) {
      same.amount = Math.min(10, same.amount + 1);
    } else {
      if (mix.items.length >= MAX) return toast(`Up to ${MAX} colours in one mix`, true);
      mix.items.push({ id: uidOf(), color, amount: 1 });
    }
    renderList();
    recompute();
  }

  PAINTS.forEach(([label, c]) => {
    const b = document.createElement('button');
    b.className = 'paint';
    b.style.background = c;
    b.title = `Add ${label}`;
    b.addEventListener('click', () => addColor(c));
    m$.paints.append(b);
  });
  const custom = document.createElement('label');
  custom.className = 'paint custom';
  custom.title = 'Pick any colour';
  custom.innerHTML = '<input type="color" value="#ff6a00" />';
  $('input', custom).addEventListener('change', (e) => addColor(e.target.value));
  m$.paints.append(custom);

  /* ───────── Mode ───────── */

  const NOTES = {
    paint: 'Real paint rules: blue + yellow makes green.',
    light: 'Blends like glowing lights, smooth and bright.',
  };
  function setMode(mode) {
    mix.mode = mode;
    $$('button', m$.mode).forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    movePill($('.seg-pill', m$.mode), $('button.active', m$.mode));
    m$.modeNote.textContent = NOTES[mode];
    recompute();
  }
  $$('button', m$.mode).forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  /* ───────── Photo ───────── */

  function loadPhoto(file) {
    if (!file || !file.type.startsWith('image/')) return toast('That doesn’t look like a photo', true);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      const S = 120;
      const scale = Math.max(S / img.width, S / img.height);
      c.width = S;
      c.height = S;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, (S - img.width * scale) / 2, (S - img.height * scale) / 2, img.width * scale, img.height * scale);
      const found = Mixer.extract(g.getImageData(0, 0, S, S), 5);
      if (!found.length) return toast('Could not read colours from that photo', true);
      mix.items = found.map((f) => ({ id: uidOf(), color: f.color, amount: Math.max(1, Math.round(f.amount * 10)) }));
      m$.photoThumb.src = url;
      m$.photoDrop.classList.add('has');
      m$.photoTitle.textContent = `Found ${found.length} colours`;
      m$.photoSub.textContent = 'Mixed in the same amounts as your photo';
      renderList();
      recompute();
      toast('Lumen mixed your photo ✦');
    };
    img.onerror = () => toast('Could not open that image', true);
    img.src = url;
  }
  m$.photoInput.addEventListener('change', () => loadPhoto(m$.photoInput.files[0]));
  ['dragenter', 'dragover'].forEach((ev) => m$.photoDrop.addEventListener(ev, (e) => { e.preventDefault(); m$.photoDrop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => m$.photoDrop.addEventListener(ev, () => m$.photoDrop.classList.remove('drag')));
  m$.photoDrop.addEventListener('drop', (e) => { e.preventDefault(); loadPhoto(e.dataTransfer.files[0]); });

  /* ───────── Use it ───────── */

  $('#useMix').addEventListener('click', () => {
    if (!mix.result) return;
    const { center, ...pal } = mix.result;
    setPalette({ ...pal, name: 'Mixed' });
    setView('create');
    flash();
    toast('Your mixed colours are in. Hit Space for new art ✦');
  });
  $('#stirBtn').addEventListener('click', () => startStir(true));
  m$.bowl.addEventListener('click', () => startStir(true));

  /* ───────── Bowl animation ───────── */

  const STIR_MS = 2200;
  const ease = (x) => 1 - (1 - x) ** 3;
  const rgb = (hex) => Mixer.hexToRgb(hex).map((v) => v * 255);
  const lerpRgb = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const css = (c, a = 1) => `rgba(${c.map(Math.round).join(',')},${a})`;

  function startStir(force = false) {
    if (!force && mix.stir < 1 && mix.from.length === mix.items.length) return;
    mix.from = mix.items.map((it) => ({ color: rgb(it.color), amount: it.amount }));
    mix.stir = 0;
    mix.stirStart = performance.now();
  }

  function drawBowl(now) {
    const W = m$.bowl.width, H = m$.bowl.height;
    const cx = W / 2, cy = H / 2, R = W * 0.46;
    if (mix.stir < 1) mix.stir = Math.min(1, (now - mix.stirStart) / STIR_MS);
    const p = ease(mix.stir);
    mix.spin += (0.004 + (1 - p) * 0.06);
    const center = rgb(mix.result ? mix.result.center : '#222222');

    bctx.clearRect(0, 0, W, H);
    bctx.save();

    // Bowl rim and shadow
    bctx.beginPath();
    bctx.arc(cx, cy, R + W * 0.025, 0, Math.PI * 2);
    const rim = bctx.createLinearGradient(0, cy - R, 0, cy + R);
    rim.addColorStop(0, 'rgba(255,255,255,0.22)');
    rim.addColorStop(1, 'rgba(255,255,255,0.03)');
    bctx.fillStyle = rim;
    bctx.fill();

    bctx.beginPath();
    bctx.arc(cx, cy, R, 0, Math.PI * 2);
    bctx.clip();

    // The mixed paint underneath
    const base = bctx.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.05, cx, cy, R);
    base.addColorStop(0, css(lerpRgb(center, [255, 255, 255], 0.18)));
    base.addColorStop(0.7, css(center));
    base.addColorStop(1, css(lerpRgb(center, [0, 0, 0], 0.35)));
    bctx.fillStyle = base;
    bctx.fillRect(0, 0, W, H);

    // Unmixed streaks swirling in and dissolving into the result
    const total = mix.from.reduce((s, f) => s + f.amount, 0) || 1;
    mix.from.forEach((f, i) => {
      const share = f.amount / total;
      const arms = 3;
      for (let k = 0; k < arms; k++) {
        const a0 = (i / mix.from.length) * Math.PI * 2 + (k / arms) * Math.PI * 2 + mix.spin * (1 + i * 0.15);
        const col = lerpRgb(f.color, center, mix.stir ** 1.8);
        const alpha = (1 - mix.stir ** 2.2) * 0.95;
        if (alpha <= 0.01) continue;
        bctx.strokeStyle = css(col, alpha);
        bctx.lineCap = 'round';
        bctx.lineWidth = W * (0.03 + share * 0.12) * (1 - p * 0.6);
        bctx.beginPath();
        for (let s = 0; s <= 40; s++) {
          const tt = s / 40;
          const rr = R * (0.12 + tt * 0.8) * (1 - p * 0.35);
          const aa = a0 + tt * 3.2;
          const x = cx + Math.cos(aa) * rr, y = cy + Math.sin(aa) * rr;
          s ? bctx.lineTo(x, y) : bctx.moveTo(x, y);
        }
        bctx.stroke();
      }
    });

    // Gentle marbling once mixed, so the bowl never looks flat
    for (let k = 0; k < 3; k++) {
      const a = mix.spin * 0.6 + (k * Math.PI * 2) / 3;
      bctx.strokeStyle = css(lerpRgb(center, k % 2 ? [255, 255, 255] : [0, 0, 0], 0.2), 0.25 * p);
      bctx.lineWidth = W * 0.035;
      bctx.beginPath();
      bctx.arc(cx + Math.cos(a) * R * 0.15, cy + Math.sin(a) * R * 0.15, R * (0.35 + k * 0.17), a, a + 2.2);
      bctx.stroke();
    }

    // Glossy highlight
    const gl = bctx.createRadialGradient(cx - R * 0.42, cy - R * 0.48, 0, cx - R * 0.42, cy - R * 0.48, R * 0.5);
    gl.addColorStop(0, 'rgba(255,255,255,0.45)');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    bctx.fillStyle = gl;
    bctx.fillRect(0, 0, W, H);

    // Inner shadow at the edge
    const edge = bctx.createRadialGradient(cx, cy, R * 0.75, cx, cy, R);
    edge.addColorStop(0, 'rgba(0,0,0,0)');
    edge.addColorStop(1, 'rgba(0,0,0,0.45)');
    bctx.fillStyle = edge;
    bctx.fillRect(0, 0, W, H);
    bctx.restore();
  }

  let visible = false;
  function loop(now) {
    if (visible) drawBowl(now);
    requestAnimationFrame(loop);
  }

  document.addEventListener('viewchange', (e) => {
    visible = e.detail === 'mix';
    if (visible) {
      movePill($('.seg-pill', m$.mode), $('button.active', m$.mode));
      startStir(true);
    }
  });

  /* ───────── Boot ───────── */

  renderList();
  setMode(mix.mode);
  mix.stir = 1;
  requestAnimationFrame(loop);
})();
