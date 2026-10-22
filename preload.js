const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lumen', {
  platform: process.platform,
  screenSize: () => ipcRenderer.invoke('screen-size'),
  saveImage: (dataUrl, name) => ipcRenderer.invoke('save-image', dataUrl, name),
  setWallpaper: (dataUrl) => ipcRenderer.invoke('set-wallpaper', dataUrl),
  reveal: (file) => ipcRenderer.invoke('reveal', file),
});
