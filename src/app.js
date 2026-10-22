'use strict';

/* ═══════════════════════════ Lumen UI ═══════════════════════════ */

const bridge = window.lumen || null;
const platform = bridge ? bridge.platform : /Mac/.test(navigator.platform) ? 'darwin' : 'win32';
document.body.classList.add('platform-' + platform);

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clone = (o) => JSON.parse(JSON.stringify(o));
const newSeed = () => Math.floor(Math.random() * 0xffffff);
const seedLabel = (s) => '#' + s.toString(16).toUpperCase().padStart(6, '0');

const DEFAULT_TWEAKS = { complexity: 0.5, glow: 0.6, scale: 0.5, grain: 0.25 };
const STYLE_KEYS = Object.keys(Lumen.STYLES);

/* ───────── Persistence ───────── */

const store = {
  load(key, fallback) {
    try {
      const v = localStorage.getItem('lumen:' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  save(key, value) {
    try { localStorage.setItem('lumen:' + key, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

const state = {
  params: store.load('params', null) || {
    style: 'waves',
    seed: newSeed(),
    palette: clone(Lumen.PALETTES[0]),
    ...DEFAULT_TWEAKS,
  },
  animate: store.load('animate', true),
  gallery: store.load('gallery', []),
  screen: { width: Math.round(screen.width * devicePixelRatio), height: Math.round(screen.height * devicePixelRatio) },
  t: 0,
  dirty: true,
};

let saveTimer;
const persist = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.save('params', state.params), 200);
};

/* ───────── Elements ───────── */

const el = {
  root: document.documentElement,
  stage: $('#stage'),
  frame: $('#frame'),
  art: $('#art'),
  ambient: $('#ambient'),
  flash: $('#flash'),
  actionbar: $('.actionbar'),
  styles: $('#styles'),
  palettes: $('#palettes'),
  swatches: $('#swatches'),
  seedText: $('#seedText'),
  metaStyle: $('#metaStyle'),
  metaSeed: $('#metaSeed'),
  metaRes: $('#metaRes'),
  animateBtn: $('#animateBtn'),
  favBtn: $('#favBtn'),
  wallpaperBtn: $('#wallpaperBtn'),
  shuffleBtn: $('#shuffleBtn'),
  galleryCount: $('#galleryCount'),
  gallery: $('#gallery'),
  galleryGrid: $('#galleryGrid'),
  galleryEmpty: $('#galleryEmpty'),
  toast: $('#toast'),
  toastText: $('#toastText'),
};

const artCtx = el.art.getContext('2d');
const ambientCtx = el.ambient.getContext('2d');

/* ───────── Frame sizing ───────── */

// Fit a frame to the space above its action bar, keeping the screen's aspect ratio.
function fitFrame(stage, frame, actionbar) {
  const rect = stage.getBoundingClientRect();
  const availW = rect.width - 8;
  const availH = rect.height - actionbar.offsetHeight - 22 - 8;
  const aspect = state.screen.width / state.screen.height;
  let w = availW, h = w / aspect;
  if (h > availH) { h = availH; w = h * aspect; }
  w = Math.max(200, Math.floor(w));
  h = Math.max(120, Math.floor(h));
  frame.style.width = w + 'px';
  frame.style.height = h + 'px';
  return { w, h };
}

function layoutFrame() {
  if (currentView !== 'create') return;
  const { w, h } = fitFrame(el.stage, el.frame, el.actionbar);
  const dpr = Math.min(devicePixelRatio || 1, 2);
  el.art.width = Math.round(w * dpr);
  el.art.height = Math.round(h * dpr);
  el.metaRes.textContent = `${state.screen.width} × ${state.screen.height}`;
  state.dirty = true;
}

/* ───────── Views ───────── */

let currentView = 'create';
const viewTabs = $$('.view-tab');

function setView(name) {
  currentView = name;
  viewTabs.forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  movePill($('#viewsPill'), $('.view-tab.active'));
  if (name === 'create') { layoutFrame(); renderThumbs(); }
  document.dispatchEvent(new CustomEvent('viewchange', { detail: name }));
}
viewTabs.forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));

function movePill(pill, target) {
  if (!pill || !target) return;
  pill.style.width = target.offsetWidth + 'px';
  pill.style.transform = `translateX(${target.offsetLeft - 4}px)`;
}

/* ───────── Render loop ───────── */

const isLive = () => state.animate && Lumen.STYLES[state.params.style].animated;

function draw() {
  Lumen.render(artCtx, el.art.width, el.art.height, state.params, state.t);
  ambientCtx.drawImage(el.art, 0, 0, el.ambient.width, el.ambient.height);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(64, now - last);
  last = now;
  if (currentView !== 'create') return requestAnimationFrame(frame);
  if (isLive() && !document.hidden) {
    state.t += dt / 1000;
    state.dirty = true;
  }
  if (state.dirty) {
    state.dirty = false;
    draw();
  }
  requestAnimationFrame(frame);
}

const invalidate = () => { state.dirty = true; };

/* ───────── Style cards ───────── */

const thumbs = {};
STYLE_KEYS.forEach((key, i) => {
  const b = document.createElement('button');
  b.className = 'style-card';
  b.dataset.style = key;
  b.title = `${Lumen.STYLES[key].label}  (${i + 1})`;
  const c = document.createElement('canvas');
  c.width = 200;
  c.height = 160;
  b.append(c);
  const label = document.createElement('span');
  label.textContent = Lumen.STYLES[key].label;
  b.append(label);
  b.addEventListener('click', () => setStyle(key));
  el.styles.append(b);
  thumbs[key] = c;
});

let thumbTimer;
function renderThumbs() {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => {
    for (const key of STYLE_KEYS) {
      const c = thumbs[key];
      Lumen.render(c.getContext('2d'), c.width, c.height, { ...state.params, style: key, grain: 0 }, 2);
    }
  }, 60);
}

function setStyle(key) {
  if (!Lumen.STYLES[key]) return;
  state.params.style = key;
  syncUI();
  invalidate();
  persist();
}

/* ───────── Palettes ───────── */

Lumen.PALETTES.forEach((pal) => {
  const b = document.createElement('button');
  b.className = 'pal';
  b.dataset.name = pal.name;
  b.innerHTML = `<div class="pal-bar">${pal.colors.map((c) => `<i style="background:${c}"></i>`).join('')}</div><span class="pal-name">${pal.name}</span>`;
  b.addEventListener('click', () => setPalette(clone(pal)));
  el.palettes.append(b);
});

function setPalette(pal) {
  state.params.palette = pal;
  syncUI();
  invalidate();
  persist();
}

function buildSwatches() {
  el.swatches.innerHTML = '';
  const p = state.params.palette;
  const make = (value, onInput, extra = '') => {
    const s = document.createElement('label');
    s.className = 'swatch ' + extra;
    s.style.background = value;
    const input = document.createElement('input');
    input.type = 'color';
    input.value = value;
    input.addEventListener('input', () => {
      s.style.background = input.value;
      onInput(input.value);
      state.params.palette.name = 'Custom';
      $$('.pal').forEach((x) => x.classList.remove('active'));
      applyAccent();
      invalidate();
      renderThumbs();
      persist();
    });
    s.append(input);
    el.swatches.append(s);
  };
  p.colors.forEach((c, i) => make(c, (v) => { state.params.palette.colors[i] = v; }));
  make(p.bg, (v) => { state.params.palette.bg = v; }, 'bg');
}

function applyAccent() {
  // Accent the UI with the palette's two brightest colours so buttons stay vivid.
  const [a1, a2] = [...state.params.palette.colors].sort((x, y) => Lumen.luminance(y) - Lumen.luminance(x));
  el.root.style.setProperty('--a1', a1);
  el.root.style.setProperty('--a2', a2);
  const lum = (Lumen.luminance(a1) + Lumen.luminance(a2)) / 2;
  el.root.style.setProperty('--on-accent', lum > 0.45 ? '#0a0a0c' : '#ffffff');
}

/* ───────── Sliders ───────── */

const sliders = $$('[data-param]');
function paintSlider(input) {
  input.style.setProperty('--fill', input.value * 100 + '%');
}
sliders.forEach((input) => {
  input.addEventListener('input', () => {
    state.params[input.dataset.param] = Number(input.value);
    paintSlider(input);
    invalidate();
    renderThumbs();
    persist();
    syncFav();
  });
});

$('#resetTweaks').addEventListener('click', () => {
  Object.assign(state.params, DEFAULT_TWEAKS);
  syncUI();
  invalidate();
  persist();
});

/* ───────── Sync UI with state ───────── */

function syncUI() {
  const p = state.params;
  $$('.style-card').forEach((c) => c.classList.toggle('active', c.dataset.style === p.style));
  $$('.pal').forEach((b) => b.classList.toggle('active', b.dataset.name === p.palette.name));
  sliders.forEach((s) => { s.value = p[s.dataset.param]; paintSlider(s); });
  buildSwatches();
  applyAccent();
  el.seedText.textContent = seedLabel(p.seed);
  el.metaSeed.textContent = seedLabel(p.seed);
  el.metaStyle.textContent = Lumen.STYLES[p.style].label;

  const animatable = Lumen.STYLES[p.style].animated;
  el.animateBtn.disabled = !animatable;
  el.animateBtn.setAttribute('aria-pressed', String(state.animate && animatable));
  el.animateBtn.title = animatable ? 'Live motion  (A)' : 'This style is still-only';
  $('#liveArtBtn').disabled = !animatable;
  renderThumbs();
  syncFav();
}

/* ───────── Actions ───────── */

function flash() {
  el.flash.classList.remove('go');
  void el.flash.offsetWidth;
  el.flash.classList.add('go');
}

function shuffle() {
  state.params.seed = newSeed();
  el.shuffleBtn.classList.remove('spin');
  void el.shuffleBtn.offsetWidth;
  el.shuffleBtn.classList.add('spin');
  flash();
  syncUI();
  invalidate();
  persist();
}

function surprisePalette() {
  setPalette(Lumen.randomPalette(newSeed()));
  flash();
}

function toggleAnimate() {
  if (!Lumen.STYLES[state.params.style].animated) return;
  state.animate = !state.animate;
  store.save('animate', state.animate);
  syncUI();
}

async function renderFull() {
  if (bridge) {
    try { state.screen = await bridge.screenSize(); } catch { /* keep estimate */ }
  }
  const c = document.createElement('canvas');
  c.width = state.screen.width;
  c.height = state.screen.height;
  Lumen.render(c.getContext('2d'), c.width, c.height, state.params, state.t);
  return c.toDataURL('image/png');
}

const fileName = () => `Lumen-${Lumen.STYLES[state.params.style].label}-${seedLabel(state.params.seed).slice(1)}.png`;

async function exportPng() {
  const url = await renderFull();
  if (!bridge) {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName();
    a.click();
    return toast('Image downloaded');
  }
  const saved = await bridge.saveImage(url, fileName());
  if (saved) toast('Saved to ' + saved.split(/[\\/]/).slice(-2).join('/'));
}

async function setWallpaper() {
  if (!bridge) return toast('Setting wallpapers works in the desktop app', true);
  el.wallpaperBtn.classList.add('busy');
  try {
    const url = await renderFull();
    await bridge.setWallpaper(url);
    flash();
    toast('Wallpaper set. Take a look at your desktop ✦');
  } catch (err) {
    const msg = String(err && err.message || err);
    if (/-1743|not authori[sz]ed/i.test(msg)) {
      toast('Allow Lumen under System Settings → Privacy & Security → Automation', true);
    } else {
      toast('Could not set wallpaper. Try Export instead', true);
    }
    console.error(err);
  } finally {
    el.wallpaperBtn.classList.remove('busy');
  }
}

async function setLiveArt() {
  if (!bridge) return toast('Live wallpapers work in the desktop app', true);
  if (!Lumen.STYLES[state.params.style].animated) return;
  try {
    await bridge.liveStart({ kind: 'art', params: clone(state.params), t: state.t, name: Lumen.STYLES[state.params.style].label });
    flash();
    toast('Your art is now moving on your desktop ✦');
  } catch (err) {
    console.error(err);
    toast(liveError(err), true);
  }
}

function liveError(err) {
  const msg = String((err && err.message) || err);
  if (/macOS and Windows/.test(msg)) return 'Live wallpapers work on macOS and Windows';
  return 'Could not start the live wallpaper';
}

el.shuffleBtn.addEventListener('click', shuffle);
$('#liveArtBtn').addEventListener('click', setLiveArt);
el.animateBtn.addEventListener('click', toggleAnimate);
el.wallpaperBtn.addEventListener('click', setWallpaper);
$('#exportBtn').addEventListener('click', exportPng);
$('#randomPalette').addEventListener('click', surprisePalette);
$('#copySeed').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(seedLabel(state.params.seed));
    toast('Seed copied');
  } catch {
    toast('Could not copy', true);
  }
});

