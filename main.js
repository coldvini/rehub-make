const { app, BrowserWindow, ipcMain, shell, screen, dialog } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs/promises');
const path = require('path');

const isMac = process.platform === 'darwin';
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: '#050507',
    title: 'Lumen',
    icon: path.join(__dirname, 'build', 'icon.png'),
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
  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

const decode = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true }, (err, _out, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve()));
  });

async function applyWallpaper(file) {
  if (process.platform === 'darwin') {
    const script = `tell application "System Events" to tell every desktop to set picture to POSIX file ${JSON.stringify(file)}`;
    return run('osascript', ['-e', script]);
  }
  if (process.platform === 'win32') {
    const ps = `
$ErrorActionPreference = 'Stop'
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name WallpaperStyle -Value '10'
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name TileWallpaper -Value '0'
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class LumenWallpaper {
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool SystemParametersInfo(int action, int param, string file, int flags);
}
'@
if (-not [LumenWallpaper]::SystemParametersInfo(20, 0, '${file.replace(/'/g, "''")}', 3)) { throw 'SystemParametersInfo failed' }
`;
    const encoded = Buffer.from(ps, 'utf16le').toString('base64');
    return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]);
  }
  const uri = 'file://' + file;
  await run('gsettings', ['set', 'org.gnome.desktop.background', 'picture-uri', uri]);
  await run('gsettings', ['set', 'org.gnome.desktop.background', 'picture-uri-dark', uri]).catch(() => {});
}

ipcMain.handle('screen-size', () => {
  const d = screen.getPrimaryDisplay();
  return {
    width: Math.round(d.size.width * d.scaleFactor),
    height: Math.round(d.size.height * d.scaleFactor),
  };
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

ipcMain.handle('set-wallpaper', async (_e, dataUrl) => {
  const dir = path.join(app.getPath('pictures'), 'Lumen');
  await fs.mkdir(dir, { recursive: true });
  // A fresh filename each time: macOS caches wallpapers by path.
  const file = path.join(dir, `lumen-${Date.now()}.png`);
  await fs.writeFile(file, decode(dataUrl));
  await applyWallpaper(file);
  return file;
});

ipcMain.handle('reveal', (_e, file) => shell.showItemInFolder(file));

app.setAppUserModelId('com.vishantuwuw.lumen');

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
