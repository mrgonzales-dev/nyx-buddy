const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const CATALOG_URL = 'https://devdocs.io/docs.json';
const CDN_BASE = 'https://documents.devdocs.io';

// ---- Path helpers ----

function getDocsDir() {
  if (!app) throw new Error('Electron app not available');
  const dir = path.join(app.getPath('userData'), 'docs');
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    throw new Error(`Failed to create docs directory: ${err.message}`);
  }
  return dir;
}

function docsetDir(slug) {
  if (!slug || typeof slug !== 'string') throw new Error('Invalid slug');
  return path.join(getDocsDir(), slug);
}

// ---- Catalog ----

async function listAvailable(filter) {
  let res;
  try {
    res = await fetch(CATALOG_URL, {
      headers: { 'User-Agent': 'nyx-dev/0.1.0' },
    });
  } catch (err) {
    throw new Error(`Network error fetching catalog: ${err.message}`);
  }
  if (!res.ok) throw new Error(`Failed to fetch catalog: HTTP ${res.status}`);

  let catalog;
  try {
    catalog = await res.json();
  } catch (err) {
    throw new Error(`Failed to parse catalog: ${err.message}`);
  }
  if (!Array.isArray(catalog)) throw new Error('Catalog is not an array');

  let filtered = catalog;
  if (filter) {
    const q = filter.toLowerCase();
    filtered = catalog.filter(
      (d) =>
        (d.slug || '').toLowerCase().includes(q) ||
        (d.name || '').toLowerCase().includes(q) ||
        (d.version || '').toLowerCase().includes(q)
    );
  }

  return filtered.map((d) => ({
    slug: d.slug || '',
    name: d.name || d.slug || 'unknown',
    version: d.version || '',
    release: d.release || '',
  }));
}

// ---- Installed docsets ----

