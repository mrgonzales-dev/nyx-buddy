/**
 * Backend stress test for llmEngineV2.
 * Bypasses Electron entirely — talks to the engine directly.
 * Usage: node test/engine-test.js
 */
const llm = require('../electron/llmEngineV2');

const TEST_MESSAGES = [
  { input: 'Hello! Who are you?', expect: 'string' },
  { input: 'What is 2 + 2?', expect: 'contains:4' },
  { input: 'Write a one-line haiku about terminals.', expect: 'string' },
  { input: 'Name 3 colors.', expect: 'string' },
  { input: 'Say "pong" if you hear me.', expect: 'contains:pong' },
  { input: 'Show me a simple Python function that adds two numbers. Use a markdown code block.', expect: 'contains:def' },
  { input: 'List 3 terminal commands as a markdown numbered list.', expect: 'string' },
];

function ts() {
  return new Date().toISOString().split('T')[1].replace('Z', '');
}

function log(tag, msg) {
  console.log(`[${ts()}] [${tag}] ${msg}`);
}

async function run() {
  console.log('=== dev_labs engine stress test ===\n');

  // 1. Load model with status callbacks
  log('TEST', 'loading model...');
  const loadStart = Date.now();

  await llm.ensureModel((status) => {
    log('MODEL', status);
  });

  const loadMs = Date.now() - loadStart;
  log('TEST', `model loaded in ${(loadMs / 1000).toFixed(2)}s`);

  const meta = llm.getModelMeta();
  log('META', `${meta.name} | ${meta.quant} | ${meta.size}`);

  const usage0 = llm.getContextUsage();
  log('CTX', `${usage0.used} / ${usage0.total} tokens`);

  console.log('');

  // 2. Send test messages
  let passed = 0;
  let failed = 0;

  for (let i = 0; i < TEST_MESSAGES.length; i++) {
    const test = TEST_MESSAGES[i];
    log('TEST', `--- message ${i + 1}/${TEST_MESSAGES.length} ---`);
    log('USER', test.input);

    const chatStart = Date.now();
    let chunkCount = 0;
    let streamed = '';

    try {
      const response = await llm.chat(test.input, (chunk) => {
        chunkCount++;
        streamed += chunk;
        process.stdout.write(chunk);
      });

      const chatMs = Date.now() - chatStart;
      console.log(''); // newline after streaming
      log('RESP', `(${chunkCount} chunks, ${(chatMs / 1000).toFixed(2)}s)`);
      log('CLEAN', response);

      // Validate
      let ok = true;
      if (test.expect === 'string') {
        ok = response.length > 0;
      } else if (test.expect.startsWith('contains:')) {
        const needle = test.expect.split(':')[1].toLowerCase();
        ok = response.toLowerCase().includes(needle);
      }

      if (ok) {
        log('PASS', 'check passed');
        passed++;
      } else {
        log('FAIL', `expected ${test.expect}, got: "${response.slice(0, 80)}"`);
        failed++;
      }
    } catch (err) {
      log('ERROR', err.message);
      failed++;
    }

    const usage = llm.getContextUsage();
    log('CTX', `${usage.used} / ${usage.total} tokens (${((usage.used / usage.total) * 100).toFixed(1)}%)`);
    console.log('');
  }

  // 3. Summary
  console.log('=== results ===');
  log('SUMMARY', `${passed} passed, ${failed} failed, ${TEST_MESSAGES.length} total`);
  const usageFinal = llm.getContextUsage();
  log('CTX', `final: ${usageFinal.used} / ${usageFinal.total} tokens`);

  await llm.stop();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  log('FATAL', err.message);
  console.error(err);
  process.exit(1);
});
