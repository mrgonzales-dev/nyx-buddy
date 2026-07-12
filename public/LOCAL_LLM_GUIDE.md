# Building a Local LLM App Without Ollama

A guide for wiring a local LLM directly into an Electron app using `node-llama-cpp`, with working function calling and no external dependencies for your users.

---

## The Problem

Most local LLM apps depend on Ollama as a backend. That means your users need to:
1. Install Ollama
2. Download models through Ollama
3. Keep Ollama running in the background
4. Have Ollama's API available on a port

This is fine for developer tools, but terrible for shipping a standalone app to normal users. You want the model to just work when they open your app.

## The Solution

`node-llama-cpp` is a Node.js binding for `llama.cpp` — the same inference engine Ollama uses under the hood. It bundles the native binary, loads a GGUF model file directly, and runs inference in-process. No Ollama, no separate server, no port, no external dependencies.

Your distribution story becomes:
- **Electron app** bundles everything: `node-llama-cpp` native binary + GGUF model file + UI
- **Users just run the app** — the model loads from the bundled file
- **No external services required**

---

## Architecture

```
┌─────────────────────────────────────────┐
│              Electron App                │
│                                          │
│  ┌──────────┐    ┌───────────────────┐  │
│  │  Renderer │◄──►│  Main Process     │  │
│  │  (UI)     │ IPC│                   │  │
│  └──────────┘    │  ┌──────────────┐ │  │
│                  │  │ node-llama-cpp│ │  │
│                  │  │ (llama.cpp)   │ │  │
│                  │  └──────┬───────┘ │  │
│                  │         │         │  │
│                  │  ┌──────▼───────┐ │  │
│                  │  │  model.gguf  │ │  │
│                  │  │  (bundled)   │ │  │
│                  │  └──────────────┘ │  │
│                  └───────────────────┘  │
└─────────────────────────────────────────┘
```

- **Main process** loads the model, manages the chat session, runs inference
- **Renderer** sends user messages via IPC, receives streamed chunks back
- **Model file** ships inside the app bundle (e.g. `resources/models/`)

---

## Setup

### Install

```bash
npm install node-llama-cpp
```

`node-llama-cpp` downloads and builds `llama.cpp` as a native addon during install. No external binaries needed.

### Get a Model

Download a GGUF model file. For small on-device models, good options:
- **MiniCPM-V 4.6** (1.3B, vision + text, ~500MB Q4_K_M) — great for vision tasks
- **Qwen3.5-4B** (~3.4GB Q4_K_M) — strong function calling and reasoning
- **Llama 3.2-3B** — decent instruction following

Place it in your project: `resources/models/your-model.gguf`

---

## Core Backend Code

### 1. Load the Model

```typescript
import { getLlama, LlamaChatSession, JinjaTemplateChatWrapper } from 'node-llama-cpp'
import path from 'node:path'

const MODEL_PATH = path.join(__dirname, '../../resources/models/your-model.gguf')

let llama: Awaited<ReturnType<typeof getLlama>> | null = null
let model: LlamaModel | null = null
let session: LlamaChatSession | null = null

export async function ensureModel(): Promise<void> {
  if (session) return

  llama = await getLlama()
  model = await llama.loadModel({ modelPath: MODEL_PATH })

  // CRITICAL: Use the model's own Jinja template, not the auto-detected wrapper.
  // See "The Function Calling Trap" section below.
  const jinjaTemplate = model.fileInfo.metadata?.tokenizer?.chat_template
  if (!jinjaTemplate) throw new Error('Model has no chat_template in metadata')

  const chatWrapper = new JinjaTemplateChatWrapper({
    template: jinjaTemplate,
    tokenizer: model.tokenizer,
    functionCallMessageTemplate: 'auto'
  })

  const context = await model.createContext()
  const sequence = context.getSequence()
  session = new LlamaChatSession({
    contextSequence: sequence,
    chatWrapper,
    systemPrompt: 'You are a helpful assistant.'
  })
}
```

### 2. Define Functions (Tools)

```typescript
import { defineChatSessionFunction } from 'node-llama-cpp'

const functions = {
  do_something: defineChatSessionFunction({
    description: 'Clear description of what this function does and WHEN to use it.',
    params: {
      type: 'object',
      properties: {
        param1: { type: 'string', description: 'What this parameter is' }
      },
      required: ['param1']
    },
    async handler(params) {
      // Do your app logic here
      const result = await myAppLogic(params.param1)
      return result // String returned to the model as function result
    }
  })
}
```

### 3. Chat With Streaming

```typescript
export async function chat(
  userText: string,
  onChunk: (chunk: string) => void
): Promise<string> {
  await ensureModel()
  if (!session) throw new Error('Model not loaded')

  let fullResponse = ''

  const response = await session.promptWithMeta(userText, {
    functions,
    temperature: 0.4,
    maxTokens: 768,  // Generation limit, NOT context window size
    dryRepeatPenalty: {
      strength: 0.8,
      base: 1.75,
      allowedLength: 4,
      lastTokens: 256
    },
    onTextChunk(chunk) {
      onChunk(chunk)  // Stream tokens to UI as they arrive
    },
    onFunctionCallParamsChunk() {
      // Called as the model generates function call parameters
      // Good place to show a "calling function..." indicator
    }
  })

  // Check which functions were actually called
  const calledFunctions = response.response
    .filter((item) => isChatModelResponseFunctionCall(item))
    .map((item) => item.name)

  return response.responseText
}
```

