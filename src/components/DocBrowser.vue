<template>
  <div class="doc-panel">
    <!-- Header -->
    <div class="doc-header">
      <div class="doc-tabs">
        <button
          class="doc-tab"
          :class="{ active: activeTab === 'installed' }"
          @click="switchTab('installed')"
        >installed</button>
        <button
          class="doc-tab"
          :class="{ active: activeTab === 'available' }"
          @click="switchTab('available')"
        >available</button>
        <button
          v-if="downloads.length > 0"
          class="doc-tab"
          :class="{ active: activeTab === 'downloading' }"
          @click="switchTab('downloading')"
        >downloading <span class="tab-badge">{{ downloads.length }}</span></button>
      </div>
      <div class="doc-header-actions">
        <button class="doc-close" @click="$emit('close')" title="close panel">×</button>
      </div>
    </div>

    <!-- Installed tab -->
    <div v-if="activeTab === 'installed'" class="doc-content">
      <!-- Docset list (no slug selected yet) -->
      <template v-if="!selectedSlug">
        <div v-if="installedDocsets.length === 0" class="doc-empty">
          no docsets installed.
          <br>switch to <span class="hl" @click="switchTab('available')">available</span> to download some.
        </div>
        <div v-else class="docset-list">
          <div
            v-for="ds in installedDocsets"
            :key="ds.slug"
            class="docset-item"
            @click="openDocset(ds.slug)"
          >
            <div class="docset-info">
              <div class="docset-name">{{ ds.name }}</div>
              <div class="docset-meta">{{ ds.version }} · {{ ds.entry_count }} entries</div>
            </div>
            <button class="docset-remove" @click.stop="confirmUninstall(ds)">×</button>
          </div>
        </div>
      </template>

      <!-- Docset browser (slug selected) -->
      <template v-else>
        <div class="docset-toolbar">
          <button class="back-btn" @click="closeDocset">← back</button>
          <span class="docset-title">{{ selectedDocsetName }}</span>
        </div>

        <!-- Search bar with feed button -->
        <div class="search-bar">
          <span class="search-icon">⌕</span>
          <input
            v-model="searchQuery"
            class="search-input"
            placeholder="search docs..."
            spellcheck="false"
            @input="onSearch"
          />
          <button
            class="feed-bar-btn"
            :class="{ active: hasSelection }"
            :disabled="!hasSelection"
            @click="feedToNyx"
            :title="hasSelection ? 'feed selected text to nyx' : 'select text in the page to feed'"
          >→ nyx</button>
        </div>

        <!-- Split view: entry list + page content -->
        <div class="doc-split" :class="{ 'entry-collapsed': entryListCollapsed }">
          <!-- Left: entry list / search results -->
          <div v-if="!entryListCollapsed" class="entry-list">
            <!-- Collapse bar on top -->
            <div class="entry-collapse-bar">
              <span class="entry-collapse-label">entries</span>
              <button
                class="entry-collapse-btn"
                @click="entryListCollapsed = true"
                title="hide entry list"
              >◀</button>
            </div>

            <!-- Type filter chips -->
            <div v-if="browseTypes.length > 0 && !searchQuery" class="type-filters">
              <button
                class="type-chip"
                :class="{ active: !activeType || activeType === 'All' }"
                @click="filterByType('All')"
              >all</button>
              <button
                v-for="t in browseTypes.slice(0, 8)"
                :key="t.name"
                class="type-chip"
                :class="{ active: activeType === t.name }"
                @click="filterByType(t.name)"
              >{{ t.name.toLowerCase() }}</button>
            </div>

            <!-- Search results (when searching) -->
            <template v-if="searchQuery">
              <div v-if="searching" class="entry-loading">searching...</div>
              <div v-else-if="searchResults.length > 0">
                <div
                  v-for="entry in searchResults"
                  :key="entry.path"
                  class="entry-item"
                  @click="openPage(entry)"
                >
                  <span class="entry-name">{{ entry.name }}</span>
                  <span class="entry-type" v-if="entry.type">{{ entry.type }}</span>
                </div>
              </div>
              <div v-else class="entry-loading">no results for "{{ searchQuery }}"</div>
            </template>

            <!-- Browse entries (when not searching) -->
            <template v-else>
              <div
                v-for="entry in filteredBrowseEntries"
                :key="entry.path"
                class="entry-item"
                @click="openPage(entry)"
              >
                <span class="entry-name">{{ entry.name }}</span>
                <span class="entry-type" v-if="entry.type">{{ entry.type }}</span>
              </div>
              <div v-if="filteredBrowseEntries.length === 0" class="entry-loading">
                no entries
              </div>
            </template>
          </div>

          <!-- Right: page content -->
          <div class="page-view" ref="pageView" @mouseup="onTextSelection">
            <!-- Expand bar when entry list is collapsed -->
            <div v-if="entryListCollapsed" class="entry-expand-bar" @click="entryListCollapsed = false" title="show entry list">
              <span>entries ▶</span>
            </div>
            <div v-if="pageLoading" class="doc-empty">loading page...</div>
            <div v-else-if="pageError" class="doc-empty err">error: {{ pageError }}</div>
            <div
              v-else-if="currentPageHtml"
              class="page-content markdown-body"
              v-html="currentPageMarkdown"
            ></div>
            <div v-else class="doc-empty">
              select an entry to view its docs.
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Available tab -->
    <div v-if="activeTab === 'available'" class="doc-content">
      <div class="search-bar">
        <span class="search-icon">⌕</span>
        <input
          v-model="availableFilter"
          class="search-input"
          placeholder="filter docsets..."
          spellcheck="false"
          @input="onFilterAvailable"
        />
      </div>

      <div v-if="availableLoading" class="doc-empty">loading catalog...</div>
      <div v-else-if="availableDocsets.length === 0" class="doc-empty">
        no docsets found.
      </div>
      <div v-else class="docset-list">
        <div
          v-for="ds in availableDocsets"
          :key="ds.slug"
          class="docset-item"
        >
          <div class="docset-info">
            <div class="docset-name">{{ ds.name }}</div>
            <div class="docset-meta">{{ ds.slug }} · {{ ds.version }}</div>
          </div>
          <button
            v-if="!isInstalled(ds.slug)"
            class="install-btn"
            :disabled="installingSlug === ds.slug"
            @click="installDocset(ds.slug)"
          >
            {{ installingSlug === ds.slug ? installStatus : 'install' }}
          </button>
          <span v-else class="installed-badge">✓ installed</span>
        </div>
      </div>
    </div>

    <!-- Custom uninstall modal -->
    <transition name="modal-fade">
      <div v-if="modal.visible" class="modal-overlay" @click.self="modalCancel">
        <div class="modal-box">
          <div class="modal-icon">{{ modal.icon }}</div>
          <div class="modal-title">{{ modal.title }}</div>
          <div class="modal-message" v-html="modal.message"></div>
          <div class="modal-actions">
            <button class="modal-btn modal-cancel" @click="modalCancel" :disabled="modal.busy">
              {{ modal.cancelText || 'cancel' }}
            </button>
            <button
              class="modal-btn modal-confirm"
              :class="{ danger: modal.danger }"
              @click="modalConfirm"
              :disabled="modal.busy"
            >
              {{ modal.busy ? 'working…' : modal.confirmText }}
            </button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue';
