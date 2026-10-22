'use strict';

/* ═══════════════════════════ Nocturne ═══════════════════════════ */

const bridge = window.nocturne || {
  platform: /Mac/.test(navigator.platform) ? 'darwin' : 'win32',
  setProgress() {},
  focusWindow() {},
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const MODES = {
  focus: { label: 'Focus', key: 'focus' },
  short: { label: 'Short break', key: 'short' },
  long: { label: 'Long break', key: 'long' },
};

const DEFAULT_SETTINGS = {
  focus: 25,
  short: 5,
  long: 15,
  interval: 4,
  autoBreaks: true,
  autoFocus: false,
  sound: true,
  notify: true,
  motion: true,
};

const QUOTES = [
  '“The successful warrior is the average man, with laser-like focus.” — Bruce Lee',
  '“Concentrate all your thoughts upon the work at hand.” — Alexander Graham Bell',
  '“It is not enough to be busy. The question is: what are we busy about?” — Thoreau',
  '“Starve your distractions, feed your focus.”',
  '“Deep work is the superpower of the 21st century.” — Cal Newport',
  '“Where focus goes, energy flows.” — Tony Robbins',
  '“You can do anything, but not everything.” — David Allen',
  '“Small, steady steps. Every single day.”',
];

/* ───────── Persistence ───────── */

const store = {
  load(key, fallback) {
    try {
      const v = localStorage.getItem('nocturne:' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  save(key, value) {
    try { localStorage.setItem('nocturne:' + key, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

const state = {
  settings: { ...DEFAULT_SETTINGS, ...store.load('settings', {}) },
  tasks: store.load('tasks', []),
  activeTaskId: store.load('activeTaskId', null),
  history: store.load('history', {}),   // { 'YYYY-MM-DD': minutes }
  sessions: store.load('sessions', {}), // { 'YYYY-MM-DD': count }
  cycle: store.load('cycle', 0),
  mode: 'focus',
  running: false,
  endAt: 0,
  remaining: 0,
  total: 0,
};

const saveTasks = () => { store.save('tasks', state.tasks); store.save('activeTaskId', state.activeTaskId); };
const saveStats = () => { store.save('history', state.history); store.save('sessions', state.sessions); store.save('cycle', state.cycle); };

/* ───────── Helpers ───────── */

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtClock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};
const fmtMinutes = (m) => {
  m = Math.round(m);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
};
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/* ───────── Elements ───────── */

const el = {
  root: document.documentElement,
  time: $('#time'),
  modeLabel: $('#modeLabel'),
  progress: $('#progress'),
  knob: $('#knob'),
  ticks: $('#ticks'),
  play: $('#playBtn'),
  reset: $('#resetBtn'),
  skip: $('#skipBtn'),
  cycle: $('#cycle'),
  modes: $('#modes'),
  modePill: $('#modePill'),
  tabPill: $('#tabPill'),
  currentTask: $('#currentTask'),
  currentTaskText: $('#currentTaskText'),
  tasks: $('#tasks'),
  tasksEmpty: $('#tasksEmpty'),
  taskInput: $('#taskInput'),
  addTask: $('#addTask'),
  clearDone: $('#clearDone'),
  sheet: $('#sheet'),
  toast: $('#toast'),
};

document.body.classList.add('platform-' + bridge.platform);

/* ───────── Dial ───────── */

const R = 168;
const CIRC = 2 * Math.PI * R;
el.progress.style.strokeDasharray = `${CIRC} ${CIRC}`;

const TICK_COUNT = 60;
const ticks = [];
for (let i = 0; i < TICK_COUNT; i++) {
  const a = (i / TICK_COUNT) * Math.PI * 2 - Math.PI / 2;
  const major = i % 5 === 0;
  const r1 = 186, r2 = major ? 198 : 194;
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', 200 + Math.cos(a) * r1);
  line.setAttribute('y1', 200 + Math.sin(a) * r1);
  line.setAttribute('x2', 200 + Math.cos(a) * r2);
  line.setAttribute('y2', 200 + Math.sin(a) * r2);
  line.setAttribute('class', 'tick' + (major ? ' major' : ''));
  el.ticks.appendChild(line);
  ticks.push(line);
}

let litCount = -1;
function drawDial() {
  const frac = state.total ? state.remaining / state.total : 1;
  el.progress.style.strokeDashoffset = CIRC * (1 - frac);
  el.knob.style.transform = `rotate(${frac * 360}deg)`;
  el.knob.style.opacity = frac > 0.002 ? 1 : 0;

  const lit = Math.ceil(frac * TICK_COUNT);
  if (lit !== litCount) {
    litCount = lit;
    ticks.forEach((t, i) => t.classList.toggle('lit', i < lit));
  }

  const clock = fmtClock(state.remaining);
  if (el.time.textContent !== clock) {
    el.time.textContent = clock;
    document.title = state.running ? `${clock} · ${MODES[state.mode].label} — Nocturne` : 'Nocturne';
  }
}

/* ───────── Timer ───────── */

const durationFor = (mode) => state.settings[mode] * 60 * 1000;

function setMode(mode, { autostart = false } = {}) {
  state.mode = mode;
  state.running = false;
  state.total = durationFor(mode);
  state.remaining = state.total;
  el.root.dataset.mode = mode;
  el.modeLabel.textContent = MODES[mode].label;
  $$('.mode', el.modes).forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  movePill(el.modePill, $('.mode.active', el.modes));
  document.body.classList.remove('running');
  bridge.setProgress(-1);
  renderCycle();
  drawDial();
  if (autostart) start();
}

function start() {
  if (state.running) return;
  if (state.remaining <= 0) state.remaining = state.total;
  state.running = true;
  state.endAt = Date.now() + state.remaining;
  document.body.classList.add('running');
  el.play.setAttribute('aria-label', 'Pause');
  ensureAudio();
  loop();
}

function pause() {
  if (!state.running) return;
  state.running = false;
  state.remaining = Math.max(0, state.endAt - Date.now());
  document.body.classList.remove('running');
  el.play.setAttribute('aria-label', 'Start');
  document.title = 'Nocturne';
  drawDial();
}

const toggle = () => (state.running ? pause() : start());

function reset() {
  setMode(state.mode);
}

function nextMode() {
  if (state.mode !== 'focus') return 'focus';
  return state.cycle > 0 && state.cycle % state.settings.interval === 0 ? 'long' : 'short';
}

function skip() {
  const next = nextMode();
  if (state.mode === 'long') { state.cycle = 0; saveStats(); }
  setMode(next);
}

function complete() {
  state.running = false;
  state.remaining = 0;
  drawDial();

  const finished = state.mode;
  if (finished === 'focus') {
    const k = dayKey();
    state.history[k] = (state.history[k] || 0) + state.settings.focus;
    state.sessions[k] = (state.sessions[k] || 0) + 1;
    state.cycle += 1;
    const task = state.tasks.find((t) => t.id === state.activeTaskId);
    if (task) { task.pomos = (task.pomos || 0) + 1; saveTasks(); renderTasks(); }
    saveStats();
    renderStats();
  } else if (finished === 'long') {
    state.cycle = 0;
    saveStats();
  }

  const next = nextMode();
  const auto = next === 'focus' ? state.settings.autoFocus : state.settings.autoBreaks;

  chime();
  celebrate();

  const title = finished === 'focus' ? 'Focus session complete' : 'Break is over';
  const body = finished === 'focus'
    ? `Nice work. Time for a ${next === 'long' ? 'long' : 'short'} break.`
    : 'Ready to dive back in?';
  notify(title, body);
  toast(finished === 'focus' ? '✦ Session complete — well done.' : '☾ Break over. Let’s go.');

  setMode(next, { autostart: auto });
}

let rafId = 0;
let lastProgressPush = 0;
function loop() {
  cancelAnimationFrame(rafId);
  const step = () => {
    if (!state.running) return;
    state.remaining = state.endAt - Date.now();
    if (state.remaining <= 0) return complete();
    drawDial();
    const now = performance.now();
    if (now - lastProgressPush > 1000) {
      lastProgressPush = now;
      bridge.setProgress(1 - state.remaining / state.total);
    }
    rafId = requestAnimationFrame(step);
  };
  step();
}

// rAF pauses when the window is hidden; keep time honest in the background.
setInterval(() => {
  if (state.running && document.hidden && Date.now() >= state.endAt) complete();
}, 500);
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.running) loop(); });

function renderCycle() {
  const n = state.settings.interval;
  const done = state.cycle % n === 0 && state.cycle > 0 && state.mode === 'long' ? n : state.cycle % n;
  el.cycle.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const dot = document.createElement('i');
    if (i < done) dot.className = 'done';
    else if (i === done && state.mode === 'focus') dot.className = 'now';
    el.cycle.appendChild(dot);
  }
}

/* ───────── Segmented pills ───────── */

function movePill(pill, target) {
  if (!target) return;
  pill.style.width = `${target.offsetWidth}px`;
  pill.style.transform = `translateX(${target.offsetLeft}px)`;
}

el.modes.addEventListener('click', (e) => {
  const b = e.target.closest('.mode');
  if (!b || b.dataset.mode === state.mode) return;
  setMode(b.dataset.mode);
});

const tabs = $$('.tab');
function setTab(name) {
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.tab-view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
  movePill(el.tabPill, $('.tab.active'));
  if (name === 'stats') renderStats();
}
tabs.forEach((t) => t.addEventListener('click', () => setTab(t.dataset.tab)));

window.addEventListener('resize', () => {
  movePill(el.modePill, $('.mode.active'));
  movePill(el.tabPill, $('.tab.active'));
  sizeCanvas();
});

/* ───────── Tasks ───────── */

const ICON_CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const ICON_CLOCK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2" stroke-linecap="round"/></svg>';

function renderTasks() {
  el.tasks.innerHTML = '';
  for (const t of state.tasks) {
    const li = document.createElement('li');
    li.className = 'task' + (t.done ? ' done' : '') + (t.id === state.activeTaskId ? ' active' : '');
    li.dataset.id = t.id;
    li.innerHTML = `
      <button class="check" aria-label="Complete">${ICON_CHECK}</button>
      <span class="task-text"></span>
      ${t.pomos ? `<span class="task-count">${ICON_CLOCK}${t.pomos}</span>` : ''}
      <button class="task-del" aria-label="Delete">${ICON_X}</button>`;
    $('.task-text', li).textContent = t.text;
    el.tasks.appendChild(li);
  }
  el.tasksEmpty.classList.toggle('show', state.tasks.length === 0);
  el.clearDone.classList.toggle('show', state.tasks.some((t) => t.done));
  renderCurrentTask();
}

function renderCurrentTask() {
  const t = state.tasks.find((x) => x.id === state.activeTaskId);
  el.currentTaskText.textContent = t ? t.text : 'No task selected';
  el.currentTask.classList.toggle('has-task', !!t);
}

el.addTask.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = el.taskInput.value.trim();
  if (!text) return;
  const task = { id: uid(), text, done: false, pomos: 0 };
  state.tasks.unshift(task);
  if (!state.activeTaskId) state.activeTaskId = task.id;
  el.taskInput.value = '';
  saveTasks();
  renderTasks();
});

el.tasks.addEventListener('click', (e) => {
  const li = e.target.closest('.task');
  if (!li) return;
  const task = state.tasks.find((t) => t.id === li.dataset.id);
  if (!task) return;

  if (e.target.closest('.task-del')) {
    li.classList.add('leaving');
    setTimeout(() => {
      state.tasks = state.tasks.filter((t) => t.id !== task.id);
      if (state.activeTaskId === task.id) state.activeTaskId = null;
      saveTasks();
      renderTasks();
    }, 280);
    return;
  }

  if (e.target.closest('.check')) {
    task.done = !task.done;
    if (task.done && state.activeTaskId === task.id) {
      const next = state.tasks.find((t) => !t.done);
      state.activeTaskId = next ? next.id : null;
    }
    if (task.done) toast('✓ Task completed');
  } else {
    state.activeTaskId = state.activeTaskId === task.id ? null : task.id;
  }
  saveTasks();
  renderTasks();
});

el.clearDone.addEventListener('click', () => {
  state.tasks = state.tasks.filter((t) => !t.done);
  saveTasks();
  renderTasks();
});

el.currentTask.addEventListener('click', () => {
  setTab('tasks');
  if (!state.tasks.length) el.taskInput.focus();
});

/* ───────── Stats ───────── */

function renderStats() {
  const today = dayKey();
  $('#kToday').textContent = fmtMinutes(state.history[today] || 0);
  $('#kSessions').textContent = state.sessions[today] || 0;

  let streak = 0;
  const d = new Date();
  if (!state.history[dayKey(d)]) d.setDate(d.getDate() - 1);
  while (state.history[dayKey(d)] > 0) { streak++; d.setDate(d.getDate() - 1); }
  $('#kStreak').textContent = streak;

  const total = Object.values(state.history).reduce((a, b) => a + b, 0);
  $('#kTotal').textContent = total >= 60 ? `${(total / 60).toFixed(total >= 600 ? 0 : 1)}h` : `${total}m`;

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const x = new Date();
    x.setDate(x.getDate() - i);
    days.push({ key: dayKey(x), label: x.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2), today: i === 0 });
  }
  const max = Math.max(60, ...days.map((x) => state.history[x.key] || 0));
  const week = days.reduce((a, x) => a + (state.history[x.key] || 0), 0);
  $('#weekTotal').textContent = fmtMinutes(week);

  const chart = $('#chart');
  chart.innerHTML = '';
  days.forEach((x, i) => {
    const m = state.history[x.key] || 0;
    const col = document.createElement('div');
    col.className = 'bar-col';
    col.innerHTML = `
      <div class="bar-wrap">
        <div class="bar ${m ? 'has' : ''} ${x.today ? 'today' : ''}" style="height:${Math.max(3, (m / max) * 100)}%;animation-delay:${i * 50}ms"></div>
        <span class="bar-tip">${fmtMinutes(m)}</span>
      </div>
      <span class="bar-day ${x.today ? 'today' : ''}">${x.label}</span>`;
    chart.appendChild(col);
  });

  $('#quote').textContent = QUOTES[Math.floor(Math.random() * QUOTES.length)];
}

