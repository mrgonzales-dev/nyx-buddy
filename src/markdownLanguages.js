/**
 * markdownLanguages.js — Language config for highlight.js
 * Each entry: { key: 'moduleKey', aliases: ['name1', 'name2', ...] }
 * The key maps to a static import in markdownEngine.js.
 * The first alias is the primary name, the rest are alternatives.
 */

export const LANGUAGES = [
  { key: 'javascript', aliases: ['javascript', 'js'] },
  { key: 'typescript', aliases: ['typescript', 'ts'] },
  { key: 'python',     aliases: ['python', 'py'] },
  { key: 'rust',       aliases: ['rust', 'rs'] },
  { key: 'bash',       aliases: ['bash', 'sh'] },
  { key: 'json',       aliases: ['json'] },
  { key: 'xml',        aliases: ['xml', 'html'] },
  { key: 'css',        aliases: ['css'] },
  { key: 'markdown',   aliases: ['markdown', 'md'] },
  { key: 'sql',        aliases: ['sql'] },
  { key: 'yaml',       aliases: ['yaml', 'yml', 'toml'] },
  { key: 'go',         aliases: ['go'] },
  { key: 'c',          aliases: ['c'] },
  { key: 'cpp',        aliases: ['cpp', 'c++'] },
  { key: 'java',       aliases: ['java'] },
  { key: 'shell',      aliases: ['shell'] },
  { key: 'diff',       aliases: ['diff'] },
];