import TurndownService from 'turndown';
import { renderMarkdown } from '../markdown.js';

const emit = defineEmits(['close', 'feed']);

// ---- State ----
const activeTab = ref('installed');
const installedDocsets = ref([]);
const availableDocsets = ref([]);
const availableLoading = ref(false);
const availableFilter = ref('');
const selectedSlug = ref(null);
const selectedDocsetName = ref('');
const searchQuery = ref('');
const searchResults = ref([]);
const searching = ref(false);
const currentPageHtml = ref(null);
const currentPageMarkdown = ref('');
const hasSelection = ref(false);
const installingSlug = ref(null);
const installStatus = ref('');
const pageView = ref(null);
const downloads = ref([]);
const browseEntries = ref([]);   // auto-loaded entry list when docset opens
const browseTypes = ref([]);      // type categories
const activeType = ref(null);     // selected type filter
const browseView = ref(true);     // show entry list by default (vs page view)
const entryListCollapsed = ref(false);  // collapse entry list sidebar

// ---- Modal state ----
const modal = ref({
  visible: false,
  icon: '',
  title: '',
  message: '',
  confirmText: 'confirm',
  cancelText: 'cancel',
  danger: false,
  busy: false,
  onConfirm: null,
  onCancel: null,
});

function showModal(opts) {
  if (!opts || typeof opts !== 'object') return;
  modal.value = {
    visible: true,
    icon: opts.icon || '',
    title: opts.title || '',
    message: opts.message || '',
    confirmText: opts.confirmText || 'confirm',
    cancelText: opts.cancelText || 'cancel',
    danger: opts.danger || false,
    busy: false,
    onConfirm: typeof opts.onConfirm === 'function' ? opts.onConfirm : null,
    onCancel: typeof opts.onCancel === 'function' ? opts.onCancel : null,
  };
}

