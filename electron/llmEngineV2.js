/**
 * llmEngineV2.js — Local LLM engine (v2)
 *
 * Wraps node-llama-cpp to provide:
 *   - model loading (GGUF)
 *   - chat with streaming
 *   - context compaction
 *   - context usage tracking
 *   - stop generation
 *
 * Architecture:
 *   llmEngineV2.js  →  node-llama-cpp (JS)  →  llama-addon.node  →  libllama.so  →  libggml.so
 *                     (this file)           (native bridge)        (inference)      (tensor math)
 */

const path = require('path');
const fs = require('fs');
const config = require('./config');

// ---- Imports (from node-llama-cpp, loaded via dynamic import) ----
// These are resolved at runtime in ensureModel() because node-llama-cpp is ESM-only.
let getLlama = null;
let LlamaChatSession = null;
let JinjaTemplateChatWrapper = null;

// ---- Constants (from config) ----
const SYSTEM_PROMPT = config.systemPrompt;
const MODEL_META = config.modelMeta;
const COMPACT_THRESHOLD = config.compactThreshold;
const COMPACT_MIN_USAGE = config.compactMinUsage;
const DEFAULT_TEMP = config.defaultTemperature;
const MAX_TOKENS = config.maxTokens;
const COMPACT_TEMP = config.compactTemperature;
const COMPACT_MAX_TOKENS = config.compactMaxTokens;
const SUMMARY_PROMPT = config.summaryPrompt;
const CONTEXT_INJECT_PROMPT = config.contextInjectPrompt;

// ---- State (module-level, persists across calls) ----
let llamaModule = null;  // the ESM module
let llama = null;        // native llama.cpp instance
let model = null;        // loaded GGUF model
let session = null;      // chat session (holds conversation history)
let context = null;      // context window (RAM allocation)
let sequence = null;     // generation sequence
let chatWrapper = null;  // Jinja chat template wrapper
let loadingPromise = null;       // prevents double-loading
let abortController = null;       // used to stop generation

// ---- Functions (stubs — to be implemented) ----

/**
 * Returns the model metadata (name, quant, size).
 * Used by the UI to display model info in the title bar.
 */
function getModelMeta() {
  return MODEL_META;
}

/**
 * Returns true if the model is loaded and the session is ready.
 */
function isLoaded() {
  return session !== null;
}

/**
 * Returns true if the model is currently loading.
 */
function isLoading() {
  return loadingPromise !== null;
}

/**
 * Loads the GGUF model from disk and creates a chat session.
 * Idempotent — safe to call multiple times, only loads once.
 *
 * Steps:
 *   1. Validate model file exists
 *   2. Dynamic import node-llama-cpp (ESM-only)
 *   3. getLlama() — load the native llama.cpp binary
 *   4. llama.loadModel() — read GGUF into RAM
 *   5. Extract Jinja chat template from model metadata
 *   6. Create JinjaTemplateChatWrapper
 *   7. model.createContext() — allocate context window
 *   8. context.getSequence() — get generation handle
 *   9. new LlamaChatSession() — create the chat session
 *
 * @param {function} onStatus — callback for status updates ("loading model from disk...")
 * @returns {Promise<void>}
 */
