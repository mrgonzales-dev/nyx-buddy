<template>
  <div class="terminal">
    <!-- Title bar -->
    <div class="titlebar">
      <div class="titlebar-left">
        <span class="status-pill" :class="statusClass">
          ● {{ statusText }}
        </span>
      </div>
      <div class="titlebar-title">☾ nyx-dev — your local AI dev companion</div>
      <div class="titlebar-right">
        <span class="dot dot-yellow" @click="minimize"></span>
        <span class="dot dot-green" @click="toggleMaximize"></span>
        <span class="dot dot-red" @click="close"></span>
      </div>
    </div>

    <!-- Update banner -->
    <div v-if="updateInfo" class="update-banner" @click="openUpdate">
      <span class="update-banner-text">update available — v{{ updateInfo.version.replace(/^v/, '') }}</span>
      <span class="update-banner-action">click to download</span>
      <span class="update-banner-close" @click.stop="dismissUpdate">x</span>
    </div>

    <!-- Model bar -->
    <div class="modelbar">
      <div class="model-info">
        <span class="label">model:</span>
        <span class="value">{{ modelName }}</span>
      </div>
      <div class="model-info">
        <span class="label">quant:</span>
        <span class="value">{{ modelQuant }}</span>
      </div>
      <div class="model-info temp-info">
        <span class="label">temp:</span>
        <span class="temp-display" @click="tempEditing = !tempEditing" :title="`temperature: ${tempValue} — click to adjust`">
          {{ tempValue }} <span class="temp-desc">{{ tempDesc }}</span>
        </span>
        <div v-if="tempEditing" class="temp-slider-wrap" @mouseleave="commitTemp">
          <input
            class="temp-slider"
            type="range"
            min="0"
            max="2"
            step="0.1"
            v-model.number="tempValue"
            @input="onTempSlide"
            @change="commitTemp"
            @blur="commitTemp"
            ref="tempSliderEl"
          />
          <span class="temp-slider-val">{{ tempValue }}</span>
        </div>
      </div>
      <div class="model-info">
        <span class="label">ctx usage:</span>
        <span class="value">
          <span class="usage-bar"><span class="usage-fill" :style="{ width: usagePercent + '%' }"></span></span>
          {{ usagePercent }}%
        </span>
      </div>
      <div class="modelbar-spacer"></div>
      <button
        class="docs-btn"
        :class="{ active: showDocPanel }"
        @click="toggleDocPanel"
        title="browse docs"
      >docs</button>
      <button
        v-if="!modelLoaded && !modelLoading"
        class="load-btn"
        @click="loadModel"
      >load model</button>
      <span v-if="modelLoading" class="loading-text">{{ loadStatus }}</span>
    </div>

    <!-- Main area: chat + doc panel -->
    <div class="main-area">
      <!-- Chat log -->
      <div class="chat-log" ref="chatLog">
      <!-- Logo -->
      <div v-if="showLogo" class="logo-container">
        <pre class="logo-text">{{ logoText }}</pre>
        <div class="logo-subtext">your local AI dev companion</div>
      </div>

      <div class="line system">
        <span class="ts">[boot]</span>
        <span class="sys-msg">nyx-dev v0.1.0</span>
      </div>
      <div class="line system">
        <span class="ts">[boot]</span>
        <span class="sys-msg">type a message and press enter. /help for commands.</span>
      </div>
      <div class="line system">
        <span class="ts">[model]</span>
        <span class="sys-msg" :class="{ ok: modelLoaded, warn: !modelLoaded }">
          {{ modelLoaded ? '✓ model loaded — nyx is ready' : '○ no model loaded. click "load model" above.' }}
        </span>
      </div>
      <div v-if="modelLoaded" class="line system divider"></div>

      <!-- Messages -->
      <template v-for="(msg, i) in messages" :key="i">
        <div class="msg" :class="msg.role">
          <div class="msg-head">
            <span class="role" :class="msg.role + '-role'">{{ msg.role === 'assistant' ? 'nyx' : msg.role }}</span>
            <span class="ts">[{{ msg.ts }}]</span>
            <span v-if="msg.streaming" class="stream-tag">streaming…</span>
          </div>
          <div class="msg-body">
            <div
              v-if="msg.role === 'assistant' && !msg.streaming"
              class="msg-text markdown-body"
              v-html="renderMarkdown(msg.text)"
            ></div>
            <div
              v-else-if="msg.role === 'assistant' && msg.streaming"
              class="msg-text markdown-body"
              v-html="renderMarkdown(msg.text)"
            ></div>
            <div
              v-else-if="msg.role === 'system' && msg.text.includes('context compacted')"
              class="msg-text markdown-body compact-notice"
              v-html="renderMarkdown(msg.text)"
            ></div>
            <div v-else class="msg-text">{{ msg.text }}</div>
            <span v-if="msg.streaming" class="cursor inline"></span>
          </div>
        </div>
      </template>

      <!-- Error -->
      <div v-if="error" class="line system">
        <span class="ts">[error]</span>
        <span class="sys-msg err">{{ error }}</span>
      </div>
      </div>

      <!-- Resize handle -->
      <div
        v-if="showDocPanel"
        class="resize-handle"
        @mousedown="startResize"
      ></div>

      <!-- Doc browser side panel -->
      <DocBrowser
        v-if="showDocPanel"
        :style="{ width: docPanelWidth + 'px' }"
        @close="showDocPanel = false"
        @feed="onFeedFromDocs"
      />
    </div>

    <!-- Input prompt -->
    <div class="input-bar">
      <span class="input-prompt">
        <span class="prompt-user">{{ nickname || '...' }}@nyx-dev</span><span class="sep">:</span><span class="prompt-path">~</span><span class="sep">$</span>
      </span>
      <span v-if="hasDocsContext" class="docs-indicator" @click="clearDocsContext" title="click to clear docs context">[docs]</span>
      <input
        ref="inputEl"
        v-model="inputText"
        class="input-field"
        :disabled="isBusy || !nickname"
        :placeholder="nickname ? inputPlaceholder : 'set your nickname first...'"
        @keydown.enter="sendMessage"
        @paste="onPaste"
        spellcheck="false"
        autocomplete="off"
      />
      <span v-if="isBusy" class="esc-hint">[esc to interrupt]</span>
      <button
        v-if="!isBusy"
        class="send-btn"
        @click="sendMessage"
        :disabled="!inputText.trim() || !nickname"
      >send</button>
      <button
        v-else
        class="send-btn cancel"
        @click="cancelGeneration"
      >cancel</button>
    </div>

    <!-- Status bar -->
    <footer class="statusbar">
      <div class="status-left">
        <span class="sb-item">{{ modelName }}</span>
        <span class="sb-item">ctx: {{ tokensUsed }} / {{ tokensTotal }}</span>
        <span class="ctx-bar-wrap" v-if="tokensTotal > 0">
          <span class="ctx-bar-fill" :style="{ width: usagePercent + '%' }" :class="{ warn: usagePercent >= 80 }"></span>
        </span>
        <button
          class="compact-btn"
          :disabled="!canCompactBtn || isBusy || compacting"
          @click="manualCompact"
          title="compact conversation context"
        >{{ compacting ? 'compacting…' : 'compact' }}</button>
      </div>
      <div class="status-right">
        <span class="sb-item">{{ msgCount }} msgs</span>
        <span class="sb-item" :class="{ accent: modelLoaded }">● {{ modelLoaded ? 'ready' : 'idle' }}</span>
      </div>
    </footer>

    <!-- Model loading modal -->
    <transition name="modal-fade">
      <div v-if="modelLoading || modelJustLoaded" class="loading-overlay" @click.self="dismissLoadedModal">
        <div class="loading-modal">
          <template v-if="modelLoading">
            <div class="loading-spinner" v-if="!downloadProgress"></div>
            <div class="loading-modal-title">{{ downloadProgress ? "fetching nyx's soul" : 'loading model' }}</div>
            <div class="loading-modal-status">{{ downloadProgress ? 'downloading model' : (loadStatus || 'initializing…') }}</div>
            <div class="loading-modal-progress">
              <div
                v-if="downloadProgress"
                class="loading-modal-progress-fill"
                :style="{ width: downloadProgress.percent + '%' }"
              ></div>
              <div v-else class="loading-modal-progress-fill" :class="{ indeterminate: true }"></div>
            </div>
            <div v-if="downloadProgress" class="loading-modal-download-info">
              {{ downloadProgress.percent }}% · {{ formatBytes(downloadProgress.downloadedBytes) }} / {{ formatBytes(downloadProgress.totalBytes) }}
            </div>
          </template>
          <template v-else-if="modelJustLoaded">
            <div class="loading-modal-check">✓</div>
            <div class="loading-modal-title">model loaded</div>
            <div class="loading-modal-status">nyx is ready</div>
            <button class="loading-modal-btn" @click="dismissLoadedModal">start</button>
          </template>
        </div>
      </div>
    </transition>

    <!-- Nickname modal -->
    <transition name="modal-fade">
      <div v-if="showNicknameModal" class="loading-overlay">
        <div class="loading-modal">
          <div class="loading-modal-title">what should I call you?</div>
          <div class="loading-modal-status">lowercase letters, numbers, and _ only</div>
          <input
            class="nickname-input"
            v-model="nicknameInput"
            placeholder="your_name..."
            maxlength="20"
            spellcheck="false"
            @keydown.enter="saveNickname"
            @input="nicknameError = ''"
          />
          <div v-if="nicknameError" class="nickname-error">{{ nicknameError }}</div>
          <div class="nickname-modal-btns">
            <button class="loading-modal-btn" @click="saveNickname" :disabled="!nicknameInput.trim()">save</button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, nextTick, onMounted, onUnmounted, computed, watch } from 'vue';