function modalConfirm() {
  if (modal.value.busy) return;
  if (modal.value.onConfirm) {
    modal.value.busy = true;
    try {
      const result = modal.value.onConfirm();
      // If onConfirm returns a promise, wait for it
      if (result && typeof result.then === 'function') {
        result.finally(() => { modal.value.visible = false; });
      } else {
        modal.value.visible = false;
      }
    } catch (err) {
      modal.value.busy = false;
      console.error('[modal] onConfirm error:', err.message);
    }
  } else {
    modal.value.visible = false;
  }
}

function modalCancel() {
  if (modal.value.busy) return;
  if (modal.value.onCancel) {
    try { modal.value.onCancel(); } catch (err) {
      console.error('[modal] onCancel error:', err.message);
    }
  }
  modal.value.visible = false;
}

let searchDebounce = null;
let filterDebounce = null;

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});
// Don't escape HTML in code blocks
turndown.addRule('keepCode', {
  filter: ['pre'],
  replacement: function (content, node) {
    const codeEl = node.querySelector('code');
    const lang = codeEl ? (codeEl.className || '').replace(/language-|hljs/g, '').trim() : '';
    const code = codeEl ? codeEl.textContent : content;
    return '\n```' + lang + '\n' + code + '\n```\n';
  },
});

// ---- Computed ----
function isInstalled(slug) {
  return installedDocsets.value.some((d) => d.slug === slug);
}

// ---- Tab switching ----
function switchTab(tab) {
  activeTab.value = tab;
  if (tab === 'installed') {
    refreshInstalled();
  } else if (tab === 'available') {
    if (availableDocsets.value.length === 0) {
      loadAvailable();
    }
  }
}

// ---- Installed ----
async function refreshInstalled() {
  if (!window.terminal?.docsInstalled) {
    console.error('[docs] docsInstalled API not available');
    return;
  }
  try {
    const result = await window.terminal.docsInstalled();
    if (result.ok && Array.isArray(result.docsets)) {
      installedDocsets.value = result.docsets;
    } else {
      console.error('[docs] Failed to list installed:', result.error || 'unknown');
    }
  } catch (err) {
    console.error('[docs] Error listing installed:', err.message);
  }
}

function openDocset(slug) {
  if (!slug) return;
  selectedSlug.value = slug;
  const ds = installedDocsets.value.find((d) => d.slug === slug);
  selectedDocsetName.value = ds ? (ds.name || slug) : slug;
  searchQuery.value = '';
  searchResults.value = [];
  currentPageHtml.value = null;
  currentPageMarkdown.value = '';
  pageError.value = '';
  browseEntries.value = [];
  browseTypes.value = [];
  activeType.value = null;
  browseView.value = true;

  // Auto-load the index page + entry list
  autoLoadDocsetIndex(slug);
}

// Auto-load the docset's index page and a browsable entry list
async function autoLoadDocsetIndex(slug) {
  if (!slug) return;

  // 1. Load the entry list for browsing (grouped by type)
  if (window.terminal?.docsEntries) {
    try {
      const result = await window.terminal.docsEntries(slug, null);
      if (result.ok && Array.isArray(result.entries)) {
        browseEntries.value = result.entries;
        browseTypes.value = result.types || [];
      } else {
        console.error('[docs] Failed to load entries:', result.error || 'unknown');
      }
    } catch (err) {
      console.error('[docs] Error loading entries:', err.message);
    }
  }

  // 2. Try to load the index page (most docsets have an "index" key in db.json)
  if (window.terminal?.docsPage) {
    pageLoading.value = true;
    pageError.value = '';

    try {
      const result = await window.terminal.docsPage(slug, 'index');
      if (result.ok && result.html) {
        currentPageHtml.value = result.html;
        let md;
        try {
          md = turndown.turndown(result.html);
        } catch (err) {
          console.error('[docs] HTML to markdown conversion failed:', err.message);
          md = result.html;
        }
        currentPageMarkdown.value = renderMarkdown(md);
        browseView.value = false; // show the page
      } else {
        // No index page — show entry list instead
        currentPageHtml.value = null;
        browseView.value = true;
      }
    } catch (err) {
      console.error('[docs] Auto-load index failed:', err.message);
      browseView.value = true;
    } finally {
      pageLoading.value = false;
    }
  } else {
    browseView.value = true;
  }
}

