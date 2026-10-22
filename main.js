const { app, BrowserWindow, ipcMain, shell, screen, dialog, Tray, Menu, nativeImage } = require('electron');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs/promises');
const path = require('path');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const startHidden = process.argv.includes('--hidden') || (isMac && app.getLoginItemSettings().wasOpenedAsHidden);

let win = null;
let wallWin = null;
let tray = null;
let cleanedUp = false;

const userFile = (...p) => path.join(app.getPath('userData'), ...p);
const VIDEO_DIR = () => userFile('videos');
const LIVE_FILE = () => userFile('live-wallpaper.json');
const ICON = path.join(__dirname, 'build', 'icon.png');

/* ───────── Main window ───────── */

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: '#050507',
    title: 'Lumen',
    icon: ICON,
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 18, y: 18 } }
      : { titleBarOverlay: { color: '#00000000', symbolColor: '#a1a1aa', height: 48 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => {
    mainReady = true;
    if (!splash) win.show();
  });
  win.on('closed', () => { win = null; });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function showMain() {
  if (splash) return;
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/* ───────── Splash ───────── */

const SPLASH_MS = 5600;
let splash = null;
let mainReady = false;

// A rounded, see-through loading card that plays while the main window
// loads behind it, then hands over.
function showSplash() {
  splash = new BrowserWindow({
    width: 600,
    height: 420,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    center: true,
    title: 'Lumen',
    icon: ICON,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  splash.loadFile(path.join(__dirname, 'src', 'splash.html'), { query: { ms: String(SPLASH_MS) } });
  splash.once('ready-to-show', () => splash && splash.show());
  splash.on('closed', () => { splash = null; });

  setTimeout(() => {
    if (win && mainReady) win.show();
    if (splash) splash.destroy();
  }, SPLASH_MS);
}

/* ───────── Helpers ───────── */

const decode = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout: 30000 }, (err, out, stderr) =>
      err ? reject(new Error((stderr || err.message).trim())) : resolve(out));
  });

const powershell = (script) =>
  run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')]);

const psString = (s) => `'${String(s).replace(/'/g, "''")}'`;

/* ───────── Static wallpaper ───────── */

const SPI_TYPE = `
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class LumenSpi {
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool SystemParametersInfo(int action, int param, string file, int flags);
}
'@
`;

async function applyWallpaper(file) {
  if (isMac) {
    const script = `tell application "System Events" to tell every desktop to set picture to POSIX file ${JSON.stringify(file)}`;
    return run('osascript', ['-e', script]);
  }
  if (isWin) {
    return powershell(`
$ErrorActionPreference = 'Stop'
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name WallpaperStyle -Value '10'
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name TileWallpaper -Value '0'
${SPI_TYPE}
if (-not [LumenSpi]::SystemParametersInfo(20, 0, ${psString(file)}, 3)) { throw 'SystemParametersInfo failed' }
`);
  }
  const uri = 'file://' + file;
  await run('gsettings', ['set', 'org.gnome.desktop.background', 'picture-uri', uri]);
  await run('gsettings', ['set', 'org.gnome.desktop.background', 'picture-uri-dark', uri]).catch(() => {});
}

// After a live wallpaper window goes away, Windows can leave its last frame
// painted on the desktop. Re-applying the current wallpaper repaints it.
function refreshWindowsDesktop() {
  if (!isWin) return Promise.resolve();
  return powershell(`
${SPI_TYPE}
$wp = (Get-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name WallPaper).WallPaper
[LumenSpi]::SystemParametersInfo(20, 0, $wp, 3) | Out-Null
`).catch(() => {});
}

async function saveWallpaperImage(dataUrl) {
  const dir = path.join(app.getPath('pictures'), 'Lumen');
  await fs.mkdir(dir, { recursive: true });
  // A fresh filename each time: macOS caches wallpapers by path.
  const file = path.join(dir, `lumen-${Date.now()}.png`);
  await fs.writeFile(file, decode(dataUrl));
  return file;
}

/* ───────── Live (video / animated) wallpaper ───────── */

let live = { active: false, config: null };

async function loadLive() {
  try {
    live = JSON.parse(await fs.readFile(LIVE_FILE(), 'utf8'));
  } catch {
    live = { active: false, config: null };
  }
}
const saveLive = () => fs.writeFile(LIVE_FILE(), JSON.stringify(live)).catch(() => {});

