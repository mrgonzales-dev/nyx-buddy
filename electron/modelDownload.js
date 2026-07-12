/**
 * modelDownload.js — Downloads the GGUF model on first run
 *
 * Flow:
 *   1. Check if model exists in user data dir
 *   2. If not, download from manifest URL
 *   3. Stream to disk with progress events
 *   4. Verify file size
 *   5. Return the local path
 */

const path = require('path');
const fs = require('fs');
const https = require('https');
const { app } = require('electron');

// Read the manifest bundled with the app
const MANIFEST_PATH = path.join(__dirname, '..', 'resources', 'model-manifest.json');

function getManifest() {
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to read model manifest: ${err.message}`);
  }
}

// Where the model should live on this user's machine
function getModelDir() {
  // In dev mode, use the local resources folder
  if (process.env.ELECTRON_DEV === '1') {
    return path.join(__dirname, '..', 'resources', 'models');
  }
  return path.join(app.getPath('userData'), 'models');
}

function getModelPath() {
  const manifest = getManifest();
  return path.join(getModelDir(), manifest.filename);
}

// Check if the model is already downloaded
function isModelDownloaded() {
  const modelPath = getModelPath();
  if (!fs.existsSync(modelPath)) return false;
  const stats = fs.statSync(modelPath);
  return stats.size > 0;
}

// Download the model with progress callbacks
function downloadModel(onProgress) {
  return new Promise((resolve, reject) => {
    const manifest = getManifest();
    const modelDir = getModelDir();
    const modelPath = getModelPath();

    // Create the models directory if it doesn't exist
    try {
      if (!fs.existsSync(modelDir)) {
        fs.mkdirSync(modelDir, { recursive: true });
      }
    } catch (err) {
      reject(new Error(`Failed to create model directory: ${err.message}`));
      return;
    }

    const url = manifest.url;
    if (!url) {
      reject(new Error('Manifest has no download URL'));
      return;
    }

    // Follow redirects (GitHub releases redirect to CDN)
    function fetch(targetUrl, redirectCount = 0) {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'));
        return;
      }

      https.get(targetUrl, (response) => {
        // Handle redirect
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          fetch(response.headers.location, redirectCount + 1);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${response.statusCode}`));
          return;
        }

        const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;
        let lastProgress = 0;

        // Write to a temp file first, then rename
        const tempPath = modelPath + '.tmp';
        // Clean up any leftover .tmp from a previous failed download
        try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
        const fileStream = fs.createWriteStream(tempPath);

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (onProgress && totalBytes > 0) {
            const percent = Math.round((downloadedBytes / totalBytes) * 100);
            // Throttle progress updates to every 2%
            if (percent >= lastProgress + 2 || percent === 100) {
              lastProgress = percent;
              onProgress({
                percent,
                downloadedBytes,
                totalBytes,
              });
            }
          }
        });

        fileStream.on('error', (err) => {
          try { fs.unlinkSync(tempPath); } catch (_) {}
          reject(new Error(`Failed to write model file: ${err.message}`));
        });

        fileStream.on('finish', () => {
          try {
            // Rename temp file to final name
            if (fs.existsSync(modelPath)) {
              fs.unlinkSync(modelPath);
            }
            fs.renameSync(tempPath, modelPath);
            resolve(modelPath);
          } catch (err) {
            try { fs.unlinkSync(tempPath); } catch (_) {}
            reject(new Error(`Failed to finalize download: ${err.message}`));
          }
        });

        response.pipe(fileStream);
      }).on('error', (err) => {
        reject(new Error(`Download request failed: ${err.message}`));
      });
    }

    fetch(url);
  });
}

module.exports = {
  getManifest,
  getModelPath,
  getModelDir,
  isModelDownloaded,
  downloadModel,
};