// Filter entries by type
function filterByType(type) {
  activeType.value = type;
}

const filteredBrowseEntries = computed(() => {
  if (!activeType.value || activeType.value === 'All') {
    return browseEntries.value;
  }
  return browseEntries.value.filter((e) => (e.type || 'Other') === activeType.value);
});

function closeDocset() {
  selectedSlug.value = null;
  selectedDocsetName.value = '';
  searchQuery.value = '';
  searchResults.value = [];
  currentPageHtml.value = null;
  currentPageMarkdown.value = '';
  hasSelection.value = false;
  entryListCollapsed.value = false;
  pageError.value = '';
}

async function confirmUninstall(ds) {
  if (!ds || !ds.slug) return;

  const name = ds.name || ds.slug;
  const entries = ds.entry_count || 0;
  const version = ds.version || '';

  showModal({
    icon: '⊘',
    title: 'uninstall docset',
    message: `remove <b>${name}</b>${version ? ` v${version}` : ''}?<br><span class="modal-detail">${entries} entries will be deleted from disk.</span>`,
    confirmText: 'uninstall',
    cancelText: 'keep',
    danger: true,
    onConfirm: async () => {
      if (!window.terminal?.docsUninstall) {
        showModal({
          icon: '!',
          title: 'error',
          message: 'uninstall API not available',
          confirmText: 'ok',
          cancelText: '',
        });
        return;
      }

      try {
        const result = await window.terminal.docsUninstall(ds.slug);
        if (result.ok) {
          refreshInstalled();
        } else {
          showModal({
            icon: '!',
            title: 'uninstall failed',
            message: result.error || 'unknown error',
            confirmText: 'ok',
            cancelText: '',
          });
        }
      } catch (err) {
        showModal({
          icon: '!',
          title: 'uninstall failed',
          message: err.message || 'unknown error',
          confirmText: 'ok',
          cancelText: '',
        });
      }
    },
  });
}

// ---- Search ----
function onSearch() {
  clearTimeout(searchDebounce);
  searching.value = true;
  searchDebounce = setTimeout(async () => {
    const query = searchQuery.value.trim();
    if (!query || !selectedSlug.value) {
      searchResults.value = [];
      searching.value = false;
      return;
    }

    if (!window.terminal?.docsSearch) {
      console.error('[docs] docsSearch API not available');
      searching.value = false;
      return;
    }

    try {
      const result = await window.terminal.docsSearch(selectedSlug.value, query);
      if (result.ok && Array.isArray(result.entries)) {
        searchResults.value = result.entries;
      } else {
        searchResults.value = [];
        console.error('[docs] Search failed:', result.error || 'unknown');
      }
    } catch (err) {
      searchResults.value = [];
      console.error('[docs] Search error:', err.message);
    } finally {
      searching.value = false;
    }
  }, 200);
}

// ---- Page opening ----
const pageLoading = ref(false);
const pageError = ref('');

async function openPage(entry) {
  if (!entry || !entry.path) {
    pageError.value = 'Invalid entry: missing path';
    return;
  }
  if (!selectedSlug.value) {
    pageError.value = 'No docset selected';
    return;
  }

  searchQuery.value = '';
  searchResults.value = [];
  hasSelection.value = false;
  pageError.value = '';
  pageLoading.value = true;
  currentPageHtml.value = null;

  if (!window.terminal?.docsPage) {
    pageError.value = 'docsPage API not available';
    pageLoading.value = false;
    return;
  }

  try {
    const result = await window.terminal.docsPage(selectedSlug.value, entry.path);
    if (result.ok && result.html) {
      currentPageHtml.value = result.html;
      let md;
      try {
        md = turndown.turndown(result.html);
      } catch (err) {
        console.error('[docs] HTML to markdown conversion failed:', err.message);
        md = result.html; // fallback to raw HTML
      }
      currentPageMarkdown.value = renderMarkdown(md);
      nextTick(() => {
        if (pageView.value) pageView.value.scrollTop = 0;
      });
    } else {
      pageError.value = result.error || 'Failed to load page: no content returned';
    }
  } catch (err) {
    pageError.value = err.message || 'Unknown error loading page';
  } finally {
    pageLoading.value = false;
  }
}

