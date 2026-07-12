const { contextBridge, ipcRenderer } = require('electron');

function safeInvoke(channel, ...args) {
  try {
    return ipcRenderer.invoke(channel, ...args);
  } catch (err) {
    console.error(`[preload] IPC invoke failed for "${channel}": ${err.message}`);
    return Promise.resolve({ ok: false, error: err.message });
  }
}

contextBridge.exposeInMainWorld('terminal', {
  // Window controls
  close: () => {
    try { ipcRenderer.send('window-close'); } catch (err) {
      console.error('[preload] close failed:', err.message);
    }
  },
  minimize: () => {
    try { ipcRenderer.send('window-minimize'); } catch (err) {
      console.error('[preload] minimize failed:', err.message);
    }
  },
  toggleMaximize: () => {
    try { ipcRenderer.send('window-toggle-maximize'); } catch (err) {
      console.error('[preload] toggleMaximize failed:', err.message);
    }
  },

  // Model
  loadModel: () => safeInvoke('model:load'),
  getModelStatus: () => safeInvoke('model:status'),
  setNickname: (name) => safeInvoke('user:setNickname', name),

  // Update
  checkForUpdates: () => safeInvoke('update:check'),
  openReleasePage: (url) => safeInvoke('update:open', url),
  onModelStatus: (cb) => {
    if (typeof cb !== 'function') {
      console.error('[preload] onModelStatus: callback is not a function');
      return () => {};
    }
    const handler = (_event, status) => {
      try { cb(status); } catch (err) {
        console.error('[preload] onModelStatus callback error:', err.message);
      }
    };
    ipcRenderer.on('model:status', handler);
    return () => {
      try { ipcRenderer.removeListener('model:status', handler); } catch (err) {
        console.error('[preload] onModelStatus cleanup error:', err.message);
      }
    };
  },
  onDownloadProgress: (cb) => {
    if (typeof cb !== 'function') {
      console.error('[preload] onDownloadProgress: callback is not a function');
      return () => {};
    }
    const handler = (_event, progress) => {
      try { cb(progress); } catch (err) {
        console.error('[preload] onDownloadProgress callback error:', err.message);
      }
    };
    ipcRenderer.on('model:downloadProgress', handler);
    return () => {
      try { ipcRenderer.removeListener('model:downloadProgress', handler); } catch (err) {
        console.error('[preload] onDownloadProgress cleanup error:', err.message);
      }
    };
  },

  // Chat
  send: (text, options) => {
    if (!text || typeof text !== 'string') {
      return Promise.resolve({ ok: false, error: 'Invalid input: text must be a non-empty string' });
    }
    return safeInvoke('chat:send', text, options);
  },
  stop: () => safeInvoke('chat:stop'),
  clear: () => safeInvoke('chat:clear'),
  compact: () => safeInvoke('chat:compact'),
  canCompact: () => safeInvoke('chat:canCompact'),
  onChunk: (cb) => {
    if (typeof cb !== 'function') {
      console.error('[preload] onChunk: callback is not a function');
      return () => {};
    }
    const handler = (_event, chunk) => {
      try { cb(chunk); } catch (err) {
        console.error('[preload] onChunk callback error:', err.message);
      }
    };
    ipcRenderer.on('chat:chunk', handler);
    return () => {
      try { ipcRenderer.removeListener('chat:chunk', handler); } catch (err) {
        console.error('[preload] onChunk cleanup error:', err.message);
      }
    };
  },
  onCompactChunk: (cb) => {
    if (typeof cb !== 'function') {
      console.error('[preload] onCompactChunk: callback is not a function');
      return () => {};
    }
    const handler = (_event, chunk) => {
      try { cb(chunk); } catch (err) {
        console.error('[preload] onCompactChunk callback error:', err.message);
      }
    };
    ipcRenderer.on('chat:compactChunk', handler);
    return () => {
      try { ipcRenderer.removeListener('chat:compactChunk', handler); } catch (err) {
        console.error('[preload] onCompactChunk cleanup error:', err.message);
      }
    };
  },
  onStatus: (cb) => {
    if (typeof cb !== 'function') {
      console.error('[preload] onStatus: callback is not a function');
      return () => {};
    }
    const handler = (_event, status) => {
      try { cb(status); } catch (err) {
        console.error('[preload] onStatus callback error:', err.message);
      }
    };
    ipcRenderer.on('chat:status', handler);
    return () => {
      try { ipcRenderer.removeListener('chat:status', handler); } catch (err) {
        console.error('[preload] onStatus cleanup error:', err.message);
      }
    };
  },

  // Docs
  docsInstalled: () => safeInvoke('docs:installed'),
  docsAvailable: (filter) => {
    if (filter !== null && filter !== undefined && typeof filter !== 'string') {
      return Promise.resolve({ ok: false, error: 'Invalid filter: must be string or null' });
    }
    return safeInvoke('docs:available', filter);
  },
  docsInstall: (slug) => {
    if (!slug || typeof slug !== 'string') {
      return Promise.resolve({ ok: false, error: 'Invalid slug: must be a non-empty string' });
    }
    return safeInvoke('docs:install', slug);
  },
  docsUninstall: (slug) => {
    if (!slug || typeof slug !== 'string') {
      return Promise.resolve({ ok: false, error: 'Invalid slug: must be a non-empty string' });
    }
    return safeInvoke('docs:uninstall', slug);
  },
  docsSearch: (slug, query) => {
    if (!slug || typeof slug !== 'string') {
      return Promise.resolve({ ok: false, error: 'Invalid slug' });
    }
    if (!query || typeof query !== 'string') {
      return Promise.resolve({ ok: false, error: 'Invalid query' });
    }
    return safeInvoke('docs:search', slug, query);
  },
  docsPage: (slug, entryPath) => {
    if (!slug || typeof slug !== 'string') {
      return Promise.resolve({ ok: false, error: 'Invalid slug' });
    }
    if (!entryPath || typeof entryPath !== 'string') {
      return Promise.resolve({ ok: false, error: 'Invalid entry path' });
    }
    return safeInvoke('docs:page', slug, entryPath);
  },
  docsEntries: (slug, typeFilter) => {
    if (!slug || typeof slug !== 'string') {
      return Promise.resolve({ ok: false, error: 'Invalid slug' });
    }
    if (typeFilter !== null && typeFilter !== undefined && typeof typeFilter !== 'string') {
      return Promise.resolve({ ok: false, error: 'Invalid type filter' });
    }
    return safeInvoke('docs:entries', slug, typeFilter || null);
  },
  onDocsProgress: (cb) => {
    if (typeof cb !== 'function') {
      console.error('[preload] onDocsProgress: callback is not a function');
      return () => {};
    }
    const handler = (_event, data) => {
      try { cb(data); } catch (err) {
        console.error('[preload] onDocsProgress callback error:', err.message);
      }
    };
    ipcRenderer.on('docs:progress', handler);
    return () => {
      try { ipcRenderer.removeListener('docs:progress', handler); } catch (err) {
        console.error('[preload] onDocsProgress cleanup error:', err.message);
      }
    };
  },
});
