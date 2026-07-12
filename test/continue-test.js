/**
 * Quick test: does auto-continue work with a long response?
 * Usage: node test/continue-test.js
 */

// Mock electron's app module before requiring the engine
const path = require('path');
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  if (id === 'electron') {
    return {
      app: {
        getPath: (name) => {
          if (name === 'userData') return path.join(__dirname, '..', 'resources');
          return '';
        },
        isReady: () => true,
      },
    };
  }
  return originalRequire.apply(this, arguments);
};

const llm = require('../electron/llmEngineV2');

async function run() {
  console.log('=== auto-continue test ===\n');

  llm.setNickname('test_user');
  console.log('[test] nickname set');

  console.log('[test] loading model...');
  await llm.ensureModel((status) => {
    console.log(`[model] ${status}`);
  });
  console.log('[test] model loaded\n');

  const prompt = `Solve both of these problems with complete code and explanations:

Problem 1 — Spreadsheet Formula Engine
Implement: func Evaluate(cells map[string]string) (map[string]int, error)
Each cell contains either a number like "42" or a formula like "=A1+B2", "=A1*3", "=(A1+B1)*C3"
Requirements: Support + - * /, parentheses, arbitrarily nested formulas, references to other cells, detect circular references, integer arithmetic, return an error on division by zero, evaluate each cell only once (memoization).
Example: A1=5, A2==A1+3, A3==A2*2, B1==(A3+A1)/3. Result: A1=5, A2=8, A3=16, B1=7.

Problem 2 — Mini Git Merge
Implement: func Merge(base, left, right string) (string, error)
Perform a three-way merge. If both left and right changed the same line differently, produce conflict markers.
Example: Base is "hello\\nworld\\nfoo", Left is "hello\\nWORLD\\nfoo", Right is "hello\\nworld\\nbar". Output: "hello\\nWORLD\\nbar".

Give me complete implementations in Go with detailed explanations.`;

  let chunkCount = 0;
  let fullResponse = '';

  console.log('[test] sending prompt...\n');
  const start = Date.now();

  const result = await llm.chat(prompt, (chunk) => {
    process.stdout.write(chunk);
    chunkCount++;
    fullResponse += chunk;
  }, { temperature: 0.4 });

  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  const wordCount = fullResponse.split(/\s+/).length;

  console.log('\n\n--- STATS ---');
  console.log(`time: ${elapsed}s`);
  console.log(`chunks: ${chunkCount}`);
  console.log(`words: ${wordCount}`);
  console.log(`chars: ${result.length}`);
  console.log(`ends with: "${result.slice(-80)}"`);

  const lastChar = result.trim().slice(-1);
  if (['.', '}', ')', '!', '`'].includes(lastChar)) {
    console.log('status: COMPLETE');
  } else {
    console.log('status: MAY BE TRUNCATED');
  }
}

run().catch((err) => {
  console.error('[test] FATAL:', err.message);
  process.exit(1);
});
