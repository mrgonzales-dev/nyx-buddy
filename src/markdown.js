import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/core';

// Register only common languages to keep bundle small
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

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('rs', rust);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('go', go);
hljs.registerLanguage('c', c);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c++', cpp);
hljs.registerLanguage('java', java);
hljs.registerLanguage('shell', shell);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('toml', yaml); // close enough for highlighting

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
        return `<pre class="code-block"><div class="code-header"><span class="code-lang">${md.utils.escapeHtml(lang)}</span></div><code class="hljs">${highlighted}</code></pre>`;
      } catch (err) {
        console.error('[markdown] Highlight failed for lang "%s": %s', lang, err.message);
        // fall through to plain code block
      }
    }
    return `<pre class="code-block"><code class="hljs">${md.utils.escapeHtml(str)}</code></pre>`;
  },
});

export function renderMarkdown(text) {
  if (!text || typeof text !== 'string') return '';
  try {
    return md.render(text);
  } catch (err) {
    console.error('[markdown] render failed:', err.message);
    return md.utils.escapeHtml(text);
  }
}