// ---- Text selection → feed button ----
function onTextSelection() {
  const selection = window.getSelection();
  if (!selection) {
    hasSelection.value = false;
    return;
  }

  try {
    const text = selection.toString().trim();
    hasSelection.value = text.length > 0;
  } catch (err) {
    hasSelection.value = false;
  }
}

function feedToNyx() {
  if (!hasSelection.value) return;

  const selection = window.getSelection();
  if (!selection) return;

  const text = selection.toString().trim();
  if (!text) return;

  emit('feed', text);
  hasSelection.value = false;
  try {
    selection.removeAllRanges();
  } catch (err) {
    // ignore
  }
}

// ---- Available ----
async function loadAvailable() {
  if (!window.terminal?.docsAvailable) {
    console.error('[docs] docsAvailable API not available');
    return;
  }

  availableLoading.value = true;
  try {
    const result = await window.terminal.docsAvailable(null);
    if (result.ok && Array.isArray(result.docsets)) {
      availableDocsets.value = result.docsets;
    } else {
      console.error('[docs] Failed to load available:', result.error || 'unknown');
      availableDocsets.value = [];
    }
  } catch (err) {
    console.error('[docs] Error loading available:', err.message);
    availableDocsets.value = [];
  } finally {
    availableLoading.value = false;
  }
}

function onFilterAvailable() {
  clearTimeout(filterDebounce);
  filterDebounce = setTimeout(async () => {
    if (!window.terminal?.docsAvailable) {
      availableLoading.value = false;
      return;
    }

    availableLoading.value = true;
    try {
      const filter = availableFilter.value.trim() || null;
      const result = await window.terminal.docsAvailable(filter);
      if (result.ok && Array.isArray(result.docsets)) {
        availableDocsets.value = result.docsets;
      } else {
        availableDocsets.value = [];
        console.error('[docs] Filter failed:', result.error || 'unknown');
      }
    } catch (err) {
      availableDocsets.value = [];
      console.error('[docs] Filter error:', err.message);
    } finally {
      availableLoading.value = false;
    }
  }, 300);
}

async function installDocset(slug) {
  if (!slug) return;
  if (!window.terminal?.docsInstall) {
    alert('docsInstall API not available');
    return;
  }

  installingSlug.value = slug;
  installStatus.value = 'downloading...';

  let unsub = null;
  try {
    unsub = window.terminal?.onDocsProgress?.((data) => {
      if (data && data.slug === slug) {
        installStatus.value = data.status || 'working...';
      }
    });

    const result = await window.terminal.docsInstall(slug);
    if (result.ok) {
      refreshInstalled();
    } else {
      alert(`Failed to install: ${result.error || 'unknown error'}`);
    }
  } catch (err) {
    alert(`Error installing: ${err.message}`);
  } finally {
    installingSlug.value = null;
    installStatus.value = '';
    if (unsub) try { unsub(); } catch (_) {}
  }
}

// ---- Lifecycle ----
onMounted(() => {
  refreshInstalled();
});
</script>

<style scoped>
.doc-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  flex: 0 0 auto;
  background: var(--bg-soft);
  border-left: 1px solid var(--border);
  overflow: hidden;
}

/* ---- Header ---- */
.doc-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px 0 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
  height: 32px;
}
.doc-tabs {
  display: flex;
  gap: 2px;
}
.doc-tab {
  background: transparent;
  border: none;
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 6px 10px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.15s;
}
.doc-tab:hover {
  color: var(--text);
}
.doc-tab.active {
  color: var(--cyan);
  border-bottom-color: var(--cyan);
}
.doc-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}
.doc-close {
  background: transparent;
  border: none;
  color: var(--text-dim);
  font-size: 18px;
  cursor: pointer;
  padding: 2px 8px;
  line-height: 1;
  transition: color 0.15s;
}
.doc-close:hover {
  color: var(--cyan);
}

