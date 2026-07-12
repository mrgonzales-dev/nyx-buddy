import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/core';
import { LANGUAGES } from './markdownLanguages.js';

// Static imports (Vite target doesn't support top-level await)
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import markdown from 'highlight.js/lib/languages/markdown';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import go from 'highlight.js/lib/languages/go';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import java from 'highlight.js/lib/languages/java';
import shell from 'highlight.js/lib/languages/shell';
import diff from 'highlight.js/lib/languages/diff';

const MODULES = {
  javascript,  typescript,
  python,      rust,
  bash,        json,
  xml,         css,
  markdown,    sql,
  yaml,        go,
  c,           cpp,
  java,        shell,
  diff,
};

// Register all languages from config
for (const { key, aliases } of LANGUAGES) {
  const mod = MODULES[key];
  if (!mod) continue;
  for (const alias of aliases) {
    hljs.registerLanguage(alias, mod);
  }
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: false,
  highlight(str, lang) {
    if (typeof str !== 'string') return '';
    if (lang && hljs.getLanguage(lang)) {
      try {
        const highlighted = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
        return `<pre class="code-block"><div class="code-header"><span class="code-lang">${md.utils.escapeHtml(lang)}</span><button class="code-copy-btn" onclick="copyCodeBlock(this)">copy</button></div><code class="hljs">${highlighted}</code></pre>`;
      } catch (err) {
        console.error('[markdown] Highlight failed for lang "%s": %s', lang, err.message);
      }
    }
    // No language specified — try auto-detection
    try {
      const auto = hljs.highlightAuto(str);
      if (auto.language && auto.relevance >= 5) {
        return `<pre class="code-block"><div class="code-header"><span class="code-lang">${md.utils.escapeHtml(auto.language)}</span><button class="code-copy-btn" onclick="copyCodeBlock(this)">copy</button></div><code class="hljs">${auto.value}</code></pre>`;
      }
    } catch (err) {
      // fall through to plain
    }
    return `<pre class="code-block"><div class="code-header"><span class="code-lang">text</span><button class="code-copy-btn" onclick="copyCodeBlock(this)">copy</button></div><code class="hljs">${md.utils.escapeHtml(str)}</code></pre>`;
  },
});

// Global copy handler — attached to window so inline onclick can reach it
window.copyCodeBlock = function (btn) {
  const pre = btn.closest('.code-block');
  if (!pre) return;
  const code = pre.querySelector('code');
  if (!code) return;
  const text = code.textContent || '';
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = 'copied';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'copy';
      btn.classList.remove('copied');
    }, 1500);
  }).catch(() => {
    btn.textContent = 'failed';
    setTimeout(() => { btn.textContent = 'copy'; }, 1500);
  });
};

export function renderMarkdown(text) {
  if (!text || typeof text !== 'string') return '';
  try {
    return md.render(text);
  } catch (err) {
    console.error('[markdown] render failed:', err.message);
    return md.utils.escapeHtml(text);
  }
}