### 4. Wire Up IPC (Electron)

```typescript
// main process
import { ipcMain } from 'electron'

ipcMain.handle('chat', async (event, userText: string) => {
  const response = await chat(userText, (chunk) => {
    event.sender.send('chat-chunk', chunk)  // stream to renderer
  })
  return response
})

// preload
contextBridge.exposeInMainWorld('api', {
  chat: (text: string) => ipcRenderer.invoke('chat', text),
  onChunk: (cb: (chunk: string) => void) => ipcRenderer.on('chat-chunk', (_, chunk) => cb(chunk))
})
```

---

## The Function Calling Trap

This is the single most important thing in this guide. Get this wrong and your model will hallucinate actions instead of calling functions.

### What Goes Wrong

`node-llama-cpp` auto-detects a "chat wrapper" based on the model's architecture. For Qwen-based models (Qwen, MiniCPM, etc.) it picks `QwenChatWrapper`, which uses a **JSON function call format**:

```
{"name": "clear_tasks", "arguments": {}}
```

But many models are trained to use an **XML-style function call format**:

```
<function=clear_tasks>
<parameter=param1>value</parameter>
</function>
```

The model doesn't "understand" functions — it pattern-matches on the exact text format it was trained with. When `node-llama-cpp` tells the model to use JSON format but the model was trained on XML format, the model:
1. Doesn't recognize the function call instructions
2. Falls back to plain text
3. Says "I did the thing" without actually calling the function
4. **Hallucinates success**

### The Fix

Use `JinjaTemplateChatWrapper` with the model's own Jinja chat template (stored in the GGUF file's metadata). This is the same template Ollama uses. It includes:
- The exact function call format the model was trained with
- The correct system prompt formatting for tools
- The correct thinking/reasoning block handling

```typescript
const jinjaTemplate = model.fileInfo.metadata?.tokenizer?.chat_template
const chatWrapper = new JinjaTemplateChatWrapper({
  template: jinjaTemplate,
  tokenizer: model.tokenizer,
  functionCallMessageTemplate: 'auto'  // extracts function format from template
})
```

You can verify it's working:
```typescript
console.log(chatWrapper.usingJinjaFunctionCallTemplate) // should be true
console.log(chatWrapper.settings.functions?.call?.prefix) // should match model's format
```

### Why This Works

The Jinja template is written by the model creators (e.g. OpenBMB for MiniCPM). It encodes:
- How tools are presented to the model (`<tools>...</tools>` blocks)
- How the model should call functions (`<function=name>` XML tags)
- How function results are fed back (`<tool_result>...</tool_result>` blocks)
- How thinking/reasoning blocks are handled (`<think>...</think>`)

`JinjaTemplateChatWrapper` with `functionCallMessageTemplate: 'auto'` extracts all of this from the template automatically.

---

## Key Settings

### maxTokens — Generation Limit, NOT Context Size

```typescript
// WRONG — this lets the model generate thousands of tokens, causing loops
maxTokens: model.trainContextSize  // e.g. 262144

// RIGHT — cap generation at a reasonable limit
maxTokens: 768  // enough for reasoning + function call + response
```

`maxTokens` controls how many tokens the model **generates** in one response. The context window (set when creating the context) controls how much history the model can **see**. These are different things.

### dryRepeatPenalty — Stop Repetition Loops