/* ───────── Gallery ───────── */

const sameArt = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const savedIndex = () => state.gallery.findIndex((g) => sameArt(g.params, state.params));

function syncFav() {
  el.favBtn.classList.toggle('saved', savedIndex() >= 0);
  const n = state.gallery.length;
  el.galleryCount.textContent = n;
  el.galleryCount.classList.toggle('has', n > 0);
}

function toggleFav() {
  const i = savedIndex();
  if (i >= 0) {
    state.gallery.splice(i, 1);
    toast('Removed from gallery');
  } else {
    state.gallery.unshift({ id: Date.now().toString(36), params: clone(state.params), t: state.t });
    toast('Saved to gallery ♥');
    el.galleryCount.classList.remove('bump');
    void el.galleryCount.offsetWidth;
    el.galleryCount.classList.add('bump');
  }
  store.save('gallery', state.gallery);
  syncFav();
}
el.favBtn.addEventListener('click', toggleFav);

function renderGallery() {
  el.galleryGrid.innerHTML = '';
  el.galleryEmpty.classList.toggle('show', state.gallery.length === 0);
  const aspect = state.screen.width / state.screen.height;
  state.gallery.forEach((g, i) => {
    const item = document.createElement('div');
    item.className = 'g-item';
    item.style.animationDelay = Math.min(i, 12) * 35 + 'ms';
    const c = document.createElement('canvas');
    c.width = 360;
    c.height = Math.round(360 / aspect);
    item.append(c);
    item.insertAdjacentHTML('beforeend', `
      <div class="g-info"><b>${Lumen.STYLES[g.params.style].label}</b><span>${seedLabel(g.params.seed)}</span></div>
      <button class="g-del" title="Delete"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`);
    item.addEventListener('click', (e) => {
      if (e.target.closest('.g-del')) {
        state.gallery = state.gallery.filter((x) => x.id !== g.id);
        store.save('gallery', state.gallery);
        syncFav();
        renderGallery();
        return;
      }
      state.params = clone(g.params);
      state.t = g.t || 0;
      closeGallery();
      syncUI();
      invalidate();
      persist();
      flash();
    });
    el.galleryGrid.append(item);
    requestAnimationFrame(() => Lumen.render(c.getContext('2d'), c.width, c.height, g.params, g.t || 0));
  });
}