async function ensureModel(onStatus) {
  if (session) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      const MODEL_PATH = config.modelPath;

      if (!fs.existsSync(MODEL_PATH)) {
        throw new Error(`Model file not found: ${MODEL_PATH}`);
      }

      const stats = fs.statSync(MODEL_PATH);
      if (stats.size === 0) {
        throw new Error(`Model file is empty: ${MODEL_PATH}`);
      }

      if (!llamaModule) {
        try {
          llamaModule = await import('node-llama-cpp');
        } catch (err) {
          throw new Error(`Failed to import node-llama-cpp: ${err.message}`);
        }
      }

      getLlama = llamaModule.getLlama;
      LlamaChatSession = llamaModule.LlamaChatSession;
      JinjaTemplateChatWrapper = llamaModule.JinjaTemplateChatWrapper;

      if (!getLlama || !LlamaChatSession || !JinjaTemplateChatWrapper) {
        throw new Error('node-llama-cpp is missing required exports');
      }

      if (onStatus) onStatus('initializing llama.cpp...');
      llama = await getLlama();
      if (!llama) throw new Error('getLlama() returned null');

      if (onStatus) onStatus('loading model from disk...');
      model = await llama.loadModel({ modelPath: MODEL_PATH });
      if (!model) throw new Error('loadModel() returned null');

      const jinjaTemplate = model.fileInfo?.metadata?.tokenizer?.chat_template;
      if (!jinjaTemplate) {
        throw new Error('Model has no chat_template in metadata — cannot create chat session');
      }

      chatWrapper = new JinjaTemplateChatWrapper({
        template: jinjaTemplate,
        tokenizer: model.tokenizer,
        functionCallMessageTemplate: 'auto',
      });
      if (!chatWrapper) throw new Error('Chat wrapper is null after creation');

      context = await model.createContext();
      if (!context) throw new Error('createContext() returned null');

      sequence = context.getSequence();
      if (!sequence) throw new Error('getSequence() returned null');

      session = new LlamaChatSession({
        contextSequence: sequence,
        chatWrapper,
        systemPrompt: SYSTEM_PROMPT,
        contextShift: { size: 512 },
      });
      if (!session) throw new Error('Chat session is null after creation');

      if (onStatus) onStatus('model ready');
    } catch (err) {
      session = null;
      sequence = null;
      context = null;
      model = null;
      llama = null;
      chatWrapper = null;
      throw err;
    } finally {
      loadingPromise = null;
    }
  })();

  return loadingPromise;
}

/**
 * Returns the current context window usage.
 *   { used: number, total: number }
 * used = tokens currently in the context window
 * total = max context window size
 */
function getContextUsage() {
  if (!sequence) return { used: 0, total: 0 };
  try {
    const used = sequence.contextTokens?.length ?? 0;
    const total = sequence.contextSize ?? 0;
    return { used, total };
  } catch (err) {
    console.error('[llm] Failed to get context usage:', err.message);
    return { used: 0, total: 0 };
  }
}

/**
 * Returns the context usage as a percentage (0.0 to 1.0).
 */
function getContextPercent() {
  const { used, total } = getContextUsage();
  if (total === 0) return 0;
  return used / total;
}

/**
 * Returns true if context usage is ≥ 80% — triggers auto-compact.
 */
function shouldAutoCompact() {
  return getContextPercent() >= COMPACT_THRESHOLD;
}

/**
 * Returns true if context usage is ≥ 20% — manual compact is allowed.
 */
function canCompact() {
  return getContextPercent() >= COMPACT_MIN_USAGE;
}

/**
 * Sends a message to the model and streams the response back token by token.
 *
 * @param {string} userText — the user's message
 * @param {function} onChunk — callback fired for each generated token (streaming)
 * @param {object} options — { temperature: number }
 * @returns {Promise<string>} — the full cleaned response text
 */
async function chat(userText, onChunk, options) {
  if (!userText || typeof userText !== 'string') {
    throw new Error('Invalid input: userText must be a non-empty string');
  }

  await ensureModel();

  if (!session) throw new Error('Model not loaded: session is null');

  const temp = (options && typeof options.temperature === 'number') ? options.temperature : DEFAULT_TEMP;

  let response;
  try {
    abortController = new AbortController();
    response = await session.promptWithMeta(userText, {
      temperature: temp,
      maxTokens: MAX_TOKENS,
      signal: abortController.signal,
      stopOnAbortSignal: true,
      dryRepeatPenalty: {
        strength: 0.8,
        base: 1.75,
        allowedLength: 4,
        lastTokens: 256,
      },
      onTextChunk(chunk) {
        if (onChunk && typeof chunk === 'string') {
          try {
            onChunk(chunk);
          } catch (err) {
            console.error('[llm] onChunk callback error:', err.message);
          }
        }
      },
    });
  } catch (err) {
    abortController = null;
    throw new Error(`Generation failed: ${err.message}`);
  }

  abortController = null;

  if (!response) throw new Error('Generation returned null response');
  if (!response.responseText && response.responseText !== '') {
    throw new Error('Generation returned invalid response: missing responseText');
  }

  return cleanResponse(response.responseText);
}