import { renderMarkdown } from './markdownEngine.js';
import './markdownEngine.css';
import logoRaw from '../resources/logo.txt?raw';
import DocBrowser from './components/DocBrowser.vue';

// ---- State ----
const messages = ref([]);
const inputText = ref('');
const modelLoaded = ref(false);
const modelLoading = ref(false);
const loadStatus = ref('');
const error = ref('');
const isBusy = ref(false);
const tokensUsed = ref(0);
const tokensTotal = ref(0);
const chatLog = ref(null);
const inputEl = ref(null);
const showLogo = ref(true);
const logoText = ref(logoRaw);
const showDocPanel = ref(false);
const hasDocsContext = ref(false);
let docsContextContent = '';
const docPanelWidth = ref(340);
let resizing = false;

const modelName = ref('qwen2.5-coder:1.5b-instruct');
const modelQuant = ref('Q4_K_M');
const canCompactBtn = ref(false);
const compacting = ref(false);
const tempValue = ref('0.4');
const tempEditing = ref(false);
const tempSliderEl = ref(null);
const modelJustLoaded = ref(false);
const downloadProgress = ref(null);
const nickname = ref(localStorage.getItem('nyx-nickname') || '');
const showNicknameModal = ref(false);
const nicknameInput = ref('');
const nicknameError = ref('');
const updateInfo = ref(null); // { version, url, releaseNotes } or null

