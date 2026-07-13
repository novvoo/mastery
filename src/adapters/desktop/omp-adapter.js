import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getEventBus } from '../../runtime/event-bus.js';
import { RuntimeEvent } from '../../runtime/types.js';

const BUN_PATH = process.env.BUN_PATH || 'bun';

function extractMessageText(message) {
  if (!message || !Array.isArray(message.content)) return '';
  return message.content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

function extractToolResultText(result) {
  if (typeof result === 'string') return result;
  if (Array.isArray(result?.content)) {
    return result.content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n');
  }
  return result?.error || JSON.stringify(result ?? 'Tool execution failed');
}

function resolveOmpCliPath() {
  if (process.env.OMP_CLI_PATH) {
    return process.env.OMP_CLI_PATH;
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const searchPaths = [
    path.resolve(__dirname, '../../../node_modules/@oh-my-pi/pi-coding-agent'),
    path.resolve(process.cwd(), 'node_modules/@oh-my-pi/pi-coding-agent'),
  ];

  for (const pkgRoot of searchPaths) {
    const pkgPath = path.join(pkgRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const binEntry = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.omp;
      if (binEntry) {
        const cliPath = path.join(pkgRoot, binEntry);
        if (fs.existsSync(cliPath)) {
          return cliPath;
        }
      }
    }
  }

  throw new Error(
    '未找到 @oh-my-pi/pi-coding-agent 包，请运行: npm add @oh-my-pi/pi-coding-agent，或设置 OMP_CLI_PATH 环境变量指定 CLI 路径'
  );
}

export class OmpAdapter {
  #config;
  #child;
  #eventBus;
  #requestId;
  #pendingRequests;
  #buffer;
  #isReady;
  #isRunning;
  #state;
  #customTools;
  #currentSessionId;
  #disposed;
  #lastAssistantText;
  #pendingInteractions;
  #availableCommands;

  constructor(config = {}) {
    this.#config = {
      workingDirectory: process.cwd(),
      debug: false,
      ...config,
    };
    this.#eventBus = getEventBus();
    this.#requestId = 0;
    this.#pendingRequests = new Map();
    this.#buffer = '';
    this.#isReady = false;
    this.#isRunning = false;
    this.#state = {};
    this.#customTools = new Map();
    this.#currentSessionId = null;
    this.#disposed = false;
    this.#lastAssistantText = '';
    this.#pendingInteractions = new Map();
    this.#availableCommands = [];
  }

  async initialize() {
    if (this.#isReady) return;

    if (this.#config.debug) {
      console.log('[OmpAdapter] Initializing omp RPC mode...');
    }

    const cliPath = this.#config.ompCliPath || resolveOmpCliPath();
    if (this.#config.debug) {
      console.log('[OmpAdapter] CLI path:', cliPath);
    }

    this.#child = spawn(BUN_PATH, [cliPath, '--mode', 'rpc'], {
      cwd: this.#config.workingDirectory,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.#child.stdout.on('data', (data) => this.#onStdout(data));
    this.#child.stderr.on('data', (data) => this.#onStderr(data));
    this.#child.on('exit', (code) => this.#onExit(code));
    this.#child.on('error', (err) => this.#onError(err));

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for omp ready signal'));
      }, 30000);

      const checkReady = () => {
        if (this.#isReady) {
          clearTimeout(timeout);
          resolve();
        }
      };

      const interval = setInterval(() => {
        if (this.#isReady) {
          clearInterval(interval);
          clearTimeout(timeout);
          resolve();
        }
      }, 100);

      setTimeout(() => clearInterval(interval), 30000);
    });

    await this.#refreshState();
    await this.#sendCommand({ type: 'set_subagent_subscription', level: 'events' }).catch(() => {});

    if (this.#customTools.size > 0) {
      await this.#sendCommand({
        type: 'set_host_tools',
        tools: Array.from(this.#customTools.values()).map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      }).catch(() => {});
    }
  }

  async #refreshState() {
    try {
      const state = await this.#sendCommand({ type: 'get_state' });
      this.#state = state || {};
      if (state?.sessionId) {
        this.#currentSessionId = state.sessionId;
      }
      return state;
    } catch (e) {
      if (this.#config.debug) {
        console.log('[OmpAdapter] refreshState failed:', e.message);
      }
      return null;
    }
  }

  #onStdout(data) {
    this.#buffer += data.toString();
    let idx;
    while ((idx = this.#buffer.indexOf('\n')) !== -1) {
      const line = this.#buffer.slice(0, idx).trim();
      this.#buffer = this.#buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        this.#handleMessage(msg);
      } catch (e) {
        if (this.#config.debug) {
          console.log('[OmpAdapter] parse error:', line.slice(0, 100));
        }
      }
    }
  }

  #onStderr(data) {
    if (this.#config.debug) {
      process.stderr.write(`[omp-stderr] ${data}`);
    }
  }

  #onExit(code) {
    this.#isReady = false;
    this.#isRunning = false;
    if (this.#config.debug) {
      console.log(`[OmpAdapter] omp exited with code ${code}`);
    }
    this.#eventBus.emit(RuntimeEvent.AGENT_STOP, { code, timestamp: Date.now() });

    for (const [id, req] of this.#pendingRequests) {
      req.reject(new Error(`omp exited with code ${code}`));
    }
    this.#pendingRequests.clear();
    this.#pendingInteractions.clear();
  }

  #onError(err) {
    if (this.#config.debug) {
      console.error('[OmpAdapter] process error:', err);
    }
  }

  #handleMessage(msg) {
    const type = msg.type;

    if (this.#config.debug) {
      if (type !== 'message_update') {
        console.log('[OmpAdapter] ←', type, msg.id || '');
      }
    }

    if (type === 'ready') {
      this.#isReady = true;
      this.#eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
        status: 'ready',
        timestamp: Date.now(),
      });
      return;
    }

    if (type === 'response') {
      const req = this.#pendingRequests.get(msg.id);
      if (req) {
        this.#pendingRequests.delete(msg.id);
        if (msg.success) {
          req.resolve(msg.data);
        } else {
          req.reject(new Error(msg.error || 'Unknown error'));
        }
      }
      return;
    }

    this.#mapAndEmitEvent(msg);
  }

  #mapAndEmitEvent(msg) {
    const eventBus = this.#eventBus;
    const timestamp = Date.now();

    switch (msg.type) {
      case 'agent_start':
        this.#isRunning = true;
        this.#lastAssistantText = '';
        eventBus.emit(RuntimeEvent.AGENT_START, { timestamp, ...msg });
        break;

      case 'agent_end':
        this.#isRunning = false;
        eventBus.emit(RuntimeEvent.AGENT_COMPLETE, {
          answer: this.#lastAssistantText,
          phase: 'final_answer',
          terminal: true,
          timestamp,
        });
        eventBus.emit(RuntimeEvent.AGENT_STOP, { timestamp, ...msg });
        break;

      case 'turn_start':
        eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
          status: 'running',
          phase: 'thinking',
          timestamp,
        });
        break;

      case 'turn_end':
        eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
          status: 'running',
          phase: 'turn_end',
          timestamp,
        });
        break;

      case 'message_start':
        // 仅在 agent_start 未先发射时才映射到 AGENT_START
        // 避免 GUI 收到重复的 start 事件导致状态重置
        if (msg.message?.role === 'assistant' && !this.#isRunning) {
          eventBus.emit(RuntimeEvent.AGENT_START, { timestamp, ...msg });
        }
        break;

      case 'message_end':
        if (msg.message?.role === 'assistant') {
          this.#lastAssistantText = extractMessageText(msg.message) || this.#lastAssistantText;
        }
        break;

      case 'message_update': {
        const update = msg.assistantMessageEvent;
        if (update?.type === 'text_delta' && update.delta) {
          this.#lastAssistantText += update.delta;
          eventBus.emit(RuntimeEvent.AGENT_TEXT_DELTA, {
            text: update.delta,
            timestamp,
          });
        }
        if (update?.type === 'thinking_delta' && update.delta) {
          eventBus.emit(RuntimeEvent.AGENT_REASONING_DELTA, {
            text: update.delta,
            timestamp,
          });
        }
        if (update?.type === 'toolcall_delta') {
          eventBus.emit(RuntimeEvent.AGENT_TOOL_CALL_DELTA, {
            text: update.delta,
            contentIndex: update.contentIndex,
            timestamp,
          });
        }
        break;
      }

      case 'tool_execution_start':
        eventBus.emit(RuntimeEvent.TOOL_CALL, {
          name: msg.toolName,
          arguments: msg.args || {},
          toolCallId: msg.toolCallId,
          timestamp,
        });
        break;

      case 'tool_execution_end':
        if (msg.isError) {
          eventBus.emit(RuntimeEvent.TOOL_ERROR, {
            name: msg.toolName,
            error: extractToolResultText(msg.result),
            toolCallId: msg.toolCallId,
            timestamp,
          });
        } else {
          eventBus.emit(RuntimeEvent.TOOL_RESULT, {
            name: msg.toolName,
            result: msg.result,
            toolCallId: msg.toolCallId,
            timestamp,
          });
        }
        break;

      case 'tool_execution_update':
        eventBus.emit(RuntimeEvent.TOOL_PROGRESS, {
          name: msg.toolName,
          arguments: msg.args || {},
          result: msg.partialResult,
          toolCallId: msg.toolCallId,
          timestamp,
        });
        break;

      case 'host_tool_call':
        this.#handleHostToolCall(msg);
        break;

      case 'thinking_level_changed':
      case 'model_changed':
        if (msg.type === 'thinking_level_changed') this.#state.thinkingLevel = msg.thinkingLevel;
        if (msg.type === 'model_changed') this.#state.model = msg.model;
        eventBus.emit(RuntimeEvent.CONFIG_CHANGE, {
          key: msg.type,
          value: msg.thinkingLevel || msg.model,
          timestamp,
        });
        break;

      case 'available_commands_update':
        this.#availableCommands = msg.commands || [];
        break;

      case 'extension_ui_request': {
        if (msg.method === 'cancel') {
          this.#pendingInteractions.delete(msg.targetId);
          eventBus.emit(RuntimeEvent.AGENT_INTERACTION_CANCEL, { requestId: msg.targetId, timestamp });
          break;
        }
        if (['notify', 'setStatus', 'setWidget', 'setTitle', 'set_editor_text', 'open_url'].includes(msg.method)) {
          eventBus.emit(RuntimeEvent.CONFIG_CHANGE, { key: `extension_ui:${msg.method}`, value: msg, timestamp });
          break;
        }
        this.#pendingInteractions.set(msg.id, msg);
        eventBus.emit(RuntimeEvent.AGENT_INTERACTION_REQUEST, { ...msg, requestId: msg.id, timestamp });
        eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
          status: 'needs_user_input',
          data: normalizeInteractionRequest(msg),
          timestamp,
        });
        break;
      }

      case 'session_changed':
        this.#currentSessionId = msg.sessionId;
        this.#state.sessionId = msg.sessionId;
        this.#eventBus.emit(RuntimeEvent.SESSION_CHANGE, { ...msg, timestamp });
        this.#eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
          status: 'session_changed',
          sessionId: msg.sessionId,
          timestamp,
        });
        break;

      case 'subagent_lifecycle':
      case 'subagent_progress':
      case 'subagent_event':
        eventBus.emit(RuntimeEvent.SUBAGENT_UPDATE, { kind: msg.type, ...msg.payload, timestamp });
        break;

      case 'auto_compaction_start':
      case 'auto_compaction_end':
      case 'auto_retry_start':
      case 'auto_retry_end':
      case 'notice':
        eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
          status: this.#isRunning ? 'running' : 'ready',
          phase: msg.type,
          message: msg.message || msg.errorMessage || msg.finalError,
          data: msg,
          timestamp,
        });
        break;

      default:
        if (this.#config.debug) {
          console.log('[OmpAdapter] unhandled event:', msg.type);
        }
        break;
    }
  }

  #sendCommand(command) {
    const id = `omp_${++this.#requestId}`;
    const payload = { ...command, id };

    if (!this.#child || !this.#child.stdin.writable) {
      return Promise.reject(new Error('omp process not available'));
    }

    this.#child.stdin.write(JSON.stringify(payload) + '\n');

    return new Promise((resolve, reject) => {
      this.#pendingRequests.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.#pendingRequests.has(id)) {
          this.#pendingRequests.delete(id);
          reject(new Error(`Timeout waiting for response to ${command.type}`));
        }
      }, 120000);
    });
  }

  async processInput(input, options = {}) {
    if (!this.#isReady) {
      await this.initialize();
    }

    const inputStr = typeof input === 'string' ? input : String(input ?? '');

    if (this.#config.debug) {
      console.log('[OmpAdapter] processInput:', inputStr.slice(0, 50));
    }

    this.#eventBus.emit(RuntimeEvent.MESSAGE_RECEIVED, {
      text: inputStr,
      timestamp: Date.now(),
    });

    this.#isRunning = true;
    const completion = this.#waitForAgentEnd();

    try {
      const commandType = options.mode === 'steer' ? 'steer' : options.mode === 'follow_up' ? 'follow_up' : 'prompt';
      const promptResult = await this.#sendCommand({
        type: commandType,
        message: inputStr,
        images: options.images,
        ...(commandType === 'prompt' ? { streamingBehavior: options.streamingBehavior } : {}),
      });

      if (promptResult?.agentInvoked !== false) {
        await completion.promise;
      } else {
        completion.cancel();
      }

      await this.#refreshState();
      return { success: true, status: 'completed', answer: this.#lastAssistantText };
    } catch (error) {
      completion.cancel();
      this.#eventBus.emit(RuntimeEvent.AGENT_ERROR, {
        error: error.message,
        stack: error.stack,
        timestamp: Date.now(),
      });
      throw error;
    } finally {
      this.#isRunning = false;
    }
  }

  #waitForAgentEnd() {
    let cancel = () => {};
    const promise = new Promise((resolve, reject) => {
      let unsubStop;
      let unsubError;
      let timeout;

      const handleStop = () => {
        cleanup();
        resolve();
      };

      const handleError = (data) => {
        cleanup();
        reject(new Error(data.error || 'Agent error'));
      };

      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        if (unsubStop) unsubStop();
        if (unsubError) unsubError();
      };
      cancel = cleanup;

      unsubStop = this.#eventBus.subscribe(RuntimeEvent.AGENT_STOP, handleStop);
      unsubError = this.#eventBus.subscribe(RuntimeEvent.AGENT_ERROR, handleError);

      timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout waiting for agent to complete'));
      }, 600000);
    });
    return { promise, cancel };
  }

  stop() {
    if (this.#isRunning && this.#isReady) {
      this.#sendCommand({ type: 'abort' }).catch(() => {});
    }
    this.#isRunning = false;
  }

  async steer(message, images) {
    if (!this.#isReady) await this.initialize();
    return this.#sendCommand({ type: 'steer', message, images });
  }

  async followUp(message, images) {
    if (!this.#isReady) await this.initialize();
    return this.#sendCommand({ type: 'follow_up', message, images });
  }

  respondToInteraction(requestId, response = {}) {
    const request = this.#pendingInteractions.get(requestId);
    if (!request) throw new Error('交互请求已失效或不存在');
    let frame;
    if (response.cancelled) frame = { type: 'extension_ui_response', id: requestId, cancelled: true };
    else if (request.method === 'confirm') frame = { type: 'extension_ui_response', id: requestId, confirmed: Boolean(response.confirmed) };
    else frame = { type: 'extension_ui_response', id: requestId, value: String(response.value ?? '') };
    this.#writeFrame(frame);
    this.#pendingInteractions.delete(requestId);
    return { success: true };
  }

  getState() {
    return {
      status: this.#isReady ? (this.#isRunning ? 'running' : 'ready') : 'idle',
      sessionId: this.#currentSessionId,
      isStreaming: this.#isRunning,
      model: this.#state.model,
      thinkingLevel: this.#state.thinkingLevel,
      messageCount: this.#state.messageCount || 0,
      queuedMessageCount: this.#state.queuedMessageCount || 0,
      contextUsage: this.#state.contextUsage,
      pendingInteraction: this.#pendingInteractions.values().next().value || null,
      timestamp: Date.now(),
    };
  }

  getConfig() {
    return { ...this.#config };
  }

  getDebugMode() {
    return Boolean(this.#config.debug);
  }

  setDebugMode(enabled) {
    this.#config.debug = Boolean(enabled);
  }

  getEventBus() {
    return this.#eventBus;
  }

  getTools() {
    return Array.from(this.#customTools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  getAvailableCommands() {
    return [...this.#availableCommands];
  }

  registerTool(tool) {
    this.#customTools.set(tool.name, tool);

    if (this.#isReady && this.#customTools.size > 0) {
      this.#sendCommand({
        type: 'set_host_tools',
        tools: Array.from(this.#customTools.values()).map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      }).catch(() => {});
    }
  }

  registerTools(tools) {
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }

  async #handleHostToolCall(msg) {
    const tool = this.#customTools.get(msg.toolName);
    if (!tool) {
      this.#writeFrame({
        type: 'host_tool_result',
        id: msg.id,
        result: {
          content: [{ type: 'text', text: `Tool not found: ${msg.toolName}` }],
          isError: true,
        },
      });
      return;
    }

    try {
      const result = await tool.execute(msg.arguments);
      const text = typeof result === 'string' ? result : JSON.stringify(result);
      this.#writeFrame({
        type: 'host_tool_result',
        id: msg.id,
        result: {
          content: [{ type: 'text', text }],
        },
      });
    } catch (err) {
      this.#writeFrame({
        type: 'host_tool_result',
        id: msg.id,
        result: {
          content: [{ type: 'text', text: err.message || String(err) }],
          isError: true,
        },
      });
    }
  }

  #writeFrame(frame) {
    if (!this.#child || !this.#child.stdin.writable) return;
    this.#child.stdin.write(JSON.stringify(frame) + '\n');
  }

  getSessionId() {
    return this.#currentSessionId;
  }

  setSessionId(sessionId) {
    if (!this.#isReady) return;
    this.switchSession(sessionId).catch(() => {});
  }

  async flushSession() {
    if (!this.#isReady) return;
    await this.#refreshState();
  }

  async newSession() {
    if (!this.#isReady) throw new Error('Not ready');
    const result = await this.#sendCommand({ type: 'new_session' });
    await this.#refreshState();
    return result;
  }

  async switchSession(sessionPath) {
    if (!this.#isReady) throw new Error('Not ready');
    const result = await this.#sendCommand({
      type: 'switch_session',
      sessionPath,
    });
    await this.#refreshState();
    return result;
  }

  async setSessionName(name) {
    if (!this.#isReady) throw new Error('Not ready');
    const result = await this.#sendCommand({
      type: 'set_session_name',
      name,
    });
    return result;
  }

  async getSessionStats() {
    if (!this.#isReady) throw new Error('Not ready');
    return this.#sendCommand({ type: 'get_session_stats' });
  }

  async getMessages() {
    if (!this.#isReady) throw new Error('Not ready');
    const result = await this.#sendCommand({ type: 'get_messages' });
    return result?.messages || [];
  }

  listSessions() {
    const sessionFile = this.#state.sessionFile;
    if (!sessionFile) return [];
    const directory = path.dirname(sessionFile);
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => readSessionMetadata(path.join(directory, name)))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  deleteSession(sessionPath) {
    const absolute = path.resolve(sessionPath);
    const activeDirectory = this.#state.sessionFile ? path.dirname(this.#state.sessionFile) : null;
    if (!activeDirectory || path.dirname(absolute) !== activeDirectory) throw new Error('会话不属于当前工作区');
    if (absolute === this.#state.sessionFile) throw new Error('不能删除当前会话，请先切换会话');
    fs.rmSync(absolute, { force: true });
    fs.rmSync(absolute.slice(0, -'.jsonl'.length), { recursive: true, force: true });
    return { success: true };
  }

  async branchSession(entryId) {
    if (!this.#isReady) throw new Error('Not ready');
    return this.#sendCommand({
      type: 'branch',
      entryId,
    });
  }

  getSessionManager() {
    return {
      newSession: async () => this.newSession(),
      switchSession: async (sessionPath) => this.switchSession(sessionPath),
      setSessionName: async (name) => this.setSessionName(name),
      getSessionStats: async () => this.getSessionStats(),
      getMessages: async () => this.getMessages(),
      listSessions: () => this.listSessions(),
      deleteSession: (sessionPath) => this.deleteSession(sessionPath),
      branchSession: async (entryId) => this.branchSession(entryId),
      getCurrentSessionId: () => this.getSessionId(),
    };
  }

  getLSPManager() {
    return null;
  }

  getMcpClient() {
    return null;
  }

  async setWorkingDirectory(dir) {
    if (path.resolve(dir) === path.resolve(this.#config.workingDirectory)) return;
    await this.dispose();
    this.#disposed = false;
    this.#config.workingDirectory = dir;
    await this.initialize();
  }

  async getAvailableModels() {
    if (!this.#isReady) throw new Error('Not ready');
    return this.#sendCommand({ type: 'get_available_models' });
  }

  async setModel(provider, modelId) {
    if (!this.#isReady) throw new Error('Not ready');
    const result = await this.#sendCommand({
      type: 'set_model',
      provider,
      modelId,
    });
    await this.#refreshState();
    return result;
  }

  async cycleModel() {
    if (!this.#isReady) throw new Error('Not ready');
    const result = await this.#sendCommand({ type: 'cycle_model' });
    await this.#refreshState();
    return result;
  }

  async setThinkingLevel(level) {
    if (!this.#isReady) throw new Error('Not ready');
    return this.#sendCommand({
      type: 'set_thinking_level',
      level,
    });
  }

  async cycleThinkingLevel() {
    if (!this.#isReady) throw new Error('Not ready');
    return this.#sendCommand({ type: 'cycle_thinking_level' });
  }

  getCurrentModel() {
    return this.#state.model || null;
  }

  getThinkingLevel() {
    return this.#state.thinkingLevel || null;
  }

  async dispose() {
    this.#disposed = true;
    this.#isReady = false;
    this.#isRunning = false;

    if (this.#child) {
      this.#child.kill();
      this.#child = null;
    }

    for (const request of this.#pendingRequests.values()) request.reject(new Error('OMP adapter disposed'));
    this.#pendingRequests.clear();
    this.#pendingInteractions.clear();
  }
}

function readSessionMetadata(sessionPath) {
  try {
    const stat = fs.statSync(sessionPath);
    const lines = fs.readFileSync(sessionPath, 'utf8').split('\n').filter(Boolean);
    const entries = lines.slice(0, 30).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    const title = entries.find((entry) => entry.type === 'title')?.title;
    const session = entries.find((entry) => entry.type === 'session');
    const firstUser = entries.find((entry) => entry.type === 'message' && entry.message?.role === 'user');
    return {
      id: session?.id || path.basename(sessionPath, '.jsonl').split('_').at(-1),
      sessionPath,
      title: title || extractMessageText(firstUser?.message).slice(0, 48) || '未命名会话',
      createdAt: Date.parse(session?.timestamp || '') || stat.birthtimeMs,
      updatedAt: stat.mtimeMs,
      workingDirectory: session?.cwd || '',
      messageCount: lines.filter((line) => line.includes('"type":"message"')).length,
    };
  } catch {
    return null;
  }
}

function normalizeInteractionRequest(request) {
  return {
    requestId: request.id,
    method: request.method,
    title: request.title || '需要你的回答',
    message: request.message || request.placeholder || request.title || '',
    options: request.options || [],
    suggestions: request.options || [],
    question: request.message || request.title || '',
  };
}

export function createOmpAdapter(config = {}) {
  return new OmpAdapter(config);
}

export default OmpAdapter;