/* ───────── Settings ───────── */

function openSettings() { el.sheet.classList.add('open'); el.sheet.setAttribute('aria-hidden', 'false'); }
function closeSettings() { el.sheet.classList.remove('open'); el.sheet.setAttribute('aria-hidden', 'true'); }

$('#openSettings').addEventListener('click', openSettings);
$('#closeSettings').addEventListener('click', closeSettings);
el.sheet.addEventListener('mousedown', (e) => { if (e.target === el.sheet) closeSettings(); });

function paintSlider(input) {
  const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--fill', pct + '%');
  const out = input.parentElement.querySelector('output');
  out.textContent = input.dataset.setting === 'interval' ? `${input.value} sessions` : `${input.value} min`;
}

$$('[data-setting]').forEach((input) => {
  const key = input.dataset.setting;
  if (input.type === 'checkbox') input.checked = !!state.settings[key];
  else { input.value = state.settings[key]; paintSlider(input); }

  input.addEventListener('input', () => {
    state.settings[key] = input.type === 'checkbox' ? input.checked : Number(input.value);
    store.save('settings', state.settings);
    if (input.type === 'range') paintSlider(input);
    if (key === state.mode && !state.running) setMode(state.mode);
    if (key === 'interval') renderCycle();
    if (key === 'notify' && input.checked && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    if (key === 'motion') startAurora();
  });
});

/* ───────── Sound, notifications, toast ───────── */

let audio;
function ensureAudio() {
  if (!audio) {
    try { audio = new AudioContext(); } catch { /* no audio */ }
  }
  if (audio && audio.state === 'suspended') audio.resume();
}

function chime() {
  if (!state.settings.sound) return;
  ensureAudio();
  if (!audio) return;
  const now = audio.currentTime;
  const master = audio.createGain();
  master.gain.value = 0.22;
  master.connect(audio.destination);
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    const t = now + i * 0.14;
    const osc = audio.createOscillator();
    const g = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.6, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 2.5);
  });
}