// ---- Computed ----
const usagePercent = computed(() => {
  if (tokensTotal.value === 0) return 0;
  return Math.round((tokensUsed.value / tokensTotal.value) * 100);
});

const tempDesc = computed(() => {
  const t = parseFloat(tempValue.value);
  if (t <= 0.1) return 'precise';
  if (t <= 0.4) return 'focused';
  if (t <= 0.7) return 'balanced';
  if (t <= 1.0) return 'lively';
  if (t <= 1.4) return 'creative';
  return 'chaotic';
});

const msgCount = computed(() => messages.value.length);

const statusText = computed(() => {
  if (modelLoading.value) return 'loading…';
  if (isBusy.value) return 'generating…';
  if (modelLoaded.value) return 'model loaded';
  return 'no model';
});

const statusClass = computed(() => ({
  loaded: modelLoaded.value && !isBusy.value,
  busy: isBusy.value || modelLoading.value,
}));

const inputPlaceholder = computed(() => {
  if (modelLoading.value) return 'loading model…';
  if (!modelLoaded.value) return 'load a model first…';
  if (isBusy.value) return 'generating response…';
  return 'type a message…';
});

// ---- Helpers ----
function timestamp() {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function scrollToBottom() {
  nextTick(() => {
    if (chatLog.value) {
      chatLog.value.scrollTop = chatLog.value.scrollHeight;
    }
  });
}

// ---- Helpers ----
function formatBytes(bytes) {
  if (typeof bytes !== 'number' || isNaN(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

// ---- Model ----
async function loadModel() {
  if (modelLoading.value || modelLoaded.value) return;

  if (!window.terminal?.loadModel) {
    error.value = 'API not available: loadModel is missing';
    return;
  }

  modelLoading.value = true;
  error.value = '';
  loadStatus.value = 'starting…';

  let unsub = null;
  let unsubDownload = null;
  try {
    unsub = window.terminal?.onModelStatus?.((status) => {
      if (status) loadStatus.value = status;
    });

    unsubDownload = window.terminal?.onDownloadProgress?.((progress) => {
      downloadProgress.value = progress;
    });

    const result = await window.terminal.loadModel();
    if (result.ok && result.meta && result.usage) {
      modelLoaded.value = true;
      modelName.value = result.meta.name || 'unknown';
      modelQuant.value = result.meta.quant || 'unknown';
      tokensUsed.value = result.usage.used || 0;
      tokensTotal.value = result.usage.total || 0;
      modelJustLoaded.value = true;
    } else {
      error.value = result.error || 'Failed to load model: unknown error';
    }
  } catch (err) {
    error.value = err.message || 'Unknown error loading model';
  } finally {
    modelLoading.value = false;
    loadStatus.value = '';
    downloadProgress.value = null;
    if (unsub) try { unsub(); } catch (_) {}
    if (unsubDownload) try { unsubDownload(); } catch (_) {}
    checkCanCompact();
  }
}

function dismissLoadedModal() {
  modelJustLoaded.value = false;
}

async function saveNickname() {
  const name = nicknameInput.value.trim().toLowerCase();
  if (!name) {
    nicknameError.value = 'nickname is required';
    return;
  }
  if (!/^[a-z0-9_]+$/.test(name)) {
    nicknameError.value = 'only lowercase letters, numbers, and _';
    return;
  }
  // Send to engine so it's in the system prompt
  if (window.terminal?.setNickname) {
    const result = await window.terminal.setNickname(name);
    if (!result.ok) {
      nicknameError.value = result.error;
      return;
    }
  }
  nickname.value = name;
  localStorage.setItem('nyx-nickname', name);
  showNicknameModal.value = false;
  // Now load the model
  try {
    await loadModel();
  } catch (err) {
    error.value = `Failed to auto-load model: ${err.message}`;
  }
  // Check for updates (non-blocking, silent fail)
  checkForUpdates();
}

// ---- Update check ----
async function checkForUpdates() {
  if (!window.terminal?.checkForUpdates) return;
  try {
    const result = await window.terminal.checkForUpdates();
    if (result.hasUpdate) {
      updateInfo.value = result;
    }
  } catch (err) {
    // Silent fail — no internet, GitHub down, etc.
    console.error('[update] check failed:', err.message);
  }
}

function openUpdate() {
  if (!updateInfo.value?.url) return;
  if (window.terminal?.openReleasePage) {
    window.terminal.openReleasePage(updateInfo.value.url);
  }
}

function dismissUpdate() {
  updateInfo.value = null;
}

// ---- Chat ----
async function cancelGeneration() {
  if (!isBusy.value) return;
  if (!window.terminal?.stop) {
    console.error('[chat] stop API not available');
    return;
  }
  try {
    await window.terminal.stop();
  } catch (err) {
    console.error('[chat] Failed to stop generation:', err.message);
  }
}

async function sendMessage() {
  const text = inputText.value.trim();
  if (!text || isBusy.value) return;

  // Handle slash commands
  if (text.startsWith('/')) {
    handleCommand(text);
    inputText.value = '';
    return;
  }

  if (!modelLoaded.value) {
    error.value = 'No model loaded. Click "load model" first.';
    return;
  }

  if (!window.terminal?.send) {
    error.value = 'API not available: send is missing';
    return;
  }

  error.value = '';
  inputText.value = '';
  showLogo.value = false;

  // Build the actual prompt — include docs context if any (from feed to nyx)
  let promptText = text;
  if (docsContextContent) {
    promptText = `[docs context]\n${docsContextContent}\n[/docs context]\n\n${text}`;
  }
  // Clear docs context after sending
  hasDocsContext.value = false;
  docsContextContent = '';

  // Add user message (display the original text, not the wrapped version)
  messages.value.push({
    role: 'user',
    text,
    ts: timestamp(),
    streaming: false,
  });
  scrollToBottom();

  // Add assistant placeholder
  const assistantMsg = ref({
    role: 'assistant',
    text: '',
    ts: timestamp(),
    streaming: true,
  });
  messages.value.push(assistantMsg.value);
  isBusy.value = true;
  scrollToBottom();

  // Stream chunks
  let unsub = null;
  try {
    unsub = window.terminal?.onChunk?.((chunk) => {
      if (typeof chunk === 'string') {
        assistantMsg.value.text += chunk;
        scrollToBottom();
      }
    });

    const result = await window.terminal.send(promptText, {
      temperature: parseFloat(tempValue.value) || 0.4,
    });
    if (result.ok && typeof result.response === 'string') {
      // Use the cleaned final response
      assistantMsg.value.text = result.response;
      if (result.usage) {
        tokensUsed.value = result.usage.used || 0;
        tokensTotal.value = result.usage.total || 0;
      }

      // If auto-compact happened, replace history with the summary
      if (result.autoCompacted && result.compactSummary) {
        messages.value = [{
          role: 'system',
          text: `**context auto-compacted** — previous conversation summarized below:\n\n${result.compactSummary}`,
          ts: timestamp(),
          streaming: false,
        }];
        scrollToBottom();
      }
    } else {
      assistantMsg.value.text = `[error: ${result.error || 'unknown'}]`;
      error.value = result.error || 'Failed to get response';
    }
  } catch (err) {
    assistantMsg.value.text = `[error: ${err.message || 'unknown'}]`;
    error.value = err.message || 'Unknown error during generation';
  } finally {
    assistantMsg.value.streaming = false;
    isBusy.value = false;
    if (unsub) try { unsub(); } catch (_) {}
    scrollToBottom();
    nextTick(() => inputEl.value?.focus());
    // Check if manual compact is available
    checkCanCompact();
  }
}

// ---- Manual compact ----
async function manualCompact() {
  if (compacting.value || isBusy.value) return;
  if (!window.terminal?.compact) {
    error.value = 'compact API not available';
    return;
  }

  compacting.value = true;
  error.value = '';

  let unsub = null;
  try {
    unsub = window.terminal?.onCompactChunk?.((chunk) => {
      if (typeof chunk === 'string') {
        // Show compact progress in a system message
        // (no separate UI — just let the status bar show "compacting…")
      }
    });

    const result = await window.terminal.compact();
    if (result.ok && result.summary) {
      if (result.usage) {
        tokensUsed.value = result.usage.used || 0;
        tokensTotal.value = result.usage.total || 0;
      }
      // Replace chat history with the summary
      messages.value = [{
        role: 'system',
        text: `**context compacted** — previous conversation summarized below:\n\n${result.summary}`,
        ts: timestamp(),
        streaming: false,
      }];
      scrollToBottom();
    } else {
      error.value = result.error || 'Compact failed: unknown error';
    }
  } catch (err) {
    error.value = err.message || 'Unknown error during compact';
  } finally {
    compacting.value = false;
    if (unsub) try { unsub(); } catch (_) {}
    checkCanCompact();
  }
}

async function checkCanCompact() {
  if (!window.terminal?.canCompact) {
    canCompactBtn.value = false;
    return;
  }
  try {
    const result = await window.terminal.canCompact();
    if (result.ok) {
      canCompactBtn.value = result.canCompact && modelLoaded.value;
    } else {
      canCompactBtn.value = false;
    }
  } catch (err) {
    canCompactBtn.value = false;
  }
}

function handleCommand(cmd) {
  if (!cmd || typeof cmd !== 'string') return;
  const parts = cmd.slice(1).split(/\s+/);
  const command = parts[0];

  if (command === 'help') {
    messages.value.push({
      role: 'system',
      text: 'commands: /help, /clear, /load, /status',
      ts: timestamp(),
      streaming: false,
    });
  } else if (command === 'clear') {
    messages.value = [];
    if (window.terminal?.clear) {
      window.terminal.clear();
    }
  } else if (command === 'load') {
    loadModel();
  } else if (command === 'status') {
    messages.value.push({
      role: 'system',
      text: `model: ${modelName.value} | loaded: ${modelLoaded.value} | tokens: ${tokensUsed.value}/${tokensTotal.value}`,
      ts: timestamp(),
      streaming: false,
    });
  } else {
    messages.value.push({
      role: 'system',
      text: `unknown command: /${command}`,
      ts: timestamp(),
      streaming: false,
    });
  }
  scrollToBottom();
}

// ---- Window controls ----
const close = () => window.terminal?.close();
const minimize = () => window.terminal?.minimize();
const toggleMaximize = () => window.terminal?.toggleMaximize();

// ---- Doc panel ----
function toggleDocPanel() {
  showDocPanel.value = !showDocPanel.value;
}

// ---- Temperature editing ----
function onTempSlide() {
  // live update — value is already a number from v-model.number
}

function commitTemp() {
  let val = parseFloat(tempValue.value);
  if (isNaN(val)) val = 0.4;
  if (val < 0) val = 0;
  if (val > 2) val = 2;
  tempValue.value = val.toFixed(1);
  tempEditing.value = false;
}

// Auto-focus slider when opened
watch(tempEditing, (open) => {
  if (open) {
    nextTick(() => {
      try { tempSliderEl.value?.focus(); } catch (_) {}
    });
  }
});

// Close slider when clicking outside
function onTempOutsideClick(e) {
  if (!tempEditing.value) return;
  const target = e.target;
  if (!target) return;
  if (target.closest?.('.temp-info')) return;
  commitTemp();
}

function startResize(e) {
  if (!e || typeof e.preventDefault !== 'function') return;
  e.preventDefault();
  resizing = true;
  const startX = e.clientX;
  const startWidth = docPanelWidth.value;
  const onMove = (ev) => {
    if (!resizing) return;
    if (typeof ev.clientX !== 'number') return;
    const delta = startX - ev.clientX;
    const newWidth = Math.max(240, Math.min(600, startWidth + delta));
    docPanelWidth.value = newWidth;
  };
  const onUp = () => {
    resizing = false;
    try {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    } catch (err) {
      console.error('[resize] Cleanup error:', err.message);
    }
  };
  document.body.style.userSelect = 'none';
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function onFeedFromDocs(text) {
  if (!text || typeof text !== 'string') return;
  // Accumulate docs context if feeding multiple times
  docsContextContent = docsContextContent ? docsContextContent + '\n' + text : text;
  hasDocsContext.value = true;
  nextTick(() => inputEl.value?.focus());
}

function clearDocsContext() {
  docsContextContent = '';
  hasDocsContext.value = false;
}

function onPaste(e) {
  if (!e) return;
  let text = '';
  try {
    text = e.clipboardData?.getData('text') || '';
  } catch (err) {
    console.error('[paste] Failed to read clipboard:', err.message);
    return;
  }
  if (!text) return;
  e.preventDefault();

  // Normal paste: insert text into input field at cursor position
  const el = inputEl.value;
  if (!el) {
    inputText.value += text;
    return;
  }

  let start = 0, end = 0;
  try {
    start = el.selectionStart ?? inputText.value.length;
    end = el.selectionEnd ?? inputText.value.length;
  } catch (err) {
    start = end = inputText.value.length;
  }

  inputText.value = inputText.value.slice(0, start) + text + inputText.value.slice(end);
  nextTick(() => {
    try {
      el.selectionStart = el.selectionEnd = start + text.length;
    } catch (err) {
      // ignore
    }
  });
}

// ---- Global keydown (Escape works even when input is disabled) ----
function onGlobalKeydown(e) {
  if (e.key === 'Escape' && isBusy.value) {
    e.preventDefault();
    cancelGeneration();
  }
}

// ---- Lifecycle ----
onMounted(() => {
  // If no nickname set, force nickname modal before anything else
  if (!localStorage.getItem('nyx-nickname')) {
    showNicknameModal.value = true;
    nicknameError.value = '';
    nextTick(() => {
      const el = document.querySelector('.nickname-input');
      if (el) el.focus();
    });
  } else {
    // Nickname already set — restore it and send to engine
    const savedName = localStorage.getItem('nyx-nickname');
    nickname.value = savedName;
    if (window.terminal?.setNickname) {
      window.terminal.setNickname(savedName);
    }
    // Auto-load model
    try {
      loadModel();
    } catch (err) {
      error.value = `Failed to auto-load model: ${err.message}`;
    }
    // Check for updates (non-blocking, silent fail)
    checkForUpdates();
  }
  nextTick(() => {
    try { inputEl.value?.focus(); } catch (_) {}
  });
  document.addEventListener('mousedown', onTempOutsideClick);
  window.addEventListener('keydown', onGlobalKeydown);
});

onUnmounted(() => {
  // cleanup handled by returned unsub functions
  // Ensure any resize listeners are removed
  try {
    document.body.style.userSelect = '';
  } catch (_) {}
  document.removeEventListener('mousedown', onTempOutsideClick);
  window.removeEventListener('keydown', onGlobalKeydown);
});
</script>

<style scoped>
.terminal {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg);
  border: 1px solid var(--border);
}

/* ---- Title bar ---- */
.titlebar {
  height: 32px;
  flex: 0 0 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  background: linear-gradient(180deg, #04141a 0%, #000 100%);
  border-bottom: 1px solid var(--border);
  -webkit-app-region: drag;
  user-select: none;
}
.titlebar-left,
.titlebar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  -webkit-app-region: no-drag;
}
.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
  cursor: pointer;
  opacity: 0.85;
  transition: opacity 0.15s;
}
.dot:hover {
  opacity: 1;
}
.dot-red {
  background: #ff5f56;
}
.dot-yellow {
  background: #ffbd2e;
}
.dot-green {
  background: #27c93f;
}
.titlebar-title {
  font-size: 12px;
  color: var(--text-dim);
  letter-spacing: 0.5px;
}
.status-pill {
  font-size: 11px;
  color: var(--text-dim);
}
.status-pill.loaded {
  color: var(--cyan);
  text-shadow: 0 0 6px var(--cyan-glow);
}
.status-pill.busy {
  color: #ffbd2e;
}

/* ---- Model bar ---- */
.modelbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 22px;
  padding: 7px 14px;
  background: var(--bg-soft);
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  flex-wrap: wrap;
}
.model-info {
  display: flex;
  align-items: center;
  gap: 6px;
}
.model-info .label {
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 1px;
}
.model-info .value {
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 6px;
}
/* ---- Temperature slider ---- */
.temp-info {
  position: relative;
}
.temp-display {
  color: var(--text);
  cursor: pointer;
  font-size: 11px;
  padding: 1px 4px;
  border: 1px solid transparent;
  transition: border-color 0.15s;
}
.temp-display:hover {
  border-color: var(--border);
}
.temp-desc {
  color: var(--text-dim);
  font-size: 10px;
  margin-left: 2px;
}
.temp-slider-wrap {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 50;
  background: var(--bg);
  border: 1px solid var(--border);
  padding: 8px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.8);
}
.temp-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 120px;
  height: 4px;
  background: var(--border);
  outline: none;
  cursor: pointer;
}
.temp-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  background: var(--cyan);
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 0 6px var(--cyan-glow);
}
.temp-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  background: var(--cyan);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 0 6px var(--cyan-glow);
}
.temp-slider-val {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--cyan);
  min-width: 24px;
  text-align: right;
}
.modelbar-spacer {
  flex: 1;
}
.usage-bar {
  display: inline-block;
  width: 70px;
  height: 6px;
  background: rgba(0, 229, 255, 0.12);
  border: 1px solid var(--border);
  position: relative;
}
.usage-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: var(--cyan);
  box-shadow: 0 0 6px var(--cyan-glow);
  transition: width 0.3s ease;
}
.load-btn {
  background: transparent;
  border: 1px solid var(--cyan);
  color: var(--cyan);
  font-family: var(--mono);
  font-size: 11px;
  padding: 3px 12px;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 1px;
  transition: all 0.15s;
}
.load-btn:hover {
  background: rgba(0, 229, 255, 0.1);
  box-shadow: 0 0 8px var(--cyan-glow);
}
.loading-text {
  color: var(--cyan);
  font-size: 11px;
  text-shadow: 0 0 6px var(--cyan-glow);
}
.docs-btn {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 11px;
  padding: 3px 12px;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 1px;
  transition: all 0.15s;
}
.docs-btn:hover {
  border-color: var(--cyan);
  color: var(--cyan);
}
.docs-btn.active {
  border-color: var(--cyan);
  color: var(--cyan);
  background: rgba(0, 229, 255, 0.08);
  box-shadow: 0 0 6px var(--cyan-glow);
}

