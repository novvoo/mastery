/**
 * MCP Management Commands
 * MCP 管理命令 - 连接、断开、列表、工具调用等
 */

import { input, select } from '@inquirer/prompts';
import { enhancedUI, createTable, formatStatus, truncate } from '../enhanced-ui.js';
import { MCP_MENU_CHOICES } from '../enhanced-command-utils.js';

/**
 * 创建 MCP 管理命令
 * @param {Object} deps - 依赖项
 * @param {import('../../mcp/mcp-client.js').MCPClient} deps.mcpClient - MCP 客户端
 * @param {Function} [deps.registerMcpTools] - 注册 MCP 工具的函数
 * @returns {Object} MCP 管理命令方法
 */
export function createMcpCommands(deps) {
  const { mcpClient, registerMcpTools } = deps;
  const theme = enhancedUI.theme;

  return {
    /**
     * 处理 /mcp 命令
     * @param {string} args - 命令参数
     */
    async handleMcpCommand(args) {
      if (!mcpClient) {
        enhancedUI.error('MCP client not initialized');
        return;
      }

      if (typeof args === 'string') {
        args = args.split(/\s+/).filter(Boolean);
      }
      const subcommand = args[0];

      switch (subcommand) {
        case 'status':
          await this.mcpStatus();
          break;
        case 'list':
        case 'servers':
          await this.mcpListServers();
          break;
        case 'tools':
          await this.mcpListTools();
          break;
        case 'resources':
          await this.mcpListResources();
          break;
        case 'connect':
          await this.mcpConnect(args.slice(1));
          break;
        case 'disconnect':
          await this.mcpDisconnect(args.slice(1));
          break;
        case 'call':
          await this.mcpCallTool(args.slice(1));
          break;
        case 'menu':
          await this.showMcpMenu();
          break;
        default:
          if (!subcommand) {
            await this.mcpStatus();
          } else {
            enhancedUI.error(`Unknown mcp subcommand: ${subcommand}`);
            enhancedUI.info(
              'Available: status, list, tools, resources, connect, disconnect, call, menu',
            );
          }
      }
    },

    /**
     * MCP 交互式菜单
     */
    async showMcpMenu() {
      const action = await select({
        message: 'MCP Management:',
        choices: MCP_MENU_CHOICES,
      });

      if (action === 'back') {
        return;
      }
      await this.handleMcpCommand([action]);
    },

    async mcpStatus() {
      console.log(enhancedUI.createHeader('MCP Status'));

      const table = createTable({ colWidths: [25, 30] });
      table.push(
        [
          enhancedUI.theme.primaryBold('Connected'),
          (
            typeof mcpClient.isConnected === 'function'
              ? mcpClient.isConnected()
              : Boolean(mcpClient.isConnected || mcpClient.getConnectedServers().length > 0)
          )
            ? formatStatus('enabled')
            : formatStatus('disabled'),
        ],
        [enhancedUI.theme.primaryBold('Servers'), mcpClient.getConnectedServers().length],
        [enhancedUI.theme.primaryBold('Tools'), mcpClient.getTools().length],
        [enhancedUI.theme.primaryBold('Resources'), mcpClient.getResources().length],
      );
      console.log(table.toString());
      console.log('');
    },

    async mcpListServers() {
      const servers = mcpClient.getConnectedServers();
      console.log(enhancedUI.createHeader('MCP Servers'));

      if (servers.length === 0) {
        enhancedUI.info('No connected servers');
        return;
      }

      for (const name of servers) {
        console.log(theme.success('  ✓ ') + theme.white(name));
      }
      console.log('');
    },

    async mcpListTools() {
      const tools = mcpClient.getTools();
      console.log(enhancedUI.createHeader('MCP Tools'));

      if (tools.length === 0) {
        enhancedUI.info('No tools available (connect to an MCP server first)');
        return;
      }

      const table = createTable({
        head: ['Tool Name', 'Description'],
        colWidths: [35, 50],
      });
      for (const tool of tools) {
        table.push([
          theme.secondary(tool.fullName || tool.name),
          truncate(tool.description || '', 48),
        ]);
      }
      console.log(table.toString());
      console.log('');
    },

    async mcpListResources() {
      const resources = mcpClient.getResources();
      console.log(enhancedUI.createHeader('MCP Resources'));

      if (resources.length === 0) {
        enhancedUI.info('No resources available');
        return;
      }

      const table = createTable({
        head: ['Resource', 'Description', 'MIME Type'],
        colWidths: [30, 30, 25],
      });
      for (const resource of resources) {
        table.push([
          theme.secondary(resource.name),
          truncate(resource.description || '', 28),
          resource.mimeType || 'N/A',
        ]);
      }
      console.log(table.toString());
      console.log('');
    },

    async mcpConnect(args) {
      let name,
        command,
        cmdArgs = [],
        env = {};

      if (args.length >= 2) {
        name = args[0];
        command = args[1];
        cmdArgs = args.slice(2);
      } else {
        name = await input({
          message: 'Server name:',
          validate: (v) => v.trim() !== '' || 'Required',
        });
        command = await input({
          message: 'Command (e.g., npx, python):',
          validate: (v) => v.trim() !== '' || 'Required',
        });
        const argsStr = await input({
          message: 'Arguments (comma-separated):',
        });
        cmdArgs = argsStr
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }

      const spinner = enhancedUI.spinner(`Connecting to ${name}...`);
      spinner.start();
      try {
        const success = await mcpClient.connect(name, { command, args: cmdArgs, env });
        spinner.stop();
        if (success) {
          const registered = typeof registerMcpTools === 'function' ? registerMcpTools(name) : 0;
          enhancedUI.success(`Connected to MCP server: ${name}`);
          const tools = mcpClient
            .getTools()
            .filter((t) => t.serverName === name || t.fullName?.startsWith(name + '/'));
          if (tools.length > 0) {
            const registeredSuffix = registered ? `; registered ${registered} for agent use` : '';
            enhancedUI.info(
              `Loaded ${tools.length} tool(s): ${tools.map((t) => t.fullName || `${name}/${t.name}`).join(', ')}${registeredSuffix}`,
            );
          }
        } else {
          enhancedUI.error(`Failed to connect to ${name}`);
        }
      } catch (error) {
        spinner.stop();
        enhancedUI.error(`Connection error: ${error.message}`);
      }
    },

    async mcpDisconnect(args) {
      const servers = mcpClient.getConnectedServers();
      if (servers.length === 0) {
        enhancedUI.info('No connected servers');
        return;
      }

      let name = args[0];
      if (!name) {
        const selected = await select({
          message: 'Select server to disconnect:',
          choices: servers,
        });
        name = selected;
      }

      try {
        await mcpClient.disconnect(name);
        enhancedUI.success(`Disconnected from ${name}`);
      } catch (error) {
        enhancedUI.error(`Disconnect error: ${error.message}`);
      }
    },

    async mcpCallTool(args) {
      const tools = mcpClient.getTools();
      if (tools.length === 0) {
        enhancedUI.info('No tools available. Connect to an MCP server first.');
        return;
      }

      let toolName = args[0];
      if (!toolName) {
        const selected = await select({
          message: 'Select tool:',
          choices: tools.map((t) => {
            const fullName = t.fullName || t.name;
            return { name: `${fullName} - ${truncate(t.description || '', 40)}`, value: fullName };
          }),
        });
        toolName = selected;
      }

      // 获取工具参数 schema
      const tool = tools.find((t) => (t.fullName || t.name) === toolName);
      let toolArgs = {};
      if (tool?.parameters?.properties) {
        for (const [key, schema] of Object.entries(tool.parameters.properties)) {
          const value = await input({
            message: `${key} (${schema.description || schema.type}):`,
            default: schema.default,
          });
          toolArgs[key] = schema.type === 'number' ? Number(value) : value;
        }
      }

      const spinner = enhancedUI.spinner(`Calling ${toolName}...`);
      spinner.start();
      try {
        const result = await mcpClient.callTool(toolName, toolArgs);
        spinner.stop();
        console.log(enhancedUI.createHeader(`Result: ${toolName}`));
        console.log(typeof result === 'string' ? result : enhancedUI.formatJSON(result, 2));
        console.log('');
      } catch (error) {
        spinner.stop();
        enhancedUI.error(`Tool call error: ${error.message}`);
      }
    },
  };
}