// Windows: put our window inside the desktop's WorkerW, which sits between
// the wallpaper and the desktop icons. This is the same trick live-wallpaper
// apps use. Windows 11 24H2 moved WorkerW under Progman, so both are handled.
async function attachToWindowsDesktop(bw, rect) {
  const handle = bw.getNativeWindowHandle();
  const hwnd = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
  const out = await powershell(`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class LumenDesk {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr FindWindow(string c, string w);
  [DllImport("user32.dll")] static extern IntPtr FindWindowEx(IntPtr p, IntPtr after, string c, string w);
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, IntPtr l, uint f, uint t, out IntPtr r);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr SetParent(IntPtr c, IntPtr p);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  public static long Attach(long child, int x, int y, int w, int h) {
    IntPtr progman = FindWindow("Progman", null);
    IntPtr res;
    SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(0x1), 0, 1000, out res);
    SendMessageTimeout(progman, 0x052C, IntPtr.Zero, IntPtr.Zero, 0, 1000, out res);
    IntPtr worker = IntPtr.Zero;
    EnumWindows((top, l) => {
      if (FindWindowEx(top, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero)
        worker = FindWindowEx(IntPtr.Zero, top, "WorkerW", null);
      return true;
    }, IntPtr.Zero);
    if (worker == IntPtr.Zero) worker = FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
    if (worker == IntPtr.Zero) return 0;
    SetParent(new IntPtr(child), worker);
    SetWindowPos(new IntPtr(child), IntPtr.Zero, x, y, w, h, 0x0010 | 0x0040);
    return worker.ToInt64();
  }
}
'@
[LumenDesk]::Attach(${hwnd}, ${rect.x}, ${rect.y}, ${rect.width}, ${rect.height})
`);
  if (!out || out.trim() === '0') throw new Error('Could not find the Windows desktop layer');
}

const withUrl = (c) => (c && c.kind === 'video' ? { ...c, url: pathToFileURL(c.file).href } : c);

async function startLive(config) {
  stopLiveWindow();
  if (!isMac && !isWin) throw new Error('Live wallpapers are available on macOS and Windows');
  const display = screen.getPrimaryDisplay();
  const b = display.bounds;

  wallWin = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    backgroundColor: '#000000',
    ...(isMac ? { type: 'desktop' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'wallpaper-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  wallWin.setIgnoreMouseEvents(true);
  if (isMac) wallWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  wallWin.on('closed', () => { wallWin = null; });

  await wallWin.loadFile(path.join(__dirname, 'src', 'wallpaper.html'));
  wallWin.webContents.send('wallpaper-config', withUrl(config));

  if (isWin) {
    // Physical pixels, relative to the top-left of the whole virtual desktop.
    const phys = (r) => screen.dipToScreenRect(null, r);
    const all = screen.getAllDisplays().map((d) => phys(d.bounds));
    const vx = Math.min(...all.map((r) => r.x));
    const vy = Math.min(...all.map((r) => r.y));
    const p = phys(b);
    try {
      await attachToWindowsDesktop(wallWin, { x: p.x - vx, y: p.y - vy, width: p.width, height: p.height });
    } catch (err) {
      // Never leave a full-screen window floating over the user's apps.
      stopLiveWindow();
      throw err;
    }
  }

  wallWin.showInactive();
  live = { active: true, config };
  saveLive();
  updateTray();
  broadcastLive();
}

function stopLiveWindow() {
  if (wallWin) {
    wallWin.destroy();
    wallWin = null;
  }
}

async function stopLive() {
  const had = !!wallWin;
  stopLiveWindow();
  live = { active: false, config: live.config };
  saveLive();
  updateTray();
  broadcastLive();
  if (had) await refreshWindowsDesktop();
}

const liveStatus = () => ({ active: !!wallWin, config: live.config, startAtLogin: app.getLoginItemSettings().openAtLogin });
const broadcastLive = () => { if (win) win.webContents.send('live-status', liveStatus()); };

/* ───────── Tray (keeps live wallpapers running after the window closes) ───────── */

function updateTray() {
  if (!wallWin) {
    if (tray) { tray.destroy(); tray = null; }
    return;
  }
  if (!tray) {
    const img = nativeImage.createFromPath(ICON).resize({ width: isMac ? 18 : 16, height: isMac ? 18 : 16 });
    tray = new Tray(img);
    tray.setToolTip('Lumen live wallpaper');
    tray.on('click', () => { if (!isMac) showMain(); });
  }
  const paused = !!live.paused;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Lumen', click: showMain },
    { type: 'separator' },
    {
      label: paused ? 'Resume live wallpaper' : 'Pause live wallpaper',
      click: () => {
        live.paused = !paused;
        if (wallWin) wallWin.webContents.send('wallpaper-paused', live.paused);
        updateTray();
      },
    },
    { label: 'Stop live wallpaper', click: () => stopLive() },
    { type: 'separator' },
    { label: 'Quit Lumen', click: () => app.quit() },
  ]));
}

