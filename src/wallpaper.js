'use strict';

/* Runs inside the live wallpaper window behind the desktop icons. */

const video = document.getElementById('video');
const canvas = document.getElementById('art');
const ctx = canvas.getContext('2d');

let config = null;
let paused = false;
let raf = 0;
let t = 0;
let last = 0;

// Generative art is soft, so half resolution at 30 fps looks the same and
// keeps the wallpaper light on the CPU.
const ART_SCALE = 0.5;
const FRAME_MS = 1000 / 30;

function sizeCanvas() {
  canvas.width = Math.round(innerWidth * devicePixelRatio * ART_SCALE);
  canvas.height = Math.round(innerHeight * devicePixelRatio * ART_SCALE);
}

function artLoop(now) {
  raf = requestAnimationFrame(artLoop);
  if (paused || now - last < FRAME_MS) return;
  t += Math.min(100, now - last) / 1000;
  last = now;
  Lumen.render(ctx, canvas.width, canvas.height, config.params, t);
}

function apply(next) {
  const changedSource = !config || config.kind !== next.kind || config.url !== next.url;
  config = next;
  cancelAnimationFrame(raf);

  if (config.kind === 'video') {
    canvas.classList.remove('show');
    video.classList.add('show');
    video.style.objectFit = config.fit === 'contain' ? 'contain' : 'cover';
    video.playbackRate = config.speed || 1;
    if (changedSource) video.src = config.url;
    if (!paused) video.play().catch(() => {});
  } else {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.classList.remove('show');
    canvas.classList.add('show');
    sizeCanvas();
    t = config.t || 0;
    last = 0;
    raf = requestAnimationFrame(artLoop);
  }
}

window.wallpaper.onConfig(apply);
window.wallpaper.onPaused((p) => {
  paused = p;
  if (config && config.kind === 'video') {
    if (paused) video.pause();
    else video.play().catch(() => {});
  }
});

video.addEventListener('ratechange', () => {
  if (config && video.playbackRate !== (config.speed || 1)) video.playbackRate = config.speed || 1;
});
window.addEventListener('resize', () => { if (config && config.kind === 'art') sizeCanvas(); });
