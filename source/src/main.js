const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const SETTINGS_PATH = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = {
  coinglassKey: '',
  bounds: null,
  opacity: 1.0,
  refreshMs: 5000
};

function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH(), 'utf8')) }; }
  catch { return { ...DEFAULTS }; }
}
function saveSettings(s) {
  try { fs.writeFileSync(SETTINGS_PATH(), JSON.stringify(s, null, 2)); } catch {}
}

let win;
let settings;

function createWindow() {
  settings = loadSettings();
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const W = 760, H = 520;
  const bounds = settings.bounds || { x: sw - W - 20, y: sh - H - 20, width: W, height: H };

  win = new BrowserWindow({
    ...bounds,
    minWidth: 420,
    minHeight: 320,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    backgroundColor: '#0b0f14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  // Highest always-on-top level so it floats over fullscreen-ish apps on both OSes
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setOpacity(settings.opacity);
  win.loadFile(path.join(__dirname, 'index.html'));

  const persistBounds = () => { settings.bounds = win.getBounds(); saveSettings(settings); };
  win.on('moved', persistBounds);
  win.on('resized', persistBounds);
  win.on('closed', () => { win = null; });
}

// ---- IPC: network proxy so renderer never hits CORS ----
ipcMain.handle('fetch-json', async (_e, url, headers = {}) => {
  const res = await fetch(url, { headers: { accept: 'application/json', ...headers } });
  if (!res.ok) {
    let detail = '';
    try { const b = await res.json(); detail = b.msg || b.message || ''; } catch {}
    throw new Error(`${res.status}${detail ? ' – ' + detail : ' ' + res.statusText}`);
  }
  return res.json();
});

ipcMain.handle('get-settings', () => settings);
ipcMain.handle('set-settings', (_e, patch) => {
  settings = { ...settings, ...patch };
  saveSettings(settings);
  if (win && patch.opacity != null) win.setOpacity(patch.opacity);
  return settings;
});
ipcMain.on('window-close', () => win && win.close());
ipcMain.on('window-minimize', () => win && win.minimize());
ipcMain.on('toggle-pin', (_e, pinned) => {
  if (!win) return;
  win.setAlwaysOnTop(pinned, 'screen-saver');
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (!win) createWindow(); });
