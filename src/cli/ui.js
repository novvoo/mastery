/**
 * CLI UI utilities - colored output, formatting, spinners
 */

import chalk from 'chalk';

export const ui = {
  brand(text) {
    return chalk.cyan.bold(text);
  },

  header(text) {
    console.log('');
    console.log(chalk.dim('─'.repeat(60)));
    console.log(chalk.cyan.bold(`  ${text}`));
    console.log(chalk.dim('─'.repeat(60)));
  },

  toolCall(name, args) {
    console.log('');
    console.log(chalk.yellow(`  🔧 Tool: ${name}`));
    for (const [key, value] of Object.entries(args)) {
      const display = typeof value === 'string' && value.length > 100
        ? value.substring(0, 100) + '...'
        : String(value);
      console.log(chalk.dim(`     ├─ ${key}: ${display}`));
    }
    console.log(chalk.dim('     └─ ...'));
  },

  toolResult(name, result) {
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
    const preview = resultStr.length > 200 ? resultStr.substring(0, 200) + '...' : resultStr;
    console.log(chalk.green(`  ✅ ${name}: ${preview.replace(/\n/g, '\\n')}`));
  },

  toolError(name, error) {
    console.log(chalk.red(`  ❌ ${name} error: ${error}`));
  },

  thought(text) {
    console.log('');
    console.log(chalk.blue(`  💭 Thought: ${text}`));
  },

  stream(chunk) {
    process.stdout.write(chalk.white(chunk));
  },

  finalAnswer(text) {
    console.log('');
    console.log(chalk.dim('─'.repeat(60)));
    console.log(chalk.green.bold('  📋 Final Answer:'));
    console.log(chalk.dim('─'.repeat(60)));
    console.log('');
    console.log(chalk.white(text));
    console.log('');
  },

  prompt(label = 'You') {
    return chalk.magenta.bold(`[${label}] > `);
  },

  info(text) {
    console.log(chalk.blue(`  ℹ️  ${text}`));
  },

  warn(text) {
    console.log(chalk.yellow(`  ⚠️  ${text}`));
  },

  error(text) {
    console.log(chalk.red(`  ❌ ${text}`));
  },

  success(text) {
    console.log(chalk.green(`  ✅ ${text}`));
  },

  debug(text) {
    if (process.env.DEBUG === 'true') {
      console.log(chalk.gray(`  🔍 [DEBUG] ${text}`));
    }
  },

  iteration(num, max) {
    console.log(chalk.dim(`  ⏳ Iteration ${num}/${max}`));
  },

  welcome(config) {
    console.log('');
    console.log(chalk.cyan('╭──────────────────────────────────────────────────╮'));
    console.log(chalk.cyan('│') + chalk.cyan.bold('  AI Engineering Mastery Agent v1.0.4') + '              │');
    console.log(chalk.cyan('│') + chalk.dim(`  Model: ${config.model} (${config.provider})`) + ' '.repeat(Math.max(0, 33 - config.model.length - config.provider.length - 3)) + '│');
    console.log(chalk.cyan('│') + chalk.dim(`  Working Dir: ${config.workingDir}`) + ' '.repeat(Math.max(0, 31 - config.workingDir.length)) + '│');
    console.log(chalk.cyan('╰──────────────────────────────────────────────────╯'));
    console.log('');
    console.log(chalk.dim('  Type your request or "exit" to quit.'));
    console.log(chalk.dim('  Skills auto-trigger based on context. Use /skillname to force.'));
    console.log('');
  },

  spinner: {
    frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
    index: 0,
    timer: null,

    start(text = 'Thinking') {
      this.stop();
      this.index = 0;
      process.stdout.write(chalk.dim(`  ${this.frames[0]} ${text}...`));
      this.timer = setInterval(() => {
        this.index = (this.index + 1) % this.frames.length;
        process.stdout.write(`\r  ${chalk.dim(this.frames[this.index])} ${text}...`);
      }, 80);
    },

    stop() {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
        process.stdout.write('\r' + ' '.repeat(40) + '\r');
      }
    },
  },
};
