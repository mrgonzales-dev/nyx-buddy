const path = require('path');
const fs = require('fs');

const MODEL_PATH = path.join(__dirname, '..', 'resources', 'models', 'qwen2.5-coder-1.5b-instruct-q4_k_m.gguf');
const SYSTEM_PROMPT = 'You are Nyx, a local AI dev companion running inside a terminal-based app called nyx-dev. You help developers with code, syntax, and concepts. Keep responses concise and terminal-friendly. You are a guide, not an agent — the user writes the code, you help them understand.';

let llamaModule = null;
let llama = null;
let model = null;
let session = null;
let context = null;
let sequence = null;
let chatWrapper = null;
let loadingPromise = null;
let currentSequence = null; // tracks the active generation for stop()

const MODEL_META = {
  name: 'qwen2.5-coder:1.5b-instruct',
  quant: 'Q4_K_M',
  size: '1.1 GB',
};

function getModelMeta() {
  return MODEL_META;
}

function isLoaded() {
  return session !== null;
}

function isLoading() {
  return loadingPromise !== null;
}

async function ensureModel(onStatus) {
  if (session) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      // Validate model file exists before attempting to load
      if (!fs.existsSync(MODEL_PATH)) {
        throw new Error(`Model file not found: ${MODEL_PATH}`);
      }

      const stats = fs.statSync(MODEL_PATH);
      if (stats.size === 0) {
        throw new Error(`Model file is empty: ${MODEL_PATH}`);
      }

      // node-llama-cpp is ESM-only, must use dynamic import
      if (!llamaModule) {
        try {
          llamaModule = await import('node-llama-cpp');
        } catch (err) {
          throw new Error(`Failed to import node-llama-cpp: ${err.message}`);
        }
      }

      const { getLlama, LlamaChatSession, JinjaTemplateChatWrapper } = llamaModule;
      if (!getLlama || !LlamaChatSession || !JinjaTemplateChatWrapper) {
        throw new Error('node-llama-cpp is missing required exports');
      }

      if (onStatus) onStatus('initializing llama.cpp...');
      try {
        llama = await getLlama();
      } catch (err) {
        throw new Error(`Failed to initialize llama.cpp: ${err.message}`);
      }
      if (!llama) throw new Error('getLlama() returned null');

      if (onStatus) onStatus('loading model from disk...');
      try {
        model = await llama.loadModel({ modelPath: MODEL_PATH });
      } catch (err) {
        throw new Error(`Failed to load model: ${err.message}`);
      }
      if (!model) throw new Error('loadModel() returned null');

      // CRITICAL: use the model's own Jinja chat template, not auto-detected wrapper
      const jinjaTemplate = model.fileInfo?.metadata?.tokenizer?.chat_template;
      if (!jinjaTemplate) {
        throw new Error('Model has no chat_template in metadata — cannot create chat session');
      }

      try {
        chatWrapper = new JinjaTemplateChatWrapper({
          template: jinjaTemplate,
          tokenizer: model.tokenizer,
          functionCallMessageTemplate: 'auto',
        });
      } catch (err) {
        throw new Error(`Failed to create chat wrapper: ${err.message}`);
      }
      if (!chatWrapper) throw new Error('Chat wrapper is null after creation');

      try {
        context = await model.createContext();
      } catch (err) {
        throw new Error(`Failed to create context: ${err.message}`);
      }
      if (!context) throw new Error('createContext() returned null');

      sequence = context.getSequence();
      if (!sequence) throw new Error('getSequence() returned null');

      try {
        session = new LlamaChatSession({
          contextSequence: sequence,
          chatWrapper,
          systemPrompt: SYSTEM_PROMPT,
          contextShift: { size: 512 },
        });
      } catch (err) {
        throw new Error(`Failed to create chat session: ${err.message}`);
      }
      if (!session) throw new Error('Chat session is null after creation');

      if (onStatus) onStatus('model ready');
    } catch (err) {
      // Clean up partial state on failure
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

function cleanResponse(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/g, '')
    .replace(/<function=[^>]+>[\s\S]*?<\/function>/g, '')
    .trim();
}