/* ---- Content ---- */
.doc-content {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.doc-empty {
  padding: 24px 16px;
  text-align: center;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.8;
}
.doc-empty .hl {
  color: var(--cyan);
  cursor: pointer;
  text-decoration: underline;
}
.doc-empty.err {
  color: #ff5f56;
}

/* ---- Docset list ---- */
.docset-list {
  padding: 6px 8px;
}
.docset-item {
  display: flex;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s;
  position: relative;
}
.docset-item:hover {
  border-color: var(--border);
  background: rgba(0, 229, 255, 0.04);
}
.docset-info {
  flex: 1 1 auto;
  min-width: 0;
}
.docset-name {
  font-size: 13px;
  color: var(--text);
}
.docset-meta {
  font-size: 11px;
  color: var(--text-dim);
  margin-top: 2px;
}
.docset-remove {
  flex: 0 0 auto;
  margin-left: auto;
  background: transparent;
  border: none;
  color: var(--text-dim);
  font-size: 16px;
  cursor: pointer;
  padding: 0 4px;
  opacity: 0;
  transition: opacity 0.15s;
}
.docset-item:hover .docset-remove {
  opacity: 1;
}
.docset-remove:hover {
  color: #ff5f56;
}

/* ---- Docset toolbar ---- */
.docset-toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
}
.back-btn {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--cyan);
  font-family: var(--mono);
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
}
.back-btn:hover {
  background: rgba(0, 229, 255, 0.08);
}
.docset-title {
  font-size: 12px;
  color: var(--text);
  font-weight: bold;
}

/* ---- Search bar ---- */
.search-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  gap: 6px;
}
.search-icon {
  color: var(--text-dim);
  font-size: 14px;
}
.search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text);
  font-family: var(--mono);
  font-size: 12px;
  caret-color: var(--cyan);
}
.search-input::placeholder {
  color: var(--text-dim);
}

/* ---- Search results / entry list ---- */
.search-results {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
.search-result-item,
.entry-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px;
  cursor: pointer;
  border-left: 2px solid transparent;
  transition: all 0.1s;
}
.search-result-item:hover,
.entry-item:hover {
  background: rgba(0, 229, 255, 0.06);
  border-left-color: var(--cyan);
}
.entry-name {
  font-size: 12px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.entry-type {
  font-size: 10px;
  color: var(--cyan-dim);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex: 0 0 auto;
  margin-left: 8px;
}
.entry-loading {
  padding: 16px 12px;
  text-align: center;
  color: var(--text-dim);
  font-size: 11px;
}

/* ---- Split view ---- */
.doc-split {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
  position: relative;
}
.entry-list {
  flex: 0 0 40%;
  min-width: 120px;
  max-width: 200px;
  overflow-y: auto;
  border-right: 1px solid var(--border);
}
/* Collapse bar on top of entry list */
.entry-collapse-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}
.entry-collapse-label {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 1px;
}
.entry-collapse-btn {
  background: transparent;
  border: none;
  color: var(--text-dim);
  font-size: 11px;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
  transition: color 0.15s;
}
.entry-collapse-btn:hover {
  color: var(--cyan);
}
/* Expand bar when entry list is collapsed */
.entry-expand-bar {
  display: inline-block;
  padding: 3px 10px;
  margin-bottom: 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-left: none;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 1px;
  cursor: pointer;
  transition: all 0.15s;
}
.entry-expand-bar:hover {
  color: var(--cyan);
  border-color: var(--cyan);
  background: rgba(0, 229, 255, 0.05);
}
/* When collapsed, page view takes full width */
.doc-split.entry-collapsed .page-view {
  flex: 1 1 100%;
}
.type-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 4px 6px;
  border-bottom: 1px solid var(--border);
}
.type-chip {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 9px;
  padding: 1px 5px;
  cursor: pointer;
  text-transform: lowercase;
}
.type-chip:hover {
  border-color: var(--cyan-dim);
  color: var(--text);
}
.type-chip.active {
  background: rgba(0, 229, 255, 0.1);
  border-color: var(--cyan);
  color: var(--cyan);
}