function listInstalled() {
  let dir;
  try {
    dir = getDocsDir();
  } catch (err) {
    return []; // can't list if we can't access the directory
  }

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Failed to read docs directory: ${err.message}`);
  }

  const installed = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(dir, entry.name, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;

    try {
      const raw = fs.readFileSync(metaPath, 'utf-8');
      const meta = JSON.parse(raw);
      if (!meta.slug || typeof meta.slug !== 'string') {
        meta.slug = entry.name;
      }
      installed.push(meta);
    } catch (err) {
      // skip corrupted meta, but don't crash the whole list
      console.error(`[docs] Skipping corrupted meta for ${entry.name}: ${err.message}`);
    }
  }

  return installed;
}

function isInstalled(slug) {
  if (!slug) return false;
  try {
    return fs.existsSync(path.join(docsetDir(slug), 'meta.json'));
  } catch (err) {
    return false;
  }
}

// ---- Install / Uninstall ----

async function install(slug, onProgress) {
  if (!slug || typeof slug !== 'string') throw new Error('Invalid slug');
  const dir = docsetDir(slug);

  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    throw new Error(`Failed to create docset directory: ${err.message}`);
  }

  // Fetch catalog entry for metadata
  if (onProgress) onProgress('fetching catalog...');
  let res;
  try {
    res = await fetch(CATALOG_URL);
  } catch (err) {
    throw new Error(`Network error fetching catalog: ${err.message}`);
  }
  if (!res.ok) throw new Error(`Failed to fetch catalog: HTTP ${res.status}`);

  let catalog;
  try {
    catalog = await res.json();
  } catch (err) {
    throw new Error(`Failed to parse catalog: ${err.message}`);
  }

  const entry = catalog.find((d) => d.slug === slug);
  if (!entry) throw new Error(`Docset "${slug}" not found in catalog`);

  // Download index.json
  if (onProgress) onProgress('downloading index...');
  let indexRes;
  try {
    indexRes = await fetch(`${CDN_BASE}/${slug}/index.json`, {
      headers: { 'User-Agent': 'nyx-dev/0.1.0' },
    });
  } catch (err) {
    throw new Error(`Network error downloading index: ${err.message}`);
  }
  if (!indexRes.ok) throw new Error(`Failed to download index: HTTP ${indexRes.status}`);

  let indexData;
  try {
    indexData = await indexRes.json();
  } catch (err) {
    throw new Error(`Failed to parse index: ${err.message}`);
  }
  if (!indexData || !Array.isArray(indexData.entries)) {
    throw new Error('Index data is invalid: missing entries array');
  }

  try {
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(indexData));
  } catch (err) {
    throw new Error(`Failed to write index: ${err.message}`);
  }

  // Download db.json
  if (onProgress) onProgress('downloading pages...');
  let dbRes;
  try {
    dbRes = await fetch(`${CDN_BASE}/${slug}/db.json`, {
      headers: { 'User-Agent': 'nyx-dev/0.1.0' },
    });
  } catch (err) {
    throw new Error(`Network error downloading pages: ${err.message}`);
  }
  if (!dbRes.ok) throw new Error(`Failed to download pages: HTTP ${dbRes.status}`);

  let dbData;
  try {
    dbData = await dbRes.json();
  } catch (err) {
    throw new Error(`Failed to parse pages: ${err.message}`);
  }
  if (!dbData || typeof dbData !== 'object') {
    throw new Error('Page data is invalid: not an object');
  }

  try {
    fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(dbData));
  } catch (err) {
    throw new Error(`Failed to write pages: ${err.message}`);
  }

  // Write meta
  const meta = {
    slug: entry.slug,
    name: entry.name || entry.slug,
    version: entry.version || '',
    release: entry.release || '',
    installed_at: Date.now(),
    entry_count: indexData.entries.length,
    db_size: Buffer.byteLength(JSON.stringify(dbData)),
  };
  try {
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  } catch (err) {
    throw new Error(`Failed to write meta: ${err.message}`);
  }

  // Clear cache so next load picks up fresh data
  indexCache.delete(slug);
  dbCache.delete(slug);

  if (onProgress) onProgress('done');
  return meta;
}

function uninstall(slug) {
  if (!slug) throw new Error('Invalid slug');
  const dir = docsetDir(slug);

  if (!fs.existsSync(dir)) return false;

  try {
    fs.rmSync(dir, { recursive: true });
  } catch (err) {
    throw new Error(`Failed to remove docset: ${err.message}`);
  }

  indexCache.delete(slug);
  dbCache.delete(slug);
  return true;
}

// ---- Search ----

const indexCache = new Map();
const dbCache = new Map();

function loadIndex(slug) {
  if (!slug) return null;
  if (indexCache.has(slug)) return indexCache.get(slug);

  const indexPath = path.join(docsetDir(slug), 'index.json');
  if (!fs.existsSync(indexPath)) return null;

  let raw;
  try {
    raw = fs.readFileSync(indexPath, 'utf-8');
  } catch (err) {
    console.error(`[docs] Failed to read index for ${slug}: ${err.message}`);
    return null;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error(`[docs] Failed to parse index for ${slug}: ${err.message}`);
    return null;
  }

  if (!data || !Array.isArray(data.entries)) {
    console.error(`[docs] Index for ${slug} is invalid: missing entries`);
    return null;
  }

  indexCache.set(slug, data);
  return data;
}

function loadDb(slug) {
  if (!slug) return null;
  if (dbCache.has(slug)) return dbCache.get(slug);

  const dbPath = path.join(docsetDir(slug), 'db.json');
  if (!fs.existsSync(dbPath)) return null;

  let raw;
  try {
    raw = fs.readFileSync(dbPath, 'utf-8');
  } catch (err) {
    console.error(`[docs] Failed to read db for ${slug}: ${err.message}`);
    return null;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error(`[docs] Failed to parse db for ${slug}: ${err.message}`);
    return null;
  }

  if (!data || typeof data !== 'object') {
    console.error(`[docs] Db for ${slug} is invalid: not an object`);
    return null;
  }

  dbCache.set(slug, data);
  return data;
}

function searchEntries(slug, query, limit = 50) {
  if (!slug || !query) return [];
  if (typeof query !== 'string') return [];

  const index = loadIndex(slug);
  if (!index) return [];

  const q = query.toLowerCase();
  const scored = [];

  for (const entry of index.entries) {
    if (!entry || typeof entry !== 'object') continue;
    const name = (entry.name || '').toLowerCase();
    if (!name) continue;

    let score = 0;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) {
      const wordStart = name.indexOf(q);
      if (wordStart === 0 || name[wordStart - 1] === ' ' || name[wordStart - 1] === '_' || name[wordStart - 1] === '.') {
        score = 60;
      } else {
        score = 40;
      }
    }

    if (score > 0) {
      scored.push({ name: entry.name || '', path: entry.path || '', type: entry.type || '', score });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.name.length - b.name.length;
  });

  return scored.slice(0, limit);
}

// ---- Page fetching ----

function pageKey(indexPath) {
  if (!indexPath || typeof indexPath !== 'string') return '';
  return indexPath.split('#')[0];
}

function getPage(slug, entryPath) {
  if (!slug || !entryPath) return null;

  const db = loadDb(slug);
  if (!db) return null;

  const key = pageKey(entryPath);
  if (!key) return null;

  const html = db[key];
  if (!html) return null;

  return { html, key };
}

// List all entries grouped by type, for browsing without searching
function listEntries(slug, typeFilter) {
  if (!slug) return { types: [], entries: [] };

  const index = loadIndex(slug);
  if (!index || !Array.isArray(index.entries)) return { types: [], entries: [] };

  // Build type counts
  const typeMap = new Map();
  for (const entry of index.entries) {
    if (!entry || typeof entry !== 'object') continue;
    const t = entry.type || 'Other';
    if (!typeMap.has(t)) typeMap.set(t, 0);
    typeMap.set(t, typeMap.get(t) + 1);
  }
  const types = Array.from(typeMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Filter entries by type if requested
  let entries = index.entries;
  if (typeFilter && typeFilter !== 'All') {
    entries = entries.filter((e) => (e.type || 'Other') === typeFilter);
  }

  // Map to clean objects, limit to 500 for performance
  const cleanEntries = entries
    .filter((e) => e && typeof e === 'object' && e.name && e.path)
    .map((e) => ({
      name: e.name,
      path: e.path,
      type: e.type || '',
    }))
    .slice(0, 500);

  return { types, entries: cleanEntries };
}

module.exports = {
  listAvailable,
  listInstalled,
  isInstalled,
  install,
  uninstall,
  searchEntries,
  getPage,
  listEntries,
  loadIndex,
  loadDb,
};