Small models can get stuck repeating the same phrase forever. DRY (Don't Repeat Yourself) penalty stops this:

```typescript
dryRepeatPenalty: {
  strength: 0.8,      // recommended value
  base: 1.75,         // exponential penalty base
  allowedLength: 4,   // allow short phrase repeats (natural language)
  lastTokens: 256     // only look at recent tokens
}
```

### temperature

- `0.2` — deterministic, good for tool use / structured output
- `0.4` — balanced, good for chat + function calling
- `0.8` — creative, good for brainstorming

---

## Context Window Management

The model has a fixed context window (e.g. 262144 tokens for MiniCPM-V 4.6). As the conversation grows, you'll eventually run out of space. Two approaches:

### Auto-Compact (Simple)

When context usage exceeds a threshold (e.g. 80%), summarize the conversation and reset:

```typescript
function getContextUsage() {
  if (!sequence) return { used: 0, total: 0 }
  return {
    used: sequence.contextTokens.length,
    total: sequence.context.contextSize
  }
}

async function autoCompact() {
  // 1. Get current conversation history
  const history = session.getChatHistory()
  const transcript = historyToText(history)

  // 2. Ask the model to summarize it
  const summary = await session.prompt(transcript, {
    temperature: 0.2,
    maxTokens: 256
  })

  // 3. Reset the session with summary baked into system prompt
  session.stop()
  const context = model.createContext()
  const sequence = context.getSequence()
  session = new LlamaChatSession({
    contextSequence: sequence,
    chatWrapper,  // reuse the same JinjaTemplateChatWrapper
    systemPrompt: `${SYSTEM_PROMPT}\n\n[Conversation summary: ${summary}]`
  })
}
```

### Context Shift (Built-in)

`node-llama-cpp` has built-in context shift that automatically removes old tokens when the context fills up. This is less intelligent than summarization but requires no extra code:

```typescript
const session = new LlamaChatSession({
  contextSequence: sequence,
  chatWrapper,
  contextShift: {
    size: 512  // remove 512 tokens at a time when context fills
  }
})
```

---

## Detecting Hallucinated Actions

Even with the Jinja template fix, small models may still claim they did something without calling a function. Add a safety net:

```typescript
import { isChatModelResponseFunctionCall } from 'node-llama-cpp'

// Patterns that suggest the model claims an action was performed
const ACTION_CLAIM_PATTERNS = [
  /\b(deleted|removed|cleared|added|created|updated|saved|sent)\b/i,
  /\b(done|done it|took care of|all set)\b/i
]

function responseClaimsAction(text: string): boolean {
  return ACTION_CLAIM_PATTERNS.some((p) => p.test(text))
}

function getCalledFunctions(response: any): string[] {
  return response.response
    .filter((item) => isChatModelResponseFunctionCall(item))
    .map((item) => item.name)
}

// After generating a response:
const calledFunctions = getCalledFunctions(response)
if (userWantsAction && calledFunctions.length === 0 && responseClaimsAction(responseText)) {
  // Model claimed an action but didn't call any function — retry with correction
  const correction = `You said "${responseText}" but did not call any function. Call the appropriate function now.`
  const retry = await session.promptWithMeta(correction, { functions, ... })
}
```

---

## Tool Description Best Practices

Small models are easily confused by similar functions. Write descriptions that explicitly say when NOT to use a function:

```typescript
// BAD — ambiguous, model doesn't know which to pick
delete_item: { description: 'Delete an item.' }
delete_items: { description: 'Delete multiple items.' }
clear_items: { description: 'Delete items with filters.' }

// GOOD — explicit about when to use each
delete_item: {
  description: 'Delete ONE item by ID. Do NOT use for "delete all" — use clear_items instead.'
}
delete_items: {
  description: 'Delete SPECIFIC items by IDs. You must provide IDs. Do NOT use for "delete all" — use clear_items instead.'
}
clear_items: {
  description: 'THE function for "delete all", "clear everything". Deletes ALL items if no filters given. This is the ONLY function that can delete all items without IDs.'
}
```

Also make handlers return errors that guide the model:

```typescript
async handler(params) {
  if (!params.ids || params.ids.length === 0) {
    return 'ERROR: No IDs provided. Use clear_items to delete all items.'
  }
  // ...
}
```

---

## Cleaning Model Output

Small models produce thinking blocks (`<think>...</think>`) and other artifacts. Clean them before showing to the user:

```typescript
function cleanResponse(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')  // remove thinking blocks
    .replace(/<think>[\s\S]*$/g, '')            // remove unclosed thinking
    .replace(/<function=[^>]+>[\s\S]*?<\/function>/g, '')  // remove leaked function calls
    .trim()
}
```

---

## Project Structure

```
my-app/
├── package.json
├── electron.vite.config.ts
├── resources/
│   └── models/
│       └── your-model.gguf          # bundled model file
├── src/
│   ├── main/
│   │   ├── index.ts                 # Electron main process entry
│   │   ├── llm.ts                   # Model loading, chat session, inference
│   │   └── tools.ts                 # Function definitions (defineChatSessionFunction)
│   ├── preload/
│   │   └── index.ts                 # IPC bridge
│   └── renderer/
│       └── src/
│           ├── index.html
│           ├── main.ts              # UI logic
│           └── style.css
└── electron-builder.yml             # packaging config (include model file!)
```

### electron-builder.yml — Include the Model

```yaml
extraResources:
  - from: "resources/models"
    to: "models"
    filter: ["**/*.gguf"]
```

This ensures the GGUF file ships inside the app bundle. Access it at runtime:

```typescript
import path from 'node:path'
const MODEL_PATH = path.join(process.resourcesPath, 'models', 'your-model.gguf')
// In development:
// const MODEL_PATH = path.join(__dirname, '../../resources/models/your-model.gguf')
```

---

## Summary

| Requirement | Solution |
|---|---|
| Local inference | `node-llama-cpp` (bundles `llama.cpp`) |
| No Ollama dependency | Model loaded directly from GGUF file |
| Working function calling | `JinjaTemplateChatWrapper` with model's own template |
| Stop repetition loops | `dryRepeatPenalty` |
| Cap response length | `maxTokens: 768` (not context size) |
| Context management | Auto-compact at 80% usage |
| Hallucination detection | Check `isChatModelResponseFunctionCall` on response |
| Ship model with app | `electron-builder` `extraResources` |

The key insight: **use the model's own Jinja chat template, not the library's auto-detected wrapper.** Everything else follows from that.
