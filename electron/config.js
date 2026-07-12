/**
 * config.js — Central configuration for the nyx-dev LLM engine
 */

const path = require('path');
const { app } = require('electron');

// Model lives in user data dir (writable, persists across updates)
// e.g. ~/.config/nyx-dev/models/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf
function getModelPath() {
  const manifest = require('./modelDownload').getManifest();
  return path.join(app.getPath('userData'), 'models', manifest.filename);
}

module.exports = {
  // Model file location (resolved at runtime, not at import time)
  get modelPath() {
    return getModelPath();
  },

  // System prompt — defines Nyx's identity and behavior
  systemPrompt: 'You are Nyx, a local AI dev companion running inside a terminal-based app called nyx-dev. You help developers with code, syntax, and concepts. Keep responses concise and terminal-friendly. You are a guide, not an agent — the user writes the code, you help them understand.',

  // Model metadata (displayed in the UI)
  modelMeta: {
    name: 'qwen2.5-coder:1.5b-instruct',
    quant: 'Q4_K_M',
    size: '1.1 GB',
  },

  // Context compaction thresholds
  compactThreshold: 0.8,  // auto-compact at 80% usage
  compactMinUsage: 0.2,   // don't compact if under 20%

  // Generation defaults
  defaultTemperature: 0.4,
  maxTokens: 768,

  // Compaction
  compactTemperature: 0.3,
  compactMaxTokens: 512,
  summaryPrompt: `Summarize the following conversation concisely. Keep key technical details, code snippets, decisions, and context. Be brief but complete.\n\nConversation:\n{conversationText}\n\nSummary:`,
  contextInjectPrompt: `Previous conversation summary (for context):\n{summary}\n\nContinue helping the user based on this context.`,
};
