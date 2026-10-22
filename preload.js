const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('lumen', {
  platform: process.platform,
  screenSize: () => ipcRenderer.invoke('screen-size'),
  saveImage: (dataUrl, name) => ipcRenderer.invoke('save-image', dataUrl, name),
  setWallpaper: (dataUrl, opts) => ipcRenderer.invoke('set-wallpaper', dataUrl, opts),
  reveal: (file) => ipcRenderer.invoke('reveal', file),

  pathForFile: (file) => webUtils.getPathForFile(file),
  pickVideo: () => ipcRenderer.invoke('pick-video'),
  importVideo: (src) => ipcRenderer.invoke('import-video', src),
  listVideos: () => ipcRenderer.invoke('list-videos'),
  removeVideo: (id) => ipcRenderer.invoke('remove-video', id),

  liveStart: (config) => ipcRenderer.invoke('live-start', config),
  liveStop: () => ipcRenderer.invoke('live-stop'),
  liveStatus: () => ipcRenderer.invoke('live-status'),
  liveUpdate: (patch) => ipcRenderer.invoke('live-update', patch),
  startAtLogin: (on) => ipcRenderer.invoke('start-at-login', on),
  onLiveStatus: (fn) => ipcRenderer.on('live-status', (_e, s) => fn(s)),
});