/* ───────── Video library ───────── */

const VIDEO_EXT = ['.mp4', '.webm', '.mov', '.m4v', '.ogv'];

async function listVideos() {
  try {
    const names = await fs.readdir(VIDEO_DIR());
    const items = await Promise.all(names
      .filter((n) => VIDEO_EXT.includes(path.extname(n).toLowerCase()))
      .map(async (n) => {
        const file = path.join(VIDEO_DIR(), n);
        const st = await fs.stat(file);
        return { id: n, file, url: pathToFileURL(file).href, name: n.replace(/^\d+-/, ''), size: st.size, added: st.mtimeMs };
      }));
    return items.sort((a, b) => b.added - a.added);
  } catch {
    return [];
  }
}

async function importVideo(src) {
  if (!src || !VIDEO_EXT.includes(path.extname(src).toLowerCase())) throw new Error('Unsupported video type');
  await fs.mkdir(VIDEO_DIR(), { recursive: true });
  const id = `${Date.now()}-${path.basename(src).replace(/[^\w.\- ]+/g, '_')}`;
  const dest = path.join(VIDEO_DIR(), id);
  await fs.copyFile(src, dest);
  const all = await listVideos();
  return all.find((v) => v.id === id);
}

async function removeVideo(id) {
  const file = path.join(VIDEO_DIR(), path.basename(id));
  if (live.active && live.config && live.config.file === file) await stopLive();
  await fs.rm(file, { force: true });
  return listVideos();
}

/* ───────── IPC ───────── */

ipcMain.handle('screen-size', () => {
  const d = screen.getPrimaryDisplay();
  return { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
});

ipcMain.handle('save-image', async (_e, dataUrl, name) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('pictures'), name),
    filters: [{ name: 'PNG image', extensions: ['png'] }],
  });
  if (canceled || !filePath) return null;
  await fs.writeFile(filePath, decode(dataUrl));
  return filePath;
});

ipcMain.handle('set-wallpaper', async (_e, dataUrl, { keepLive = false } = {}) => {
  const file = await saveWallpaperImage(dataUrl);
  if (!keepLive && wallWin) await stopLive();
  await applyWallpaper(file);
  return file;
});

ipcMain.handle('pick-video', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Choose a video',
    properties: ['openFile'],
    filters: [{ name: 'Videos', extensions: VIDEO_EXT.map((e) => e.slice(1)) }],
  });
  if (canceled || !filePaths[0]) return null;
  return importVideo(filePaths[0]);
});
ipcMain.handle('import-video', (_e, src) => importVideo(src));
ipcMain.handle('list-videos', () => listVideos());
ipcMain.handle('remove-video', (_e, id) => removeVideo(id));

ipcMain.handle('live-start', (_e, config) => startLive(config).then(liveStatus));
ipcMain.handle('live-stop', () => stopLive().then(liveStatus));
ipcMain.handle('live-status', () => liveStatus());
ipcMain.handle('live-update', (_e, patch) => {
  if (!live.config) return liveStatus();
  live.config = { ...live.config, ...patch };
  saveLive();
  if (wallWin) wallWin.webContents.send('wallpaper-config', withUrl(live.config));
  return liveStatus();
});
ipcMain.handle('start-at-login', (_e, on) => {
  app.setLoginItemSettings({ openAtLogin: !!on, openAsHidden: true, args: ['--hidden'] });
  return liveStatus();
});

ipcMain.handle('reveal', (_e, file) => shell.showItemInFolder(file));

/* ───────── Lifecycle ───────── */

app.setAppUserModelId('com.vishantuwuw.lumen');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showMain);

  app.whenReady().then(async () => {
    await loadLive();
    if (live.active && live.config) {
      startLive(live.config).catch(() => { live.active = false; saveLive(); });
    }
    if (!startHidden || !live.active) {
      showSplash();
      createWindow();
    }
    app.on('activate', showMain);
  });
}

// Take the live wallpaper down cleanly on quit, but remember it so it comes
// back the next time Lumen starts (e.g. at login).
app.on('before-quit', (e) => {
  if (!wallWin || cleanedUp) return;
  e.preventDefault();
  cleanedUp = true;
  stopLiveWindow();
  refreshWindowsDesktop().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  // The live wallpaper window keeps the app alive; otherwise quit (except on macOS).
  if (!isMac && !wallWin) app.quit();
});
