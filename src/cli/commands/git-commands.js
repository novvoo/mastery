/**
 * Git Operations Commands
 * Git 操作命令 - status, diff, add, commit, branch, log, push, pull, stash, reset
 */

import { input, select, confirm } from '@inquirer/prompts';
import { enhancedUI, createTable } from '../enhanced-ui.js';
import { GIT_MENU_CHOICES, runGit } from '../enhanced-command-utils.js';

/**
 * 创建 Git 操作命令
 * @param {Object} deps - 依赖项（Git 命令目前不需要额外依赖）
 * @returns {Object} Git 操作命令方法
 */
export function createGitCommands(deps) {
  const theme = enhancedUI.theme;

  return {
    /**
     * 处理 /git 命令
     * @param {string} args - 命令参数
     */
    async handleGitCommand(args) {
      if (typeof args === 'string') {
        args = args.split(/\s+/).filter(Boolean);
      }
      const subcommand = args[0];

      switch (subcommand) {
        case 'status':
          await this.gitStatus(args.slice(1));
          break;
        case 'diff':
          await this.gitDiff(args.slice(1));
          break;
        case 'add':
          await this.gitAdd(args.slice(1));
          break;
        case 'commit':
          await this.gitCommit(args.slice(1));
          break;
        case 'branch':
          await this.gitBranch(args.slice(1));
          break;
        case 'log':
          await this.gitLog(args.slice(1));
          break;
        case 'push':
          await this.gitPush(args.slice(1));
          break;
        case 'pull':
          await this.gitPull(args.slice(1));
          break;
        case 'stash':
          await this.gitStash(args.slice(1));
          break;
        case 'reset':
          await this.gitReset(args.slice(1));
          break;
        case 'menu':
          await this.showGitMenu();
          break;
        default:
          if (!subcommand) {
            await this.gitStatus([]);
          } else {
            enhancedUI.error(`Unknown git subcommand: ${subcommand}`);
            enhancedUI.info(
              'Available: status, diff, add, commit, branch, log, push, pull, stash, reset, menu',
            );
          }
      }
    },

    /**
     * Git 交互式菜单
     */
    async showGitMenu() {
      const action = await select({
        message: 'Git Operations:',
        choices: GIT_MENU_CHOICES,
      });

      if (action === 'back') {
        return;
      }
      await this.handleGitCommand([action]);
    },

    async gitStatus(args) {
      const spinner = enhancedUI.spinner('Getting git status...');
      spinner.start();
      try {
        const output = await runGit(['status', '--porcelain=v1', '--branch']);
        spinner.stop();

        if (!output.trim()) {
          enhancedUI.success('Working tree is clean');
          return;
        }

        console.log(enhancedUI.createHeader('Git Status'));

        // 解析分支信息
        const lines = output.trim().split('\n');
        const branchLine = lines[0];
        if (branchLine.startsWith('##')) {
          console.log(theme.primaryBold('  Branch: ') + branchLine.replace('## ', ''));
          console.log('');
        }

        // 解析文件状态
        const staged = [];
        const modified = [];
        const untracked = [];

        for (const line of lines.slice(1)) {
          if (!line.trim()) {
            continue;
          }
          const status = line.substring(0, 2).trim();
          const file = line.substring(3);
          if (status.startsWith('?')) {
            untracked.push(file);
          } else if (status[0] !== ' ' && status[0] !== '') {
            staged.push({ status: status[0], file });
          } else {
            modified.push({ status: status[1] || status[0], file });
          }
        }

        if (staged.length > 0) {
          console.log(theme.successBold('  Staged changes:'));
          for (const { status, file } of staged) {
            console.log(`    ${theme.success('  ' + status)} ${file}`);
          }
          console.log('');
        }
        if (modified.length > 0) {
          console.log(theme.warningBold('  Modified (not staged):'));
          for (const { status, file } of modified) {
            console.log(`    ${theme.warning('  ' + status)} ${file}`);
          }
          console.log('');
        }
        if (untracked.length > 0) {
          console.log(theme.errorBold('  Untracked:'));
          for (const file of untracked) {
            console.log(`    ${theme.error('  ?')} ${file}`);
          }
          console.log('');
        }
      } catch (error) {
        spinner.stop();
        enhancedUI.error(`Not a git repository or git error: ${error.message.replace(/\n/g, ' ')}`);
      }
    },

    async gitDiff(args) {
      const spinner = enhancedUI.spinner('Getting diff...');
      spinner.start();
      try {
        const isStaged = args.includes('--staged') || args.includes('--cached');
        const isStat = args.includes('--stat');
        const files = args.filter((a) => !a.startsWith('--'));
        const gitArgs = ['diff'];
        if (isStaged) {
          gitArgs.push('--cached');
        }
        if (isStat) {
          gitArgs.push('--stat');
        }
        if (files.length > 0) {
          gitArgs.push('--', ...files);
        }

        const output = await runGit(gitArgs);
        spinner.stop();

        if (!output.trim()) {
          enhancedUI.info('No changes');
          return;
        }

        console.log(enhancedUI.createHeader(`Diff${isStaged ? ' (staged)' : ''}`));
        // 用 diffstat 风格着色
        const colored = output
          .replace(/^(\+\+\+ .+)$/gm, theme.success('$1'))
          .replace(/^(\-\-\- .+)$/gm, theme.error('$1'))
          .replace(/^(\+.+)$/gm, theme.success('$1'))
          .replace(/^(\-.+)$/gm, theme.error('$1'))
          .replace(/^(@@ .+ @@)$/gm, theme.primary('$1'));
        console.log(colored);
      } catch (error) {
        spinner.stop();
        enhancedUI.error(error.message.replace(/\n/g, ' '));
      }
    },

    async gitAdd(args) {
      if (args.length === 0) {
        const mode = await select({
          message: 'What to add?',
          choices: [
            { name: 'All changes (-A)', value: 'all' },
            { name: 'Specify files...', value: 'files' },
          ],
        });
        if (mode === 'all') {
          args = ['-A'];
        } else {
          const filesStr = await input({
            message: 'File paths (space-separated):',
          });
          args = filesStr.split(/\s+/).filter(Boolean);
        }
      }

      const spinner = enhancedUI.spinner('Adding files...');
      spinner.start();
      try {
        const isAll = args.includes('-A') || args.includes('--all');
        await runGit(isAll ? ['add', '-A'] : ['add', ...args]);
        spinner.stop();
        enhancedUI.success(
          isAll ? 'All changes added to staging area' : `${args.length} file(s) added`,
        );
      } catch (error) {
        spinner.stop();
        enhancedUI.error(error.message.replace(/\n/g, ' '));
      }
    },

    async gitCommit(args) {
      let message = args.join(' ');
      if (!message) {
        const msg = await input({
          message: 'Commit message:',
        });
        message = msg;
      }
      if (!message.trim()) {
        enhancedUI.error('Commit message is required');
        return;
      }

      const spinner = enhancedUI.spinner('Committing...');
      spinner.start();
      try {
        await runGit(['commit', '-m', message]);
        const hash = (await runGit(['rev-parse', '--short', 'HEAD'])).trim();
        spinner.stop();
        enhancedUI.success(`Committed: ${hash} - ${message}`);
      } catch (error) {
        spinner.stop();
        enhancedUI.error(error.message.replace(/\n/g, ' '));
      }
    },

    async gitBranch(args) {
      const action = args[0] || 'list';
      try {
        if (action === 'list' || !action) {
          const output = await runGit(['branch', '-a', '--color=never']);
          const current = (await runGit(['branch', '--show-current'])).trim();
          console.log(enhancedUI.createHeader('Branches'));
          for (const line of output.trim().split('\n')) {
            const name = line.replace(/^\* /, '').trim();
            if (name === current) {
              console.log(theme.success('  * ') + theme.successBold(name));
            } else {
              console.log(theme.dim('    ') + name);
            }
          }
          console.log('');
        } else if (action === 'create' || action === 'checkout' || action === 'switch') {
          const branchName = args[1];
          if (!branchName) {
            const name = await input({
              message: 'Branch name:',
            });
            args[1] = name;
          }
          const gitArgs = action === 'create' ? ['checkout', '-b', args[1]] : ['checkout', args[1]];
          await runGit(gitArgs);
          enhancedUI.success(`Switched to branch: ${args[1]}`);
        } else if (action === 'delete') {
          const branchName = args[1];
          if (!branchName) {
            enhancedUI.error('Usage: /git delete <branch-name>');
            return;
          }
          await runGit(['branch', '-d', branchName]);
          enhancedUI.success(`Deleted branch: ${branchName}`);
        }
      } catch (error) {
        enhancedUI.error(error.message.replace(/\n/g, ' '));
      }
    },

    async gitLog(args) {
      const spinner = enhancedUI.spinner('Getting log...');
      spinner.start();
      try {
        const limit = (args.find((a) => a.startsWith('-n')) || '-n 15').replace('-n', '').trim();
        const files = args.filter((a) => !a.startsWith('-'));
        const gitArgs = ['log', '--oneline', '--decorate', '--graph', '-n', limit];
        if (files.length > 0) {
          gitArgs.push('--', ...files);
        }

        const output = await runGit(gitArgs);
        spinner.stop();

        console.log(enhancedUI.createHeader('Commit Log'));
        const colored = output
          .replace(/^(\* .+)$/gm, theme.success('$1'))
          .replace(/^(\| .+)$/gm, theme.dim('$1'));
        console.log(colored);
      } catch (error) {
        spinner.stop();
        enhancedUI.error(error.message.replace(/\n/g, ' '));
      }
    },

    async gitPush(args) {
      const spinner = enhancedUI.spinner('Pushing...');
      spinner.start();
      try {
        const remote = args[0] || 'origin';
        const branch = args[1] || '';
        const setUpstream = args.includes('-u') || args.includes('--set-upstream');
        const force = args.includes('-f') || args.includes('--force');

        const gitArgs = ['push'];
        if (force) {
          gitArgs.push('--force');
        }
        if (setUpstream) {
          gitArgs.push('-u');
        }
        gitArgs.push(remote);
        if (branch) {
          gitArgs.push(branch);
        }

        const output = await runGit(gitArgs);
        spinner.stop();
        enhancedUI.success('Push successful');
        if (output.trim()) {
          console.log(theme.dim(output.trim()));
        }
      } catch (error) {
        spinner.stop();
        enhancedUI.error(error.message.replace(/\n/g, ' '));
      }
    },

    async gitPull(args) {
      const spinner = enhancedUI.spinner('Pulling...');
      spinner.start();
      try {
        const rebase = args.includes('--rebase');
        const remote = args.find((a) => !a.startsWith('-')) || 'origin';
        const branch = args.filter((a) => !a.startsWith('-') && a !== remote)[0] || '';

        const gitArgs = ['pull'];
        if (rebase) {
          gitArgs.push('--rebase');
        }
        gitArgs.push(remote);
        if (branch) {
          gitArgs.push(branch);
        }

        const output = await runGit(gitArgs);
        spinner.stop();
        enhancedUI.success('Pull successful');
        if (output.trim()) {
          console.log(theme.dim(output.trim()));
        }
      } catch (error) {
        spinner.stop();
        enhancedUI.error(error.message.replace(/\n/g, ' '));
      }
    },

    async gitStash(args) {
      const action = args[0] || 'list';
      try {
        let gitArgs;
        switch (action) {
          case 'push':
            gitArgs = ['stash', 'push'];
            if (args.includes('-m')) {
              const idx = args.indexOf('-m');
              gitArgs.push('-m', args[idx + 1] || 'auto stash');
            }
            break;
          case 'pop':
            gitArgs = ['stash', 'pop', `stash@{${args[1] || 0}}`];
            break;
          case 'list':
            gitArgs = ['stash', 'list'];
            break;
          case 'drop':
            gitArgs = ['stash', 'drop', `stash@{${args[1] || 0}}`];
            break;
          case 'clear':
            gitArgs = ['stash', 'clear'];
            break;
          default:
            gitArgs = ['stash', 'list'];
        }

        const output = await runGit(gitArgs);
        if (!output.trim()) {
          enhancedUI.info('No stashes');
        } else {
          console.log(enhancedUI.createHeader(`Stash ${action}`));
          console.log(output.trim());
        }
        enhancedUI.success(`Stash ${action} done`);
      } catch (error) {
        enhancedUI.error(error.message.replace(/\n/g, ' '));
      }
    },

    async gitReset(args) {
      const mode = args.find((a) => ['--soft', '--mixed', '--hard'].includes(a)) || '--mixed';
      const target = args.find((a) => !a.startsWith('-')) || 'HEAD';
      const files = args.filter((a) => !a.startsWith('-') && a !== target);

      const confirmed = await confirm({
        message: `Reset ${mode} ${target}${files.length > 0 ? ' (' + files.join(', ') + ')' : ''}?`,
        default: false,
      });
      if (!confirmed) {
        enhancedUI.info('Cancelled');
        return;
      }

      try {
        const gitArgs = ['reset', mode, target];
        if (files.length > 0) {
          gitArgs.push('--', ...files);
        }
        await runGit(gitArgs);
        enhancedUI.success(`Reset ${mode} ${target} done`);
      } catch (error) {
        enhancedUI.error(error.message.replace(/\n/g, ' '));
      }
    },
  };
}