/* ---- Main area (chat + doc panel) ---- */
.main-area {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}
.resize-handle {
  flex: 0 0 4px;
  background: var(--border);
  cursor: col-resize;
  transition: background 0.15s;
  z-index: 10;
}
.resize-handle:hover {
  background: var(--cyan);
  box-shadow: 0 0 6px var(--cyan-glow);
}

/* ---- Docs context indicator ---- */
.docs-indicator {
  font-size: 11px;
  color: var(--cyan);
  background: rgba(0, 229, 255, 0.1);
  border: 1px solid var(--cyan);
  padding: 2px 8px;
  white-space: nowrap;
  flex: 0 0 auto;
  font-weight: bold;
  letter-spacing: 0.5px;
  cursor: pointer;
  user-select: none;
}
.docs-indicator:hover {
  background: rgba(0, 229, 255, 0.2);
  box-shadow: 0 0 6px var(--cyan-glow);
}
.esc-hint {
  font-size: 10px;
  color: var(--text-dim);
  white-space: nowrap;
  flex: 0 0 auto;
  margin-right: 4px;
  animation: pulse 1.5s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
.send-btn {
  background: transparent;
  border: 1px solid var(--cyan);
  color: var(--cyan);
  font-family: var(--mono);
  font-size: 11px;
  padding: 3px 14px;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 1px;
  flex: 0 0 auto;
  transition: all 0.15s;
}
.send-btn:hover:not(:disabled) {
  background: rgba(0, 229, 255, 0.1);
  box-shadow: 0 0 6px var(--cyan-glow);
}
.send-btn:disabled {
  opacity: 0.3;
  cursor: default;
  border-color: var(--border);
  color: var(--text-dim);
}
.send-btn.cancel {
  border-color: #ff5f56;
  color: #ff5f56;
}
.send-btn.cancel:hover {
  background: rgba(255, 95, 86, 0.1);
  box-shadow: 0 0 6px rgba(255, 95, 86, 0.4);
}

/* ---- Chat log ---- */
.chat-log {
  flex: 1;
  overflow-y: auto;
  padding: 14px 18px 8px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ---- Logo ---- */
.logo-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px 0 12px;
  margin-bottom: 4px;
}
.logo-text {
  font-family: var(--mono);
  font-size: 13px;
  line-height: 1.1;
  color: var(--cyan);
  text-shadow: 0 0 8px var(--cyan-glow);
  margin: 0;
  white-space: pre;
}
.logo-subtext {
  font-size: 11px;
  color: var(--text-dim);
  letter-spacing: 2px;
  text-transform: uppercase;
  margin-top: 8px;
}
.line.system {
  font-size: 12px;
  color: var(--text-dim);
  display: flex;
  gap: 10px;
  align-items: baseline;
}
.line.system .ts {
  color: var(--cyan-dim);
  flex: 0 0 auto;
}
.sys-msg {
  color: var(--text-dim);
}
.sys-msg.ok {
  color: #27c93f;
}
.sys-msg.warn {
  color: #ffbd2e;
}
.sys-msg.err {
  color: #ff5f56;
}
.line.system.divider {
  border-top: 1px dashed var(--border);
  height: 0;
  margin: 4px 0;
  padding: 0;
}

/* ---- Messages ---- */
.msg {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.msg-head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
}
.role {
  text-transform: uppercase;
  letter-spacing: 1.5px;
  font-weight: bold;
  padding: 1px 7px;
  border: 1px solid;
}
.user-role {
  color: var(--cyan);
  border-color: var(--cyan);
  background: rgba(0, 229, 255, 0.08);
}
.assistant-role {
  color: #5ff0d0;
  border-color: #5ff0d0;
  background: rgba(95, 240, 208, 0.06);
}
.system-role {
  color: var(--text-dim);
  border-color: var(--text-dim);
}
.msg-head .ts {
  color: var(--text-dim);
}
.stream-tag {
  color: var(--cyan);
  text-shadow: 0 0 6px var(--cyan-glow);
  animation: pulse 1s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.4;
  }
}
.msg-body {
  padding-left: 4px;
  font-size: 13px;
  line-height: 1.6;
}
.msg.user .msg-body {
  color: var(--text);
  border-left: 2px solid var(--cyan-dim);
  padding-left: 12px;
}
.msg.assistant .msg-body {
  color: var(--text);
}
.msg.system .msg-body {
  color: var(--text-dim);
  font-size: 12px;
}
.compact-notice {
  border-left: 2px solid var(--cyan-dim);
  padding: 8px 12px;
  margin: 4px 0;
  background: rgba(0, 229, 255, 0.04);
  font-size: 12px;
  color: var(--text);
}
.compact-notice p {
  margin: 4px 0;
}
.compact-notice p:first-child {
  color: var(--cyan);
  font-weight: bold;
}
.msg-text {
  white-space: pre-wrap;
  word-break: break-word;
}