function openGallery() {
  renderGallery();
  el.gallery.classList.add('open');
  el.gallery.setAttribute('aria-hidden', 'false');
}
function closeGallery() {
  el.gallery.classList.remove('open');
  el.gallery.setAttribute('aria-hidden', 'true');
}
$('#openGallery').addEventListener('click', openGallery);
$('#closeGallery').addEventListener('click', closeGallery);
el.gallery.addEventListener('mousedown', (e) => { if (e.target === el.gallery) closeGallery(); });

/* ───────── Toast ───────── */

let toastTimer;
function toast(msg, isError = false) {
  el.toastText.textContent = msg;
  el.toast.classList.toggle('error', isError);
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), isError ? 4200 : 2400);
}

/* ───────── Keyboard ───────── */

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return closeGallery();
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && currentView === 'create') {
    e.preventDefault();
    return exportPng();
  }
  if (currentView !== 'create') return;
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.matches('input[type=color]')) return;
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); shuffle(); }
  else if (k === 'c') surprisePalette();
  else if (k === 'a') toggleAnimate();
  else if (k === 'f') toggleFav();
  else if (k === 'w') setWallpaper();
  else if (k === 'l') setLiveArt();
  else if (k === 'g') (el.gallery.classList.contains('open') ? closeGallery : openGallery)();
  else if (/^[1-9]$/.test(k)) setStyle(STYLE_KEYS[Number(k) - 1]);
});

/* ───────── Boot ───────── */

window.addEventListener('resize', () => {
  layoutFrame();
  movePill($('#viewsPill'), $('.view-tab.active'));
});

(async () => {
  if (bridge) {
    try { state.screen = await bridge.screenSize(); } catch { /* keep estimate */ }
  }
  syncUI();
  layoutFrame();
  movePill($('#viewsPill'), $('.view-tab.active'));
  requestAnimationFrame(frame);
})();
