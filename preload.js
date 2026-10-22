const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nocturne', {
  platform: process.platform,
  setProgress: (value) => ipcRenderer.send('progress', value),
  focusWindow: () => ipcRenderer.send('focus-window'),
});
