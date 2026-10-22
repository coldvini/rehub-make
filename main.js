const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

const isMac = process.platform === 'darwin';
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 920,
    minHeight: 640,
    show: false,
    backgroundColor: '#050507',
    title: 'Nocturne',
    icon: path.join(__dirname, 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 18, y: 18 } }
      : { titleBarOverlay: { color: '#00000000', symbolColor: '#a1a1aa', height: 48 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Open external links in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

ipcMain.on('progress', (_e, value) => {
  if (!win) return;
  win.setProgressBar(value < 0 ? -1 : value);
});

ipcMain.on('focus-window', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.setAppUserModelId('com.vishantuwuw.nocturne');

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
