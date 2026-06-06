/**
 * MCP Tools Integration
 * MCP 工具集成 - 将 MCP 客户端功能暴露为 Agent 工具
 */

import { ToolCategory } from '../../core/types.js';

/**
 * 创建 MCP 工具集
 * @param {MCPClient} mcpClient - MCP 客户端实例
 * @returns {Array<Object>} 工具定义数组
 */
export function createMCPTools(mcpClient) {
  return [
    {
      name: 'mcp_connect',
      description: '连接到 MCP 服务器',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '服务器名称（用于后续引用）',
          },
          command: {
            type: 'string',
            description: '启动服务器的命令',
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: '命令参数',
            default: [],
          },
          env: {
            type: 'object',
            description: '环境变量',
            default: {},
          },
        },
        required: ['name', 'command'],
      },
      handler: async ({ name, command, args = [], env = {} }) => {
        try {
          const success = await mcpClient.connect(name, { command, args, env });
          return {
            success,
            message: success ? `Connected to MCP server: ${name}` : `Failed to connect to ${name}`,
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'mcp_disconnect',
      description: '断开与 MCP 服务器的连接',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '服务器名称',
          },
        },
        required: ['name'],
      },
      handler: async ({ name }) => {
        try {
          await mcpClient.disconnect(name);
          return {
            success: true,
            message: `Disconnected from MCP server: ${name}`,
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'mcp_list_servers',
      description: '列出已连接的 MCP 服务器',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        try {
          const servers = mcpClient.getConnectedServers();
          return {
            success: true,
            servers,
            count: servers.length,
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'mcp_list_tools',
      description: '列出所有可用的 MCP 工具',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        try {
          const tools = mcpClient.getTools();
          return {
            success: true,
            tools,
            count: tools.length,
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'mcp_list_resources',
      description: '列出所有可用的 MCP 资源',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        try {
          const resources = mcpClient.getResources();
          return {
            success: true,
            resources,
            count: resources.length,
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'mcp_call_tool',
      description: '调用 MCP 工具',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          toolName: {
            type: 'string',
            description: '工具名称（格式: serverName/toolName）',
          },
          args: {
            type: 'object',
            description: '工具参数',
            default: {},
          },
        },
        required: ['toolName'],
      },
      handler: async ({ toolName, args = {} }) => {
        try {
          const result = await mcpClient.callTool(toolName, args);
          return {
            success: true,
            result,
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'mcp_read_resource',
      description: '读取 MCP 资源',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          resourceName: {
            type: 'string',
            description: '资源名称（格式: serverName/resourceName）',
          },
        },
        required: ['resourceName'],
      },
      handler: async ({ resourceName }) => {
        try {
          const result = await mcpClient.readResource(resourceName);
          return {
            success: true,
            result,
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'mcp_status',
      description: '获取 MCP 客户端状态',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        try {
          const servers = mcpClient.getConnectedServers();
          const isConnected = typeof mcpClient.isConnected === 'function'
            ? mcpClient.isConnected()
            : Boolean(mcpClient.isConnected || servers.length > 0);
          const tools = mcpClient.getTools();
          const resources = mcpClient.getResources();

          return {
            success: true,
            isConnected,
            servers,
            toolCount: tools.length,
            resourceCount: resources.length,
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },
  ];
}

export default createMCPTools;
