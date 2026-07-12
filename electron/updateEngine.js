/**
 * updateEngine.js — Checks GitHub Releases for new versions.
 * Option 1: notify-only. Opens the release page in the browser.
 */

const { app, shell } = require('electron');
const https = require('https');
const path = require('path');
const fs = require('fs');

// Repo info — must match the GitHub repo where releases are published
const GITHUB_OWNER = 'mrgonzales-dev';
const GITHUB_REPO = 'nyx-buddy';
const API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

// Read current version from package.json
function getCurrentVersion() {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.version;
  } catch (err) {
    console.error('[update] Failed to read package.json:', err.message);
    return '0.0.0';
  }
}

// Compare semantic versions (returns true if remote > local)
function isNewerVersion(remote, local) {
  const r = remote.replace(/^v/, '').split('.').map(Number);
  const l = local.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const rv = r[i] || 0;
    const lv = l[i] || 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

// Fetch JSON from GitHub API
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'nyx-buddy-updater',
        'Accept': 'application/vnd.github+json',
      },
      timeout: 10000,
    };
    https.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        fetchJSON(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`GitHub API returned ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error('Failed to parse GitHub API response'));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Checks for updates. Returns:
 *   { hasUpdate: true, version, url, releaseNotes } if a newer version exists
 *   { hasUpdate: false } if up-to-date or check failed
 */
async function checkForUpdates() {
  try {
    const current = getCurrentVersion();
    const release = await fetchJSON(API_URL);

    if (!release || !release.tag_name) {
      return { hasUpdate: false };
    }

    const remoteVersion = release.tag_name; // e.g. "v0.1.1"
    const releaseUrl = release.html_url;    // GitHub release page
    const releaseNotes = release.body || ''; // release notes markdown

    if (isNewerVersion(remoteVersion, current)) {
      return {
        hasUpdate: true,
        version: remoteVersion,
        url: releaseUrl,
        releaseNotes: releaseNotes.trim(),
      };
    }

    return { hasUpdate: false };
  } catch (err) {
    console.error('[update] Check failed:', err.message);
    return { hasUpdate: false };
  }
}

/**
 * Opens the release page in the user's default browser.
 */
function openReleasePage(url) {
  if (!url) return;
  shell.openExternal(url);
}

module.exports = {
  checkForUpdates,
  openReleasePage,
  getCurrentVersion,
};
