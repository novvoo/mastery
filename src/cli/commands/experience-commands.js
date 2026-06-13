/**
 * Experience, Reasoning & Security Commands
 * 经验记忆、智能推理和安全策略命令
 */

import { input, select, confirm } from '@inquirer/prompts';
import { enhancedUI, createTable, formatStatus, truncate } from '../enhanced-ui.js';
import {
  EXPERIENCE_MENU_CHOICES,
  REASON_MENU_CHOICES,
  SECURITY_MENU_CHOICES,
} from '../enhanced-command-utils.js';

/**
 * 创建经验记忆管理命令
 * @param {Object} deps - 依赖项
 * @param {import('../../core/experience-memory.js').ExperienceMemory} deps.experienceMemory - 经验记忆
 * @returns {Object} 经验记忆管理命令方法
 */
export function createExperienceCommands(deps) {
  const { experienceMemory } = deps;

  return {
    /**
     * 处理 /experience 命令
     */
    async handleExperienceCommand(args) {
      if (!experienceMemory) {
        enhancedUI.error('Experience memory not initialized');
        return;
      }

      if (typeof args === 'string') {
        args = args.split(/\s+/).filter(Boolean);
      }
      const subcommand = args[0];

      switch (subcommand) {
        case 'stats':
        case 'status':
          await this.experienceStats();
          break;
        case 'list':
          await this.experienceList(parseInt(args[1]) || 10);
          break;
        case 'search':
          await this.experienceSearch(args.slice(1).join(' '));
          break;
        case 'clear':
          const confirmed = await confirm({
            message: 'Clear all experiences?',
            default: false,
          });
          if (confirmed) {
            experienceMemory.clear();
            enhancedUI.success('Experience memory cleared');
          }
          break;
        case 'menu':
          await this.showExperienceMenu();
          break;
        default:
          if (!subcommand) {
            await this.experienceStats();
          } else {
            enhancedUI.error(`Unknown experience subcommand: ${subcommand}`);
            enhancedUI.info('Available: stats, list [n], search <query>, clear, menu');
          }
      }
    },

    async showExperienceMenu() {
      const action = await select({
        message: 'Experience Memory:',
        choices: EXPERIENCE_MENU_CHOICES,
      });
      if (action === 'back') {return;}
      await this.handleExperienceCommand([action]);
    },

    async experienceStats() {
      const stats = experienceMemory.getStats();
      console.log(enhancedUI.createHeader('Experience Memory Stats'));

      const table = createTable({ colWidths: [25, 20] });
      table.push(
        [enhancedUI.theme.primaryBold('Total Experiences'), stats.total],
        [enhancedUI.theme.successBold('Successes'), stats.successes],
        [enhancedUI.theme.errorBold('Failures'), stats.failures],
        [enhancedUI.theme.warningBold('Partial'), stats.partial],
        [enhancedUI.theme.primaryBold('Used (recalled)'), stats.used],
        [enhancedUI.theme.dim('Unused'), stats.unused],
      );
      console.log(table.toString());
      console.log('');
    },

    async experienceList(limit) {
      const all = experienceMemory.getAll().slice(0, limit);
      console.log(enhancedUI.createHeader(`Recent Experiences (top ${limit})`));

      if (all.length === 0) {
        enhancedUI.info('No experiences recorded yet');
        return;
      }

      for (const exp of all) {
        const icon = exp.outcome === 'success' ? '✅' : exp.outcome === 'failure' ? '❌' : '⚠️';
        const time = new Date(exp.timestamp).toLocaleString();
        console.log(`  ${icon} [${exp.tool || 'general'}] ${exp.lesson}`);
        console.log(`     ${enhancedUI.theme.dim(`${time} | used: ${exp.usageCount}`)}`);
      }
      console.log('');
    },

    async experienceSearch(query) {
      if (!query) {
        const q = await input({
          message: 'Search query:',
        });
        query = q;
      }
      if (!query) {return;}

      const results = experienceMemory.recall(query);
      console.log(enhancedUI.createHeader(`Search: "${query}"`));

      if (results.length === 0) {
        enhancedUI.info('No relevant experiences found');
        return;
      }

      for (const exp of results) {
        const icon = exp.outcome === 'success' ? '✅' : exp.outcome === 'failure' ? '❌' : '⚠️';
        console.log(`  ${icon} [score: ${exp.score.toFixed(2)}] ${exp.lesson}`);
        if (exp.tool) {console.log(`     Tool: ${exp.tool}`);}
      }
      console.log('');
    },
  };
}