/* ---- Streaming cursor ---- */
.cursor {
  display: inline-block;
  width: 9px;
  height: 16px;
  background: var(--cyan);
  box-shadow: 0 0 8px var(--cyan-glow);
  animation: blink 1.1s steps(1) infinite;
  vertical-align: text-bottom;
}
.cursor.inline {
  height: 14px;
  margin-left: 1px;
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}

/* ---- Input bar ---- */
.input-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 18px;
  background: var(--bg-soft);
  border-top: 1px solid var(--border);
}
.input-prompt {
  font-size: 13px;
  white-space: nowrap;
  flex: 0 0 auto;
}
.prompt-user {
  color: var(--cyan);
}
.sep {
  color: var(--text-dim);
}
.input-field {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text);
  font-family: var(--mono);
  font-size: 13px;
  caret-color: var(--cyan);
}
.input-field::placeholder {
  color: var(--text-dim);
}
.input-field:disabled {
  opacity: 0.5;
}

/* ---- Status bar ---- */
.statusbar {
  height: 24px;
  flex: 0 0 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  background: var(--bg-soft);
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-dim);
}
.status-left,
.status-right {
  display: flex;
  gap: 16px;
  align-items: center;
}
.sb-item.accent {
  color: var(--cyan);
  text-shadow: 0 0 6px var(--cyan-glow);
}