/* ---- Page view ---- */
.page-view {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 12px 14px;
  position: relative;
  word-wrap: break-word;
  overflow-wrap: break-word;
}
.page-content {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text);
  max-width: 100%;
  overflow-wrap: break-word;
  word-wrap: break-word;
}
.page-content :deep(p) {
  margin: 0 0 6px;
  overflow-wrap: break-word;
}
.page-content :deep(h1),
.page-content :deep(h2),
.page-content :deep(h3) {
  margin-top: 14px;
  margin-bottom: 4px;
  overflow-wrap: break-word;
}
.page-content :deep(h1:first-child),
.page-content :deep(h2:first-child),
.page-content :deep(h3:first-child) {
  margin-top: 0;
}
/* Code blocks: scroll horizontally instead of breaking layout */
.page-content :deep(pre) {
  overflow-x: auto;
  max-width: 100%;
  white-space: pre;
}
.page-content :deep(code) {
  word-break: break-word;
  overflow-wrap: break-word;
}
.page-content :deep(pre code) {
  white-space: pre;
  word-break: normal;
}
/* Tables: allow horizontal scroll if too wide */
.page-content :deep(table) {
  display: block;
  overflow-x: auto;
  max-width: 100%;
}
/* Images: scale to container */
.page-content :deep(img) {
  max-width: 100%;
  height: auto;
}
/* Lists: don't overflow */
.page-content :deep(ul),
.page-content :deep(ol) {
  padding-left: 20px;
  margin: 0 0 6px;
  overflow-wrap: break-word;
}
/* Links: break long URLs */
.page-content :deep(a) {
  word-break: break-all;
  overflow-wrap: break-word;
}

/* ---- Feed button in search bar ---- */
.feed-bar-btn {
  flex: 0 0 auto;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 10px;
  padding: 2px 8px;
  cursor: not-allowed;
  text-transform: lowercase;
  letter-spacing: 0.5px;
  transition: all 0.15s;
}
.feed-bar-btn.active {
  border-color: var(--cyan);
  color: var(--cyan);
  cursor: pointer;
  background: rgba(0, 229, 255, 0.05);
}
.feed-bar-btn.active:hover {
  background: rgba(0, 229, 255, 0.15);
  box-shadow: 0 0 6px var(--cyan-glow);
}
.feed-bar-btn:disabled {
  opacity: 0.4;
}

/* ---- Available tab ---- */
.install-btn {
  background: transparent;
  border: 1px solid var(--cyan);
  color: var(--cyan);
  font-family: var(--mono);
  font-size: 10px;
  padding: 3px 10px;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex: 0 0 auto;
  transition: all 0.15s;
}
.install-btn:hover:not(:disabled) {
  background: rgba(0, 229, 255, 0.1);
  box-shadow: 0 0 6px var(--cyan-glow);
}
.install-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.installed-badge {
  font-size: 10px;
  color: #27c93f;
  flex: 0 0 auto;
}

/* ---- Custom modal ---- */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-box {
  background: var(--bg);
  border: 1px solid var(--border);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8), 0 0 1px var(--cyan-dim);
  padding: 24px 28px 20px;
  min-width: 280px;
  max-width: 380px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.modal-icon {
  font-size: 28px;
  color: var(--text-dim);
  margin-bottom: 12px;
  line-height: 1;
}
.modal-title {
  font-family: var(--mono);
  font-size: 13px;
  color: var(--text);
  text-transform: lowercase;
  letter-spacing: 0.5px;
  margin-bottom: 10px;
  font-weight: bold;
}
.modal-message {
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.6;
  margin-bottom: 20px;
}
.modal-message :deep(b) {
  color: var(--text);
  font-weight: bold;
}
.modal-detail {
  font-size: 11px;
  color: var(--text-dim);
  opacity: 0.7;
}
.modal-actions {
  display: flex;
  gap: 10px;
  width: 100%;
}
.modal-btn {
  flex: 1;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 11px;
  padding: 6px 12px;
  cursor: pointer;
  text-transform: lowercase;
  letter-spacing: 0.5px;
  transition: all 0.15s;
}
.modal-btn:hover:not(:disabled) {
  border-color: var(--text-dim);
  color: var(--text);
}
.modal-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.modal-confirm {
  border-color: var(--cyan);
  color: var(--cyan);
}
.modal-confirm:hover:not(:disabled) {
  background: rgba(0, 229, 255, 0.1);
  box-shadow: 0 0 6px var(--cyan-glow);
}
.modal-confirm.danger {
  border-color: #ff5f56;
  color: #ff5f56;
}
.modal-confirm.danger:hover:not(:disabled) {
  background: rgba(255, 95, 86, 0.1);
  box-shadow: 0 0 6px rgba(255, 95, 86, 0.3);
}

/* Modal transition */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.15s;
}
.modal-fade-enter-active .modal-box,
.modal-fade-leave-active .modal-box {
  transition: transform 0.15s, opacity 0.15s;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
.modal-fade-enter-from .modal-box,
.modal-fade-leave-to .modal-box {
  transform: scale(0.95);
  opacity: 0;
}
</style>
