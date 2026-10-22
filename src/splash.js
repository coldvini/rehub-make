'use strict';

/* Lumen splash: plays for the time the main process gives it, then fades out. */

const DURATION = Number(new URLSearchParams(location.search).get('ms')) || 5600;
const OUT_MS = 550;

const STEPS = [
  'Waking up',
  'Mixing colours',
  'Warming up the canvas',
  'Loading your gallery',
  'Almost there',
];

const $ = (id) => document.getElementById(id);
const fill = $('fill');
const pct = $('pct');
const status = $('status');
const dots = [...$('dots').children];

// Progress that moves in gentle surges rather than a flat line, while
// always moving forward.
function progress(t) {
  const surge = t - Math.sin(t * Math.PI * 2 * 3) / (Math.PI * 2 * 3) * 0.6;
  return Math.max(0, Math.min(1, surge));
}

let step = -1;
function setStep(i) {
  if (i === step) return;
  step = i;
  status.classList.add('swap');
  setTimeout(() => {
    status.textContent = STEPS[i];
    status.classList.remove('swap');
  }, 180);
  dots.forEach((d, k) => {
    d.classList.toggle('on', k < i);
    d.classList.toggle('now', k === i);
  });
}

/* Background art: the Mesh style, gently moving */
const canvas = $('art');
const ctx = canvas.getContext('2d');
const params = {
  style: 'mesh',
  seed: 0x5b64e8,
  palette: { bg: '#07070b', colors: ['#7b2ff7', '#ff2e88', '#00b3ff', '#c026d3', '#00f0ff'] },
  complexity: 0.55,
  glow: 0.7,
  scale: 0.45,
  grain: 0,
};

const start = performance.now();
const BAR_MS = DURATION - OUT_MS - 250;

function frame(now) {
  const elapsed = now - start;
  const t = Math.min(1, elapsed / BAR_MS);
  const p = progress(t);
  fill.style.width = (p * 100).toFixed(2) + '%';
  pct.textContent = Math.round(p * 100) + '%';
  setStep(Math.min(STEPS.length - 1, Math.floor(p * STEPS.length * 0.999)));

  if (typeof Lumen !== 'undefined') Lumen.render(ctx, canvas.width, canvas.height, params, elapsed / 1000 + 3);
  if (elapsed < DURATION) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

setTimeout(() => $('card').classList.add('out'), DURATION - OUT_MS);