/**
 * Stops the current generation immediately.
 */
function stop() {
  if (!abortController) return;
  try {
    abortController.abort();
  } catch (err) {
    console.error('[llm] Failed to abort generation:', err.message);
  }
  abortController = null;
}

/**
 * Compacts the conversation context:
 *   1. Get the current chat history
 *   2. Ask the model to summarize it
 *   3. Reset the chat history
 *   4. Inject the summary as new context
 *
 * This frees up context window space so the conversation can continue
 * without hitting the token limit.
 *
 * @param {function} onChunk — callback for summary generation chunks
 * @returns {Promise<{ summary: string, usage: object }>}
 */
async function compact(onChunk) {
  if (!session) throw new Error('Model not loaded: session is null');
  if (!canCompact()) throw new Error('Not enough context to compact');

  let history = [];
  try {
    history = session.getChatHistory();
  } catch (err) {
    throw new Error(`Failed to get chat history: ${err.message}`);
  }

  if (!history || history.length === 0) {
    throw new Error('No chat history to compact');
  }

  let conversationText = '';
  try {
    for (const item of history) {
      if (!item || typeof item !== 'object') continue;
      const role = item.role || 'unknown';
      const text = item.text || item.content || '';
      if (text) {
        conversationText += `${role}: ${text}\n`;
      }
    }
  } catch (err) {
    throw new Error(`Failed to serialize chat history: ${err.message}`);
  }

  if (!conversationText.trim()) {
    throw new Error('Chat history is empty after serialization');
  }

  const summaryPrompt = SUMMARY_PROMPT.replace('${conversationText}', conversationText);

  let summary = '';
  try {
    abortController = new AbortController();
    const response = await session.promptWithMeta(summaryPrompt, {
      temperature: COMPACT_TEMP,
      maxTokens: COMPACT_MAX_TOKENS,
      signal: abortController.signal,
      stopOnAbortSignal: true,
      onTextChunk(chunk) {
        if (onChunk && typeof chunk === 'string') {
          try {
            onChunk(chunk);
          } catch (err) {
            console.error('[llm] compact onChunk error:', err.message);
          }
        }
      },
    });
    summary = cleanResponse(response.responseText);
  } catch (err) {
    abortController = null;
    throw new Error(`Summary generation failed: ${err.message}`);
  }

  abortController = null;

  if (!summary) {
    throw new Error('Summary generation returned empty response');
  }

  try {
    session.resetChatHistory();
  } catch (err) {
    throw new Error(`Failed to reset chat history: ${err.message}`);
  }

  try {
    abortController = new AbortController();
    const contextPrompt = CONTEXT_INJECT_PROMPT.replace('${summary}', summary);
    await session.promptWithMeta(contextPrompt, {
      temperature: COMPACT_TEMP,
      maxTokens: 64,
      signal: abortController.signal,
      stopOnAbortSignal: true,
    });
  } catch (err) {
    console.error('[llm] Failed to inject summary after reset:', err.message);
  } finally {
    abortController = null;
  }

  const usage = getContextUsage();
  return { summary, usage };
}

/**
 * Strips internal model artifacts from the response:
 *   - <think> tags (reasoning)
 *   - <function=...> tags (tool calls)
 *
 * @param {string} text — raw model output
 * @returns {string} — cleaned text
 */
function cleanResponse(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/g, '')
    .replace(/<function=[^>]+>[\s\S]*?<\/function>/g, '')
    .trim();
}

// ---- Exports ----
module.exports = {
  ensureModel,
  isLoaded,
  isLoading,
  getModelMeta,
  getContextUsage,
  getContextPercent,
  shouldAutoCompact,
  canCompact,
  chat,
  stop,
  compact,
};
