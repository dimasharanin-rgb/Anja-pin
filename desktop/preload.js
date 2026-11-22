const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', { saveUrl: (u) => ipcRenderer.invoke('save-url', u) });