/* ---- Context bar ---- */
.ctx-bar-wrap {
  display: inline-block;
  width: 80px;
  height: 6px;
  background: var(--border);
  border-radius: 0;
  overflow: hidden;
  flex: 0 0 auto;
}
.ctx-bar-fill {
  display: block;
  height: 100%;
  background: var(--cyan);
  transition: width 0.3s, background 0.3s;
}
.ctx-bar-fill.warn {
  background: #ff8c00;
  box-shadow: 0 0 4px rgba(255, 140, 0, 0.6);
}

/* ---- Compact button ---- */
.compact-btn {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 10px;
  padding: 1px 8px;
  cursor: pointer;
  text-transform: lowercase;
  letter-spacing: 0.5px;
  transition: all 0.15s;
}
.compact-btn:hover:not(:disabled) {
  border-color: var(--cyan);
  color: var(--cyan);
  background: rgba(0, 229, 255, 0.05);
}
.compact-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ---- Model loading modal ---- */
.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}
.loading-modal {
  background: var(--bg);
  border: 1px solid var(--border);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8), 0 0 1px var(--cyan-dim);
  padding: 32px 40px;
  min-width: 280px;
  max-width: 340px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.loading-spinner {
  width: 28px;
  height: 28px;
  border: 2px solid var(--border);
  border-top-color: var(--cyan);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 16px;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.loading-modal-check {
  font-size: 28px;
  color: var(--cyan);
  margin-bottom: 12px;
  line-height: 1;
  text-shadow: 0 0 12px var(--cyan-glow);
}
.loading-modal-title {
  font-family: var(--mono);
  font-size: 14px;
  color: var(--text);
  text-transform: lowercase;
  letter-spacing: 1px;
  margin-bottom: 6px;
  font-weight: bold;
}
.loading-modal-status {
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 16px;
}
.loading-modal-progress {
  width: 100%;
  height: 3px;
  background: var(--border);
  overflow: hidden;
}
.loading-modal-progress-fill {
  height: 100%;
  background: var(--cyan);
  width: 30%;
}
.loading-modal-progress-fill.indeterminate {
  animation: indeterminate 1.4s ease-in-out infinite;
}
.loading-modal-download-info {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--text-dim);
  margin-top: 8px;
}
@keyframes indeterminate {
  0% { margin-left: -30%; }
  50% { margin-left: 50%; }
  100% { margin-left: 100%; }
}
.loading-modal-btn {
  background: transparent;
  border: 1px solid var(--cyan);
  color: var(--cyan);
  font-family: var(--mono);
  font-size: 12px;
  padding: 6px 24px;
  cursor: pointer;
  text-transform: lowercase;
  letter-spacing: 1px;
  transition: all 0.15s;
}
.loading-modal-btn:hover {
  background: rgba(0, 229, 255, 0.1);
  box-shadow: 0 0 8px var(--cyan-glow);
}

