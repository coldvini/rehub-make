const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wallpaper', {
  onConfig: (fn) => ipcRenderer.on('wallpaper-config', (_e, config) => fn(config)),
  onPaused: (fn) => ipcRenderer.on('wallpaper-paused', (_e, paused) => fn(paused)),
});