function getContextUsage() {
  if (!sequence) return { used: 0, total: 0 };
  try {
    const used = sequence.contextTokens?.length ?? 0;
    const total = sequence.context?.contextSize ?? 0;
    return { used, total };
  } catch (err) {
    console.error('[llm] Failed to get context usage:', err.message);
    return { used: 0, total: 0 };
  }
}

async function chat(userText, onChunk, options) {
  if (!userText || typeof userText !== 'string') {
    throw new Error('Invalid input: userText must be a non-empty string');
  }

  try {
    await ensureModel();
  } catch (err) {
    throw new Error(`Model not available: ${err.message}`);
  }

  if (!session) throw new Error('Model not loaded: session is null');

  const temp = (options && typeof options.temperature === 'number') ? options.temperature : 0.4;

  let response;
  try {
    currentSequence = sequence;
    response = await session.promptWithMeta(userText, {
      temperature: temp,
      maxTokens: 768,
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
    currentSequence = null;
    throw new Error(`Generation failed: ${err.message}`);
  }

  currentSequence = null;

  if (!response) throw new Error('Generation returned null response');
  if (!response.responseText && response.responseText !== '') {
    throw new Error('Generation returned invalid response: missing responseText');
  }

  return cleanResponse(response.responseText);
}

async function stop() {
  if (currentSequence) {
    try {
      await currentSequence.stopGeneration();
    } catch (err) {
      console.error('[llm] Failed to stop generation:', err.message);
    }
    currentSequence = null;
  }
}

// ---- Context compaction ----

const COMPACT_THRESHOLD = 0.8;  // auto-compact at 80% usage
const COMPACT_MIN_USAGE = 0.2;  // don't compact if under 20% (not enough to bother)

function getContextPercent() {
  const { used, total } = getContextUsage();
  if (total === 0) return 0;
  return used / total;
}

function shouldAutoCompact() {
  return getContextPercent() >= COMPACT_THRESHOLD;
}

function canCompact() {
  return getContextPercent() >= COMPACT_MIN_USAGE;
}

async function compact(onChunk) {
  if (!session) throw new Error('Model not loaded: session is null');
  if (!canCompact()) throw new Error('Not enough context to compact');

  // Get current history before resetting
  let history = [];
  try {
    history = session.getChatHistory();
  } catch (err) {
    throw new Error(`Failed to get chat history: ${err.message}`);
  }

  if (!history || history.length === 0) {
    throw new Error('No chat history to compact');
  }

  // Build a summary prompt from the conversation history
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

  // Ask the model to summarize the conversation
  const summaryPrompt = `Summarize the following conversation concisely. Keep key technical details, code snippets, decisions, and context. Be brief but complete.\n\nConversation:\n${conversationText}\n\nSummary:`;

  let summary = '';
  try {
    currentSequence = sequence;
    const response = await session.promptWithMeta(summaryPrompt, {
      temperature: 0.3,
      maxTokens: 512,
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
    currentSequence = null;
    throw new Error(`Summary generation failed: ${err.message}`);
  }

  currentSequence = null;

  if (!summary) {
    throw new Error('Summary generation returned empty response');
  }

  // Reset the chat history and set the summary as the new system context
  try {
    session.resetChatHistory();
  } catch (err) {
    throw new Error(`Failed to reset chat history: ${err.message}`);
  }

  // Inject the summary as a system/context message by prompting it
  // The new session starts fresh with the original system prompt,
  // so we add the summary as the first user-assistant exchange
  try {
    const contextPrompt = `Previous conversation summary (for context):\n${summary}\n\nContinue helping the user based on this context.`;
    await session.promptWithMeta(contextPrompt, {
      temperature: 0.3,
      maxTokens: 64,  // short acknowledgment
    });
  } catch (err) {
    // Non-fatal: the history is already reset, we just couldn't inject the summary
    console.error('[llm] Failed to inject summary after reset:', err.message);
  }

  const usage = getContextUsage();
  return { summary, usage };
}

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
