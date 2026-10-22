'use strict';

/* ═══════════════════════════ Video tab ═══════════════════════════ */

(() => {
  const v$ = {
    stage: $('#videoStage'),
    frame: $('#videoFrame'),
    actionbar: $('#videoStage .actionbar'),
    preview: $('#videoPreview'),
    drop: $('#videoDrop'),
    badge: $('#liveBadge'),
    list: $('#videoList'),
    empty: $('#videoEmpty'),
    count: $('#videoCount'),
    setBtn: $('#setVideoWall'),
    stopBtn: $('#stopLive'),
    upload: $('#uploadVideo'),
    fit: $('#fitMode'),
    speed: $('#speedInput'),
    speedOut: $('#speedOut'),
    status: $('#statusCard'),
    statusTitle: $('#statusTitle'),
    statusSub: $('#statusSub'),
    login: $('#loginToggle'),
    liveDot: $('#liveDot'),
  };

  const vs = {
    videos: [],
    selected: store.load('videoSelected', null),
    fit: store.load('videoFit', 'cover'),
    speed: store.load('videoSpeed', 1),
    live: { active: false, config: null, startAtLogin: false },
  };

  const selectedVideo = () => vs.videos.find((v) => v.id === vs.selected) || null;
  const isLiveVideo = (v) => !!(v && vs.live.active && vs.live.config && vs.live.config.kind === 'video' && vs.live.config.file === v.file);

  /* ───────── Layout ───────── */

  function layout() {
    if (currentView !== 'video') return;
    fitFrame(v$.stage, v$.frame, v$.actionbar);
  }
  window.addEventListener('resize', layout);

  /* ───────── Preview & list ───────── */

  function showPreview() {
    const v = selectedVideo();
    v$.frame.classList.toggle('has-video', !!v);
    v$.frame.classList.toggle('fit-contain', vs.fit === 'contain');
    if (v) {
      if (v$.preview.dataset.src !== v.url) {
        v$.preview.dataset.src = v.url;
        v$.preview.src = v.url;
      }
      v$.preview.playbackRate = vs.speed;
      if (currentView === 'video') v$.preview.play().catch(() => {});
    } else {
      v$.preview.pause();
      v$.preview.removeAttribute('src');
      delete v$.preview.dataset.src;
    }
    syncStatus();
  }

  function renderList() {
    v$.list.innerHTML = '';
    v$.count.textContent = vs.videos.length;
    v$.empty.style.display = vs.videos.length ? 'none' : '';
    vs.videos.forEach((v, i) => {
      const item = document.createElement('div');
      item.className = 'v-item' + (v.id === vs.selected ? ' active' : '') + (isLiveVideo(v) ? ' live' : '');
      item.style.animationDelay = i * 30 + 'ms';
      item.title = v.name;
      item.innerHTML = `
        <video muted preload="metadata" src="${v.url}#t=0.5"></video>
        <span class="v-live"></span>
        <span class="v-name"></span>
        <button class="g-del" title="Remove"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;
      $('.v-name', item).textContent = v.name;
      item.addEventListener('click', async (e) => {
        if (e.target.closest('.g-del')) {
          vs.videos = await bridge.removeVideo(v.id);
          if (vs.selected === v.id) select(vs.videos[0] ? vs.videos[0].id : null);
          renderList();
          return;
        }
        select(v.id);
      });
      v$.list.append(item);
    });
  }

  function select(id) {
    vs.selected = id;
    store.save('videoSelected', id);
    renderList();
    showPreview();
  }

  async function refresh() {
    if (!bridge) return;
    vs.videos = await bridge.listVideos();
    if (!selectedVideo()) vs.selected = vs.videos[0] ? vs.videos[0].id : null;
    renderList();
    showPreview();
  }

  /* ───────── Adding videos ───────── */

  async function addFromPath(p) {
    try {
      const item = await bridge.importVideo(p);
      vs.videos = await bridge.listVideos();
      select(item.id);
      toast('Video added ✦');
    } catch (err) {
      console.error(err);
      toast('That video type isn’t supported. Try MP4, MOV or WebM', true);
    }
  }

  async function upload() {
    if (!bridge) return toast('Video wallpapers work in the desktop app', true);
    try {
      const item = await bridge.pickVideo();
      if (!item) return;
      vs.videos = await bridge.listVideos();
      select(item.id);
      toast('Video added ✦');
    } catch (err) {
      console.error(err);
      toast('Could not add that video', true);
    }
  }
  v$.upload.addEventListener('click', upload);
  v$.drop.addEventListener('click', (e) => { e.preventDefault(); upload(); });

  let dragDepth = 0;
  v$.stage.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; v$.frame.classList.add('drag'); });
  v$.stage.addEventListener('dragover', (e) => e.preventDefault());
  v$.stage.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; v$.frame.classList.remove('drag'); } });
  v$.stage.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    v$.frame.classList.remove('drag');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!bridge) return toast('Video wallpapers work in the desktop app', true);
    addFromPath(bridge.pathForFile(file));
  });

  /* ───────── Live wallpaper ───────── */

  // Grab the current frame as a still, so the desktop matches even when the
  // live wallpaper is off.
  function stillFrame() {
    const vid = v$.preview;
    if (!vid.videoWidth) return null;
    const c = document.createElement('canvas');
    const scale = Math.min(1, 3840 / vid.videoWidth);
    c.width = Math.round(vid.videoWidth * scale);
    c.height = Math.round(vid.videoHeight * scale);
    c.getContext('2d').drawImage(vid, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }

  async function setVideoWallpaper() {
    const v = selectedVideo();
    if (!v) return upload();
    if (!bridge) return toast('Video wallpapers work in the desktop app', true);
    v$.setBtn.classList.add('busy');
    try {
      const still = stillFrame();
      if (still) await bridge.setWallpaper(still, { keepLive: true }).catch(() => {});
      vs.live = await bridge.liveStart({ kind: 'video', file: v.file, name: v.name, fit: vs.fit, speed: vs.speed });
      syncStatus();
      flash();
      toast('Your video is now your wallpaper ✦');
    } catch (err) {
      console.error(err);
      toast(liveError(err), true);
    } finally {
      v$.setBtn.classList.remove('busy');
    }
  }
  v$.setBtn.addEventListener('click', setVideoWallpaper);

  v$.stopBtn.addEventListener('click', async () => {
    if (!bridge) return;
    vs.live = await bridge.liveStop();
    syncStatus();
    toast('Live wallpaper stopped');
  });

  function syncStatus() {
    const { active, config } = vs.live;
    v$.status.classList.toggle('on', active);
    v$.liveDot.classList.toggle('on', active);
    v$.stopBtn.disabled = !active;
    v$.badge.classList.toggle('on', isLiveVideo(selectedVideo()));
    if (active && config) {
      v$.statusTitle.textContent = config.kind === 'video' ? 'Video wallpaper is on' : 'Live art wallpaper is on';
      v$.statusSub.textContent = config.name || '';
    } else {
      v$.statusTitle.textContent = 'Live wallpaper is off';
      v$.statusSub.textContent = 'Pick a video and set it as your wallpaper';
    }
    v$.login.checked = !!vs.live.startAtLogin;
    $$('.v-item').forEach((el, i) => vs.videos[i] && el.classList.toggle('live', isLiveVideo(vs.videos[i])));
  }

  if (bridge) bridge.onLiveStatus((s) => { vs.live = s; syncStatus(); });

  v$.login.addEventListener('change', async () => {
    if (!bridge) return;
    vs.live = await bridge.startAtLogin(v$.login.checked);
    syncStatus();
  });

  /* ───────── Playback settings ───────── */

  function pushLive() {
    if (bridge && isLiveVideo(selectedVideo())) bridge.liveUpdate({ fit: vs.fit, speed: vs.speed });
  }

  function setFit(fit) {
    vs.fit = fit;
    store.save('videoFit', fit);
    $$('button', v$.fit).forEach((b) => b.classList.toggle('active', b.dataset.fit === fit));
    movePill($('.seg-pill', v$.fit), $('button.active', v$.fit));
    v$.frame.classList.toggle('fit-contain', fit === 'contain');
    pushLive();
  }
  $$('button', v$.fit).forEach((b) => b.addEventListener('click', () => setFit(b.dataset.fit)));

  function paintSpeed() {
    const min = Number(v$.speed.min), max = Number(v$.speed.max);
    v$.speed.style.setProperty('--fill', ((vs.speed - min) / (max - min)) * 100 + '%');
    v$.speedOut.textContent = vs.speed + '×';
  }
  v$.speed.value = vs.speed;
  v$.speed.addEventListener('input', () => {
    vs.speed = Number(v$.speed.value);
    store.save('videoSpeed', vs.speed);
    v$.preview.playbackRate = vs.speed;
    paintSpeed();
    pushLive();
  });
  paintSpeed();

  /* ───────── View lifecycle ───────── */

  document.addEventListener('viewchange', (e) => {
    if (e.detail === 'video') {
      layout();
      setFit(vs.fit);
      showPreview();
    } else {
      v$.preview.pause();
    }
  });

  (async () => {
    if (bridge) vs.live = await bridge.liveStatus();
    await refresh();
    syncStatus();
  })();
})();
