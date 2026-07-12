const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const llm = require('./llmEngineV2');
const docs = require('./docs');
const modelDownload = require('./modelDownload');
const updateEngine = require('./updateEngine');

const isDev = process.env.ELECTRON_DEV === '1';

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 640,
    minHeight: 420,
    backgroundColor: '#000000',
    titleBarStyle: 'hidden',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Window controls
  ipcMain.on('window-close', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.close();
  });
  ipcMain.on('window-minimize', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.minimize();
  });
  ipcMain.on('window-toggle-maximize', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  // Chat: load model (downloads first if needed)
  ipcMain.handle('model:load', async () => {
    try {
      // Check if model needs downloading
      if (!modelDownload.isModelDownloaded()) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('model:status', 'downloading model...');
        }

        await modelDownload.downloadModel((progress) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('model:downloadProgress', progress);
          }
        });

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('model:status', 'download complete');
        }
      }

      await llm.ensureModel((status) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('model:status', status);
        }
      });
      const usage = llm.getContextUsage();
      const meta = llm.getModelMeta();
      if (!meta) return { ok: false, error: 'Model metadata is null' };
      return { ok: true, meta, usage };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Chat: set nickname (must be called before model:load)
  ipcMain.handle('user:setNickname', async (_event, name) => {
    try {
      llm.setNickname(name);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Chat: get model status
  ipcMain.handle('model:status', async () => {
    try {
      const meta = llm.getModelMeta();
      const usage = llm.getContextUsage();
      return {
        loaded: llm.isLoaded(),
        loading: llm.isLoading(),
        meta,
        usage,
      };
    } catch (err) {
      return {
        loaded: false,
        loading: false,
        meta: null,
        usage: { used: 0, total: 0 },
        error: err.message,
      };
    }
  });

  // Update: check for new releases
  ipcMain.handle('update:check', async () => {
    try {
      const result = await updateEngine.checkForUpdates();
      return result;
    } catch (err) {
      return { hasUpdate: false, error: err.message };
    }
  });

  // Update: open release page in browser
  ipcMain.handle('update:open', async (_event, url) => {
    try {
      updateEngine.openReleasePage(url);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Chat: send message with streaming
  ipcMain.handle('chat:send', async (event, userText, options) => {
    if (!userText || typeof userText !== 'string') {
      return { ok: false, error: 'Invalid input: message must be a non-empty string' };
    }

    try {
      const response = await llm.chat(userText, (chunk) => {
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send('chat:chunk', chunk);
        }
      }, options);
      const usage = llm.getContextUsage();
      if (typeof response !== 'string') {
        return { ok: false, error: 'Model returned non-string response' };
      }

      // Auto-compact check: if context is >=80% full, compact automatically
      let autoCompacted = false;
      let compactSummary = null;
      if (llm.shouldAutoCompact()) {
        try {
          if (event.sender && !event.sender.isDestroyed()) {
            event.sender.send('chat:status', 'auto-compacting context...');
          }
          const result = await llm.compact((chunk) => {
            if (event.sender && !event.sender.isDestroyed()) {
              event.sender.send('chat:compactChunk', chunk);
            }
          });
          autoCompacted = true;
          compactSummary = result.summary;
          if (event.sender && !event.sender.isDestroyed()) {
            event.sender.send('chat:status', 'context compacted');
          }
        } catch (err) {
          console.error('[llm] Auto-compact failed:', err.message);
          if (event.sender && !event.sender.isDestroyed()) {
            event.sender.send('chat:status', `auto-compact failed: ${err.message}`);
          }
        }
      }

      const finalUsage = autoCompacted ? llm.getContextUsage() : usage;
      return { ok: true, response, usage: finalUsage, autoCompacted, compactSummary };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Chat: stop generation
  ipcMain.handle('chat:stop', async () => {
    try {
      await llm.stop();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Chat: manual compact
  ipcMain.handle('chat:compact', async (event) => {
    try {
      if (!llm.canCompact()) {
        return { ok: false, error: 'Not enough context to compact' };
      }

      const result = await llm.compact((chunk) => {
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send('chat:compactChunk', chunk);
        }
      });

      if (!result || !result.summary) {
        return { ok: false, error: 'Compact returned no summary' };
      }

      return { ok: true, summary: result.summary, usage: result.usage };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Chat: check if can compact
  ipcMain.handle('chat:canCompact', async () => {
    try {
      return { ok: true, canCompact: llm.canCompact(), percent: llm.getContextPercent() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Docs: list installed
  ipcMain.handle('docs:installed', async () => {
    try {
      const docsets = docs.listInstalled();
      if (!Array.isArray(docsets)) return { ok: false, error: 'Invalid response from listInstalled' };
      return { ok: true, docsets };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Docs: list available
  ipcMain.handle('docs:available', async (_event, filter) => {
    if (filter !== null && filter !== undefined && typeof filter !== 'string') {
      return { ok: false, error: 'Invalid filter parameter' };
    }
    try {
      const result = await docs.listAvailable(filter || null);
      if (!Array.isArray(result)) return { ok: false, error: 'Invalid response from listAvailable' };
      return { ok: true, docsets: result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Docs: install
  ipcMain.handle('docs:install', async (event, slug) => {
    if (!slug || typeof slug !== 'string') {
      return { ok: false, error: 'Invalid slug' };
    }
    try {
      const meta = await docs.install(slug, (status) => {
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send('docs:progress', { slug, status });
        }
      });
      if (!meta || !meta.slug) return { ok: false, error: 'Install returned invalid metadata' };
      return { ok: true, meta };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Docs: uninstall
  ipcMain.handle('docs:uninstall', async (_event, slug) => {
    if (!slug || typeof slug !== 'string') {
      return { ok: false, error: 'Invalid slug' };
    }
    try {
      const removed = docs.uninstall(slug);
      return { ok: true, removed };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Docs: search entries
  ipcMain.handle('docs:search', async (_event, slug, query) => {
    if (!slug || typeof slug !== 'string') return { ok: false, error: 'Invalid slug' };
    if (!query || typeof query !== 'string') return { ok: false, error: 'Invalid query' };
    try {
      const entries = docs.searchEntries(slug, query);
      if (!Array.isArray(entries)) return { ok: false, error: 'Invalid response from searchEntries' };
      return { ok: true, entries };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Docs: get page
  ipcMain.handle('docs:page', async (_event, slug, entryPath) => {
    if (!slug || typeof slug !== 'string') return { ok: false, error: 'Invalid slug' };
    if (!entryPath || typeof entryPath !== 'string') return { ok: false, error: 'Invalid entry path' };
    try {
      const page = docs.getPage(slug, entryPath);
      if (!page) return { ok: false, error: `Page not found: ${entryPath}` };
      if (!page.html) return { ok: false, error: `Page has no content: ${entryPath}` };
      return { ok: true, html: page.html, key: page.key };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Docs: list entries (for browsing without search)
  ipcMain.handle('docs:entries', async (_event, slug, typeFilter) => {
    if (!slug || typeof slug !== 'string') return { ok: false, error: 'Invalid slug' };
    if (typeFilter !== null && typeFilter !== undefined && typeof typeFilter !== 'string') {
      return { ok: false, error: 'Invalid type filter' };
    }
    try {
      const result = docs.listEntries(slug, typeFilter || null);
      if (!result || !Array.isArray(result.entries) || !Array.isArray(result.types)) {
        return { ok: false, error: 'Invalid response from listEntries' };
      }
      return { ok: true, types: result.types, entries: result.entries };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