function notify(title, body) {
  if (!state.settings.notify || !('Notification' in window)) return;
  const fire = () => {
    const n = new Notification(title, { body, silent: true });
    n.onclick = () => bridge.focusWindow();
  };
  if (Notification.permission === 'granted') fire();
  else if (Notification.permission !== 'denied') Notification.requestPermission().then((p) => p === 'granted' && fire());
}

let toastTimer;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2600);
}

function celebrate() {
  document.body.classList.remove('pulse');
  void document.body.offsetWidth;
  document.body.classList.add('pulse');
}

/* ───────── Controls & shortcuts ───────── */

el.play.addEventListener('click', toggle);
el.reset.addEventListener('click', reset);
el.skip.addEventListener('click', skip);

document.addEventListener('keydown', (e) => {
  const typing = e.target.matches('input:not([type=range]):not([type=checkbox])');
  if (e.key === 'Escape') {
    if (el.sheet.classList.contains('open')) closeSettings();
    else if (typing) e.target.blur();
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

  switch (e.key) {
    case ' ': e.preventDefault(); toggle(); break;
    case 'r': case 'R': reset(); break;
    case 's': case 'S': skip(); break;
    case '1': setMode('focus'); break;
    case '2': setMode('short'); break;
    case '3': setMode('long'); break;
    case 'n': case 'N': e.preventDefault(); setTab('tasks'); el.taskInput.focus(); break;
    case ',': el.sheet.classList.contains('open') ? closeSettings() : openSettings(); break;
  }
});

/* ───────── Aurora background ───────── */

const canvas = $('#aurora');
const ctx = canvas.getContext('2d');
const SCALE = 0.125;

function sizeCanvas() {
  canvas.width = Math.max(1, Math.round(innerWidth * SCALE));
  canvas.height = Math.max(1, Math.round(innerHeight * SCALE));
  if (!state.settings.motion) drawAurora(0);
}

const blobs = [
  { c: 'a1', x: 0.25, y: 0.35, r: 0.55, sx: 0.00011, sy: 0.00007, p: 0.0 },
  { c: 'a2', x: 0.75, y: 0.65, r: 0.5, sx: 0.00008, sy: 0.00012, p: 1.7 },
  { c: 'a1', x: 0.6, y: 0.2, r: 0.35, sx: 0.00014, sy: 0.00009, p: 3.1 },
  { c: 'a2', x: 0.2, y: 0.85, r: 0.4, sx: 0.0001, sy: 0.00013, p: 4.4 },
];

function drawAurora(t) {
  const w = canvas.width, h = canvas.height;
  const cs = getComputedStyle(el.root);
  const colors = { a1: cs.getPropertyValue('--a1').trim(), a2: cs.getPropertyValue('--a2').trim() };
  const energy = state.running ? 0.3 : 0.2;

  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#050507';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';

  for (const b of blobs) {
    const x = (b.x + Math.sin(t * b.sx + b.p) * 0.18) * w;
    const y = (b.y + Math.cos(t * b.sy + b.p) * 0.16) * h;
    const r = b.r * Math.max(w, h) * (1 + Math.sin(t * 0.0003 + b.p) * 0.08);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, colors[b.c]);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = energy;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.globalAlpha = 1;
}

let auroraRaf = 0;
let lastFrame = 0;
function startAurora() {
  cancelAnimationFrame(auroraRaf);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!state.settings.motion || reduce) {
    // Static frame, but still follow the mode colour while it transitions.
    const until = performance.now() + 1500;
    const settle = (t) => { drawAurora(4000); if (t < until) auroraRaf = requestAnimationFrame(settle); };
    auroraRaf = requestAnimationFrame(settle);
    return;
  }
  const frame = (t) => {
    if (t - lastFrame > 33) { lastFrame = t; drawAurora(t); }
    auroraRaf = requestAnimationFrame(frame);
  };
  auroraRaf = requestAnimationFrame(frame);
}

new MutationObserver(() => { if (!state.settings.motion) startAurora(); })
  .observe(el.root, { attributes: true, attributeFilter: ['data-mode'] });

/* ───────── Boot ───────── */

sizeCanvas();
setMode('focus');
renderTasks();
renderStats();
requestAnimationFrame(() => {
  movePill(el.modePill, $('.mode.active'));
  movePill(el.tabPill, $('.tab.active'));
});
startAurora();
