'use strict';
// Тонкая оболочка: открывает веб-интерфейс сервера в отдельном окне.
// Адрес сервера берётся из config.json (вшивается при сборке) либо вводится один раз при первом запуске.
const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const userCfg = () => path.join(app.getPath('userData'), 'config.json');
function readUrl() {
  for (const f of [userCfg(), path.join(__dirname, 'config.json')]) {
    try { const u = JSON.parse(fs.readFileSync(f, 'utf8')).serverUrl; if (u) return u.replace(/\/+$/, ''); } catch {}
  }
  return '';
}

let win;
function open() {
  win = new BrowserWindow({
    width: 520, height: 820, minWidth: 380, minHeight: 560,
    title: 'Поощрения и наказания', backgroundColor: '#fbf6f1', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  const url = readUrl();
  if (!url) return win.loadFile(path.join(__dirname, 'setup.html'));
  win.loadURL(url + '/');
  win.webContents.on('did-fail-load', (_e, code, desc, _u, isMain) => {
    if (!isMain || code === -3) return;
    win.loadFile(path.join(__dirname, 'setup.html'), { query: { error: desc, url } });
  });
  win.webContents.setWindowOpenHandler(({ url: u }) => { shell.openExternal(u); return { action: 'deny' }; });
}

ipcMain.handle('save-url', (_e, u) => {
  u = String(u || '').trim();
  if (!/^https?:\/\//i.test(u)) throw new Error('Адрес должен начинаться с https://');
  fs.writeFileSync(userCfg(), JSON.stringify({ serverUrl: u.replace(/\/+$/, '') }));
  app.relaunch(); app.exit(0);
});

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(open);
  app.on('window-all-closed', () => app.quit());
}