/**
 * 创建智能推理命令
 * @param {Object} deps - 依赖项
 * @param {Object} deps.intelligentReasoning - 智能推理引擎
 * @returns {Object} 智能推理命令方法
 */
export function createReasoningCommands(deps) {
  const { intelligentReasoning } = deps;

  return {
    async handleReasonCommand(args) {
      if (!intelligentReasoning) {
        enhancedUI.error('Intelligent reasoning not initialized');
        return;
      }

      if (typeof args === 'string') {
        args = args.split(/\s+/).filter(Boolean);
      }
      const subcommand = args[0];

      switch (subcommand) {
        case 'intent':
          await this.analyzeIntent(args.slice(1).join(' '));
          break;
        case 'tools':
          await this.recommendTools(args.slice(1).join(' '));
          break;
        case 'decompose':
          await this.decomposeTask(args.slice(1).join(' '));
          break;
        case 'menu':
          await this.showReasonMenu();
          break;
        default:
          if (!subcommand) {
            enhancedUI.info('Usage: /reason <intent|tools|decompose> <text>');
            enhancedUI.info('Use /reason menu for the interactive reasoning menu.');
          } else {
            // 默认当作意图分析
            await this.analyzeIntent(args.join(' '));
          }
      }
    },

    async showReasonMenu() {
      const action = await select({
        message: 'Intelligent Reasoning:',
        choices: REASON_MENU_CHOICES,
      });
      if (action === 'back') {return;}

      const inputText = await input({
        message: 'Enter text:',
      });
      await this.handleReasonCommand([action, inputText]);
    },

    async analyzeIntent(text) {
      if (!text) {
        const t = await input({
          message: 'Enter text to analyze:',
        });
        text = t;
      }
      if (!text) {return;}

      const intent = await intelligentReasoning.analyzeIntent(text);
      console.log(enhancedUI.createHeader('Intent Analysis'));
      console.log(`  Input: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
      console.log(`  Primary Intent: ${enhancedUI.theme.primaryBold(intent.primary)}`);
      console.log(`  Confidence: ${(intent.confidence * 100).toFixed(0)}%`);
      console.log('');
      console.log('  Detected intents:');
      for (const [k, v] of Object.entries(intent.intents)) {
        if (v) {console.log(`    ✓ ${k.replace('is', '')}`);}
      }
      console.log('');
      console.log(`  Keywords: ${intent.keywords.join(', ') || 'none'}`);
      console.log('');
    },

    async recommendTools(text) {
      if (!text) {
        const t = await input({
          message: 'Enter task description:',
        });
        text = t;
      }
      if (!text) {return;}

      const intent = await intelligentReasoning.analyzeIntent(text);
      const tools = await intelligentReasoning.selectTools(text, intent);
      const strategy = intelligentReasoning.generateStrategy(text, tools);

      console.log(enhancedUI.createHeader('Tool Recommendations'));
      console.log(`  Strategy: ${enhancedUI.theme.primaryBold(strategy.type)}`);
      console.log(`  Reasoning: ${strategy.reasoning}`);
      console.log('');
      console.log('  Recommended tools:');
      for (const t of tools) {
        const bar = '█'.repeat(Math.round(t.confidence * 10)) + '░'.repeat(10 - Math.round(t.confidence * 10));
        console.log(`    ${t.name.padEnd(20)} ${bar} ${(t.confidence * 100).toFixed(0)}%`);
      }
      console.log('');
    },

    async decomposeTask(text) {
      if (!text) {
        const t = await input({
          message: 'Enter complex task:',
        });
        text = t;
      }
      if (!text) {return;}

      const subtasks = await intelligentReasoning.decomposeTask(text);
      console.log(enhancedUI.createHeader('Task Decomposition'));
      console.log(`  Original: "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`);
      console.log('');
      console.log(`  Decomposed into ${subtasks.length} subtask(s):`);
      for (const st of subtasks) {
        const deps = st.dependencies.length > 0 ? ` (depends: ${st.dependencies.join(', ')})` : '';
        const par = st.parallel ? ' [parallel]' : '';
        console.log(`    ${st.order}. ${st.description}${deps}${par}`);
      }
      console.log('');
    },
  };
}

/**
 * 创建安全策略命令
 * @param {Object} deps - 依赖项
 * @param {import('../../core/security-policy.js').SecurityPolicy} deps.securityPolicy - 安全策略
 * @returns {Object} 安全策略命令方法
 */
export function createSecurityCommands(deps) {
  const { securityPolicy } = deps;

  return {
    /**
     * 处理 /security 命令
     */
    async handleSecurityCommand(args) {
      if (!securityPolicy) {
        enhancedUI.error('Security policy not initialized');
        return;
      }

      if (typeof args === 'string') {
        args = args.split(/\s+/).filter(Boolean);
      }
      const subcommand = args[0];

      switch (subcommand) {
        case 'report':
        case 'status':
          await this.securityReport();
          break;
        case 'policy':
          await this.securityPolicyDetail(args[1]);
          break;
        case 'list':
          await this.securityListTools();
          break;
        case 'menu':
          await this.showSecurityMenu();
          break;
        default:
          if (!subcommand) {
            await this.securityReport();
          } else {
            enhancedUI.error(`Unknown security subcommand: ${subcommand}`);
            enhancedUI.info('Available: report, policy <tool>, list, menu');
          }
      }
    },

    async showSecurityMenu() {
      const action = await select({
        message: 'Security Management:',
        choices: SECURITY_MENU_CHOICES,
      });
      if (action === 'back') {return;}
      await this.handleSecurityCommand([action]);
    },

    async securityReport() {
      const report = securityPolicy.getSecurityReport();
      console.log(enhancedUI.createHeader('Security Report'));

      const table = createTable({ colWidths: [30, 20] });
      table.push(
        [enhancedUI.theme.primaryBold('Total Tools'), report.totalTools],
        [enhancedUI.theme.primaryBold('Requires Approval'), report.approvalRequired.length],
        [enhancedUI.theme.primaryBold('Not Concurrency Safe'), report.notConcurrencySafe.length],
        [enhancedUI.theme.primaryBold('Has External Effects'), report.withExternalEffects.length],
      );
      console.log(table.toString());
      console.log('');

      if (report.approvalRequired.length > 0) {
        console.log(enhancedUI.theme.warningBold('  ⚠️  Tools requiring approval:'));
        for (const name of report.approvalRequired) {
          console.log(`    ${enhancedUI.theme.warning('  !')} ${name}`);
        }
        console.log('');
      }

      console.log('  Permission distribution:');
      for (const [level, tools] of Object.entries(report.byPermission)) {
        const icon = level === 'dangerous' ? '🔴' : level === 'execute' ? '🟠' : level === 'write' ? '🟡' : level === 'readonly' ? '🟢' : '⚪';
        console.log(`    ${icon} ${level}: ${tools.length} tool(s)`);
      }
      console.log('');
    },

    async securityPolicyDetail(toolName) {
      if (!toolName) {
        const tool = await input({
          message: 'Tool name:',
        });
        toolName = tool;
      }

      const policy = securityPolicy.getPolicy(toolName);
      console.log(enhancedUI.createHeader(`Security Policy: ${toolName}`));

      const table = createTable({ colWidths: [25, 30] });
      table.push(
        [enhancedUI.theme.primaryBold('Permission Level'), policy.permissionLevel],
        [enhancedUI.theme.primaryBold('Scope'), policy.scope],
        [enhancedUI.theme.primaryBold('Concurrency Safe'), formatStatus(policy.isConcurrencySafe)],
        [enhancedUI.theme.primaryBold('External Effect'), formatStatus(policy.hasExternalEffect)],
        [enhancedUI.theme.primaryBold('Max Result Chars'), policy.maxResultChars.toLocaleString()],
        [enhancedUI.theme.primaryBold('Requires Approval'), formatStatus(policy.requiresApproval)],
      );
      console.log(table.toString());
      console.log('');
    },

    async securityListTools() {
      const report = securityPolicy.getSecurityReport();
      console.log(enhancedUI.createHeader('Tools by Permission Level'));

      for (const [level, tools] of Object.entries(report.byPermission)) {
        if (tools.length === 0) {continue;}
        const icon = level === 'dangerous' ? '🔴' : level === 'execute' ? '🟠' : level === 'write' ? '🟡' : level === 'readonly' ? '🟢' : '⚪';
        console.log(`\n  ${icon} ${enhancedUI.theme.whiteBold(level.toUpperCase())} (${tools.length})`);
        for (const name of tools) {
          console.log(`    ${name}`);
        }
      }
      console.log('');
    },
  };
}
