/**
 * MCP Client - Model Context Protocol 客户端
 *
 * 支持:
 * - MCP (Model Context Protocol)
 * - JSON-RPC 2.0
 * - Remote Tools
 * - Tool Discovery
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

/**
 * MCP 工具定义
 */
export class MCPTool {
  constructor(data) {
    this.name = data.name;
    this.description = data.description;
    this.inputSchema = data.inputSchema || {};
    this.outputSchema = data.outputSchema || {};
    this.annotations = data.annotations || {};
  }
}

/**
 * MCP 资源定义
 */
export class MCPResource {
  constructor(data) {
    this.uri = data.uri;
    this.name = data.name;
    this.description = data.description;
    this.mimeType = data.mimeType;
  }
}

/**
 * MCP 客户端基类
 */
export class MCPClient extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      timeout: config.timeout || 30000,
      retries: config.retries || 3,
      ...config,
    };
    this.tools = new Map();
    this.resources = new Map();
    this.servers = new Map();
    this.isConnected = false;
  }

  /**
   * 连接到 MCP 服务器
   */
  async connect(name, config = {}) {
    if (typeof name !== 'string') {
      throw new Error('connect(name, config) requires a server name');
    }

    if (this.servers.has(name)) {
      await this.disconnect(name);
    }

    const client = new STDIOMCPClient(config);
    await client.connect();

    try {
      await client.discoverTools();
    } catch (error) {
      this.emit('warning', new Error(`Failed to discover tools for ${name}: ${error.message}`));
    }

    try {
      await client.discoverResources();
    } catch (error) {
      this.emit('warning', new Error(`Failed to discover resources for ${name}: ${error.message}`));
    }

    this.servers.set(name, client);
    this.isConnected = this.servers.size > 0;
    this.emit('serverConnected', name);
    return true;
  }

  /**
   * 断开连接
   */
  async disconnect(name) {
    if (!name) {
      await Promise.all([...this.servers.keys()].map((serverName) => this.disconnect(serverName)));
      return;
    }

    const client = this.servers.get(name);
    if (!client) {
      return;
    }

    await client.disconnect();
    this.servers.delete(name);
    this.isConnected = this.servers.size > 0;
    this.emit('serverDisconnected', name);
  }

  /**
   * 释放所有 MCP 连接资源
   */
  async dispose() {
    await this.disconnect();
    this.removeAllListeners();
  }

  getConnectedServers() {
    return [...this.servers.keys()];
  }

  getTools() {
    return [...this.servers.entries()].flatMap(([serverName, client]) =>
      [...client.tools.values()].map((tool) => ({
        ...tool,
        serverName,
        fullName: `${serverName}/${tool.name}`,
      })),
    );
  }

  getResources() {
    return [...this.servers.entries()].flatMap(([serverName, client]) =>
      [...client.resources.values()].map((resource) => ({
        ...resource,
        serverName,
        fullName: `${serverName}/${resource.name || resource.uri}`,
      })),
    );
  }

  #splitQualifiedName(fullName) {
    const [serverName, ...nameParts] = String(fullName).split('/');
    const itemName = nameParts.join('/');
    if (!serverName || !itemName) {
      throw new Error(`Expected name in "server/name" format, got "${fullName}"`);
    }
    return { serverName, itemName };
  }

  /**
   * 发送 JSON-RPC 请求
   */
  async sendRequest(method, params = {}) {
    const request = {
      jsonrpc: '2.0',
      id: randomUUID(),
      method,
      params,
    };

    return this.#sendRawRequest(request);
  }

  /**
   * 发送原始请求 (子类实现)
   */
  async #sendRawRequest(request) {
    throw new Error('#sendRawRequest() must be implemented by subclass');
  }

  /**
   * 发现工具
   */
  async discoverTools() {
    const response = await this.sendRequest('tools/list');

    if (response.error) {
      throw new Error(`Failed to discover tools: ${response.error.message}`);
    }

    const tools = response.result?.tools || [];

    for (const toolData of tools) {
      const tool = new MCPTool(toolData);
      this.tools.set(tool.name, tool);
    }

    this.emit('tools:discovered', this.tools);
    return this.tools;
  }

  /**
   * 调用工具
   */
  async callTool(name, args = {}) {
    if (this.servers.size > 0 && String(name).includes('/')) {
      const { serverName, itemName } = this.#splitQualifiedName(name);
      const client = this.servers.get(serverName);
      if (!client) {
        throw new Error(`MCP server '${serverName}' is not connected`);
      }
      return client.callTool(itemName, args);
    }

    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool '${name}' not found`);
    }

    const response = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    });

    if (response.error) {
      throw new Error(`Tool call failed: ${response.error.message}`);
    }

    return response.result;
  }

  /**
   * 发现资源
   */
  async discoverResources() {
    const response = await this.sendRequest('resources/list');

    if (response.error) {
      throw new Error(`Failed to discover resources: ${response.error.message}`);
    }

    const resources = response.result?.resources || [];

    for (const resourceData of resources) {
      const resource = new MCPResource(resourceData);
      this.resources.set(resource.uri, resource);
    }

    this.emit('resources:discovered', this.resources);
    return this.resources;
  }

  /**
   * 读取资源
   */
  async readResource(uri) {
    if (this.servers.size > 0 && String(uri).includes('/')) {
      const { serverName, itemName } = this.#splitQualifiedName(uri);
      const client = this.servers.get(serverName);
      if (!client) {
        throw new Error(`MCP server '${serverName}' is not connected`);
      }
      return client.readResource(itemName);
    }

    const response = await this.sendRequest('resources/read', { uri });

    if (response.error) {
      throw new Error(`Failed to read resource: ${response.error.message}`);
    }

    return response.result;
  }

  /**
   * 获取提示模板
   */
  async getPrompt(name, args = {}) {
    const response = await this.sendRequest('prompts/get', {
      name,
      arguments: args,
    });

    if (response.error) {
      throw new Error(`Failed to get prompt: ${response.error.message}`);
    }

    return response.result;
  }
}

/**
 * HTTP MCP 客户端
 */
export class HTTPMCPClient extends MCPClient {
  constructor(config) {
    super(config);
    this.baseUrl = config.baseUrl;
    this.headers = config.headers || {};
  }

  async connect() {
    // HTTP 是无状态的，不需要持久连接
    this.isConnected = true;
    this.emit('connected');
  }

  async disconnect() {
    this.isConnected = false;
    this.emit('disconnected');
  }

  async #sendRawRequest(request) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }
}

/**
 * WebSocket MCP 客户端
 */
export class WebSocketMCPClient extends MCPClient {
  constructor(config) {
    super(config);
    this.wsUrl = config.wsUrl;
    this.ws = null;
    this.pendingRequests = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const WebSocketCtor = globalThis.WebSocket;
      if (!WebSocketCtor) {
        reject(new Error('WebSocket is not available in this JavaScript runtime'));
        return;
      }

      this.ws = new WebSocketCtor(this.wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.emit('connected');
        resolve();
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.emit('disconnected');
      };

      this.ws.onerror = (error) => {
        reject(error);
      };

      this.ws.onmessage = (event) => {
        const response = JSON.parse(event.data);
        const pending = this.pendingRequests.get(response.id);

        if (pending) {
          pending.resolve(response);
          this.pendingRequests.delete(response.id);
        }
      };
    });
  }

  async disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }

  async #sendRawRequest(request) {
    if (!this.isConnected) {
      throw new Error('Not connected');
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error('Request timeout'));
      }, this.config.timeout);

      this.pendingRequests.set(request.id, {
        resolve: (response) => {
          clearTimeout(timeoutId);
          resolve(response);
        },
      });

      this.ws.send(JSON.stringify(request));
    });
  }
}

/**
 * STDIO MCP 客户端 (用于本地进程)
 */
export class STDIOMCPClient extends MCPClient {
  constructor(config) {
    super(config);
    this.command = config.command;
    this.args = config.args || [];
    this.env = config.env || {};
    this.process = null;
    this.buffer = '';
    this.pendingRequests = new Map();
  }

  async connect() {
    const { spawn } = await import('child_process');

    this.process = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.env },
    });

    this.process.stdout.on('data', (data) => {
      this.buffer += data.toString();
      this.#processBuffer();
    });

    this.process.on('error', (error) => {
      this.emit('error', error);
    });

    this.process.on('close', () => {
      this.isConnected = false;
      this.emit('disconnected');
    });

    this.isConnected = true;
    this.emit('connected');
  }

  async disconnect() {
    if (this.process) {
      this.process.kill();
    }
  }

  #processBuffer() {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop(); // 保留不完整的行

    for (const line of lines) {
      if (line.trim()) {
        try {
          const response = JSON.parse(line);
          const pending = this.pendingRequests.get(response.id);

          if (pending) {
            pending.resolve(response);
            this.pendingRequests.delete(response.id);
          }
        } catch (e) {
          // 忽略非 JSON 行
        }
      }
    }
  }

  async #sendRawRequest(request) {
    if (!this.isConnected) {
      throw new Error('Not connected');
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error('Request timeout'));
      }, this.config.timeout);

      this.pendingRequests.set(request.id, {
        resolve: (response) => {
          clearTimeout(timeoutId);
          resolve(response);
        },
      });

      this.process.stdin.write(JSON.stringify(request) + '\n');
    });
  }
}

/**
 * MCP 工具适配器 (将 MCP 工具转换为内部工具格式)
 */
export class MCPToolAdapter {
  constructor(mcpClient) {
    this.client = mcpClient;
  }

  /**
   * 将 MCP 工具转换为内部工具格式
   */
  adaptTool(mcpTool) {
    return {
      name: mcpTool.name,
      description: mcpTool.description,
      parameters: this.#convertSchema(mcpTool.inputSchema),
      handler: async (args) => {
        return this.client.callTool(mcpTool.name, args);
      },
    };
  }

  /**
   * 转换 JSON Schema
   */
  #convertSchema(schema) {
    // 简化转换，实际可能需要更复杂的映射
    return {
      type: 'object',
      properties: schema.properties || {},
      required: schema.required || [],
    };
  }

  /**
   * 获取所有适配后的工具
   */
  async getAllTools() {
    const tools = await this.client.discoverTools();
    const adapted = [];

    for (const mcpTool of tools.values()) {
      adapted.push(this.adaptTool(mcpTool));
    }

    return adapted;
  }
}

export default {
  MCPClient,
  HTTPMCPClient,
  WebSocketMCPClient,
  STDIOMCPClient,
  MCPToolAdapter,
  MCPTool,
  MCPResource,
};