/* Modal transition */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s;
}
.modal-fade-enter-active .loading-modal,
.modal-fade-leave-active .loading-modal {
  transition: transform 0.2s, opacity 0.2s;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
.modal-fade-enter-from .loading-modal,
.modal-fade-leave-to .loading-modal {
  transform: scale(0.95);
  opacity: 0;
}

/* ---- Nickname modal ---- */
.nickname-input {
  width: 100%;
  margin: 12px 0;
  padding: 8px 12px;
  font-family: var(--mono);
  font-size: 14px;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  outline: none;
}
.nickname-input:focus {
  border-color: var(--cyan);
}
.nickname-input::placeholder {
  color: var(--text-dim);
}
.nickname-modal-btns {
  display: flex;
  gap: 8px;
  justify-content: center;
}
.nickname-error {
  font-family: var(--mono);
  font-size: 11px;
  color: #ff6b6b;
  margin-bottom: 8px;
}

/* ---- Update banner ---- */
.update-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 12px;
  background: rgba(255, 184, 108, 0.1);
  border-bottom: 1px solid rgba(255, 184, 108, 0.3);
  font-family: var(--mono);
  font-size: 11px;
  color: #ffb86c;
  cursor: pointer;
}
.update-banner:hover {
  background: rgba(255, 184, 108, 0.15);
}
.update-banner-text {
  font-weight: bold;
}
.update-banner-action {
  color: var(--text-dim);
  text-decoration: underline;
}
.update-banner-close {
  margin-left: auto;
  color: var(--text-dim);
  cursor: pointer;
  padding: 0 4px;
}
.update-banner-close:hover {
  color: #ff6b6b;
}
</style>
