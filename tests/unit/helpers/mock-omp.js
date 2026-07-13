#!/usr/bin/env node
/**
 * Mock OMP RPC server for integration testing.
 * Listens on stdin for JSON commands, responds on stdout.
 * Tracks internal state (sessionId, model, thinkingLevel).
 */

const args = process.argv.slice(2);
const isRpc = args.includes('--mode') && args[args.indexOf('--mode') + 1] === 'rpc';

if (!isRpc) {
  process.stderr.write('mock-omp: expected --mode rpc\n');
  process.exit(1);
}

// --- Tracked state ---
let state = {
  sessionId: 'mock-session-id',
  model: 'gpt-4o',
  thinkingLevel: 3,
  messageCount: 2,
  queuedMessageCount: 0,
  sessionFile: '/tmp/mock-session.jsonl',
};
// ---

process.stdin.setEncoding('utf-8');
let buffer = '';

// Signal readiness immediately
console.log(JSON.stringify({ type: 'ready' }));

process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      handleMessage(msg);
    } catch {
      // ignore parse errors
    }
  }
});

function handleMessage(msg) {
  switch (msg.type) {
    case 'get_state':
      respond(msg, { ...state });
      break;

    case 'set_subagent_subscription':
    case 'set_host_tools':
    case 'abort':
      respond(msg, { ok: true });
      break;

    case 'prompt':
    case 'steer':
    case 'follow_up':
      respond(msg, { agentInvoked: true });
      // Emit agent lifecycle events with delays to simulate real flow
      setTimeout(() => {
        console.log(JSON.stringify({ type: 'agent_start' }));
      }, 5);
      setTimeout(() => {
        console.log(JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: 'Hello from mock OMP!' },
        }));
      }, 10);
      setTimeout(() => {
        console.log(JSON.stringify({ type: 'agent_end' }));
      }, 15);
      break;

    case 'get_available_models':
      respond(msg, { models: ['gpt-4o', 'claude-3.5-sonnet', 'deepseek-chat'] });
      break;

    case 'get_session_stats':
      respond(msg, { messageCount: 5, tokensUsed: 1024 });
      break;

    case 'get_messages':
      respond(msg, {
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'hello' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'hi there' }] },
        ],
      });
      break;

    case 'new_session':
      state.sessionId = 'new-session-abc';
      respond(msg, { sessionId: state.sessionId });
      break;

    case 'switch_session':
      state.sessionId = msg.sessionPath || 'switched-session';
      respond(msg, { ok: true });
      break;

    case 'set_session_name':
      respond(msg, { ok: true });
      break;

    case 'cycle_model':
      state.model = state.model === 'gpt-4o' ? 'claude-3.5-sonnet' : 'gpt-4o';
      // Emit model_changed event
      setTimeout(() => {
        console.log(JSON.stringify({ type: 'model_changed', model: state.model }));
      }, 5);
      respond(msg, { ok: true });
      break;

    case 'set_model':
      if (msg.modelId) state.model = msg.modelId;
      respond(msg, { ok: true });
      break;

    case 'cycle_thinking_level':
      state.thinkingLevel = state.thinkingLevel >= 5 ? 1 : state.thinkingLevel + 1;
      setTimeout(() => {
        console.log(JSON.stringify({ type: 'thinking_level_changed', thinkingLevel: state.thinkingLevel }));
      }, 5);
      respond(msg, { ok: true });
      break;

    case 'set_thinking_level':
      state.thinkingLevel = msg.level ?? 3;
      respond(msg, { ok: true });
      break;

    case 'branch':
      respond(msg, { sessionId: 'branched-session-def' });
      break;

    default:
      respond(msg, { ok: true });
      break;
  }
}

function respond(msg, data) {
  console.log(JSON.stringify({ type: 'response', id: msg.id, success: true, data }));
}
