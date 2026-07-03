/**
 * Git Tools
 * Git 集成工具集 - 支持常见的 Git 操作
 */

import { execSync } from 'child_process';
import { resolve } from 'path';
import { ToolCategory } from '../../core/types/index.js';

/**
 * 执行 Git 命令
 * @param {string} command - Git 命令
 * @param {string} cwd - 工作目录
 * @param {boolean} throwOnError - 错误时是否抛出异常
 * @returns {string} 命令输出
 */
function execGit(command, cwd, throwOnError = true) {
  try {
    const result = execSync(`git ${command}`, {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    return result.trim();
  } catch (error) {
    if (throwOnError) {
      throw new Error(`Git command failed: ${error.message}`);
    }
    return '';
  }
}

/**
 * 检查是否在 Git 仓库中
 * @param {string} cwd - 工作目录
 * @returns {boolean}
 */
function isGitRepo(cwd) {
  try {
    execGit('rev-parse --git-dir', cwd, false);
    return true;
  } catch {
    return false;
  }
}

/**
 * 创建 Git 工具集
 * @returns {Array<Object>} 工具定义数组
 */
export function createGitTools() {
  return [
    {
      name: 'git_status',
      description: '查看 Git 仓库状态，包括修改的文件、暂存区状态等',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          workingDir: {
            type: 'string',
            description: '工作目录（默认为当前目录）',
          },
          short: {
            type: 'boolean',
            description: '简短格式输出',
            default: false,
          },
        },
      },
      handler: async ({ workingDir = '.', short = false }) => {
        const cwd = resolve(workingDir);

        if (!isGitRepo(cwd)) {
          return { success: false, error: 'Not a git repository' };
        }

        try {
          const flag = short ? '-s' : '';
          const output = execGit(`status ${flag}`, cwd);

          // 解析状态
          const branch = execGit('branch --show-current', cwd, false);
          const aheadBehind = execGit(
            'rev-list --left-right --count HEAD...@{upstream}',
            cwd,
            false,
          );

          let ahead = 0,
            behind = 0;
          if (aheadBehind) {
            const [a, b] = aheadBehind.split('\t').map(Number);
            ahead = a || 0;
            behind = b || 0;
          }

          return {
            success: true,
            branch,
            ahead,
            behind,
            output,
            isClean: output.includes('nothing to commit'),
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'git_diff',
      description: '查看文件的修改差异',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          workingDir: {
            type: 'string',
            description: '工作目录',
          },
          file: {
            type: 'string',
            description: '特定文件路径（可选，查看所有修改则不指定）',
          },
          staged: {
            type: 'boolean',
            description: '查看暂存区的修改',
            default: false,
          },
          stat: {
            type: 'boolean',
            description: '仅显示统计信息',
            default: false,
          },
        },
      },
      handler: async ({ workingDir = '.', file, staged = false, stat = false }) => {
        const cwd = resolve(workingDir);

        if (!isGitRepo(cwd)) {
          return { success: false, error: 'Not a git repository' };
        }

        try {
          let command = 'diff';
          if (staged) {
            command += ' --cached';
          }
          if (stat) {
            command += ' --stat';
          }
          if (file) {
            command += ` -- "${file}"`;
          }

          const output = execGit(command, cwd, false);

          return {
            success: true,
            output: output || 'No changes',
            hasChanges: output.length > 0,
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'git_add',
      description: '将文件添加到暂存区',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          workingDir: {
            type: 'string',
            description: '工作目录',
          },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: '要添加的文件路径列表（支持通配符）',
          },
          all: {
            type: 'boolean',
            description: '添加所有修改（git add -A）',
            default: false,
          },
        },
        required: ['files'],
      },
      handler: async ({ workingDir = '.', files = [], all = false }) => {
        const cwd = resolve(workingDir);

        if (!isGitRepo(cwd)) {
          return { success: false, error: 'Not a git repository' };
        }

        try {
          if (all) {
            execGit('add -A', cwd);
            return { success: true, message: 'Added all changes to staging area' };
          }

          if (files.length === 0) {
            return { success: false, error: 'No files specified' };
          }

          for (const file of files) {
            execGit(`add "${file}"`, cwd);
          }

          return { success: true, message: `Added ${files.length} file(s) to staging area` };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'git_commit',
      description: '提交暂存区的修改',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          workingDir: {
            type: 'string',
            description: '工作目录',
          },
          message: {
            type: 'string',
            description: '提交信息',
          },
          amend: {
            type: 'boolean',
            description: '修改最后一次提交',
            default: false,
          },
          noEdit: {
            type: 'boolean',
            description: '使用上次的提交信息（与 amend 一起使用）',
            default: false,
          },
        },
        required: ['message'],
      },
      handler: async ({ workingDir = '.', message, amend = false, noEdit = false }) => {
        const cwd = resolve(workingDir);

        if (!isGitRepo(cwd)) {
          return { success: false, error: 'Not a git repository' };
        }

        try {
          let command = 'commit';

          if (amend) {
            command += ' --amend';
            if (noEdit) {
              command += ' --no-edit';
            } else if (message) {
              command += ` -m "${message}"`;
            }
          } else {
            if (!message) {
              return { success: false, error: 'Commit message is required' };
            }
            command += ` -m "${message}"`;
          }

          const output = execGit(command, cwd);

          // 解析 commit hash
          const hash = execGit('rev-parse HEAD', cwd);

          return {
            success: true,
            message: amend ? 'Amended last commit' : 'Created new commit',
            hash: hash.substring(0, 7),
            fullHash: hash,
            output,
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'git_branch',
      description: '分支管理（列出、创建、切换、删除分支）',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          workingDir: {
            type: 'string',
            description: '工作目录',
          },
          action: {
            type: 'string',
            enum: ['list', 'create', 'switch', 'delete', 'merge'],
            description: '操作类型',
            default: 'list',
          },
          branchName: {
            type: 'string',
            description: '分支名称（创建/切换/删除时需要）',
          },
          fromBranch: {
            type: 'string',
            description: '从哪个分支创建（创建分支时使用）',
          },
          force: {
            type: 'boolean',
            description: '强制操作',
            default: false,
          },
        },
      },
      handler: async ({
        workingDir = '.',
        action = 'list',
        branchName,
        fromBranch,
        force = false,
      }) => {
        const cwd = resolve(workingDir);

        if (!isGitRepo(cwd)) {
          return { success: false, error: 'Not a git repository' };
        }

        try {
          switch (action) {
            case 'list': {
              const branches = execGit('branch -a', cwd);
              const current = execGit('branch --show-current', cwd);
              return {
                success: true,
                current,
                branches: branches
                  .split('\n')
                  .map((b) => b.trim())
                  .filter(Boolean),
              };
            }

            case 'create': {
              if (!branchName) {
                return { success: false, error: 'Branch name is required' };
              }
              const base = fromBranch || 'HEAD';
              execGit(`checkout -b "${branchName}" ${base}`, cwd);
              return {
                success: true,
                message: `Created and switched to branch: ${branchName}`,
                branch: branchName,
              };
            }

            case 'switch': {
              if (!branchName) {
                return { success: false, error: 'Branch name is required' };
              }
              execGit(`checkout "${branchName}"`, cwd);
              return {
                success: true,
                message: `Switched to branch: ${branchName}`,
                branch: branchName,
              };
            }

            case 'delete': {
              if (!branchName) {
                return { success: false, error: 'Branch name is required' };
              }
              const flag = force ? '-D' : '-d';
              execGit(`branch ${flag} "${branchName}"`, cwd);
              return {
                success: true,
                message: `Deleted branch: ${branchName}`,
              };
            }

            case 'merge': {
              if (!branchName) {
                return { success: false, error: 'Branch name is required' };
              }
              const output = execGit(`merge "${branchName}"`, cwd);
              return {
                success: true,
                message: `Merged branch: ${branchName}`,
                output,
              };
            }

            default:
              return { success: false, error: `Unknown action: ${action}` };
          }
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'git_log',
      description: '查看提交历史',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          workingDir: {
            type: 'string',
            description: '工作目录',
          },
          limit: {
            type: 'number',
            description: '显示最近的 N 条提交',
            default: 10,
          },
          file: {
            type: 'string',
            description: '查看特定文件的提交历史',
          },
          oneline: {
            type: 'boolean',
            description: '单行格式显示',
            default: true,
          },
          author: {
            type: 'string',
            description: '按作者过滤',
          },
          since: {
            type: 'string',
            description: '从某个日期开始（如 "2024-01-01" 或 "1 week ago"）',
          },
        },
      },
      handler: async ({ workingDir = '.', limit = 10, file, oneline = true, author, since }) => {
        const cwd = resolve(workingDir);

        if (!isGitRepo(cwd)) {
          return { success: false, error: 'Not a git repository' };
        }

        try {
          let command = 'log';

          if (oneline) {
            command += ' --oneline';
          }
          command += ` -n ${limit}`;
          if (author) {
            command += ` --author="${author}"`;
          }
          if (since) {
            command += ` --since="${since}"`;
          }
          if (file) {
            command += ` -- "${file}"`;
          }

          // 添加装饰信息
          command += ' --decorate';

          const output = execGit(command, cwd);
          const commits = output
            .split('\n')
            .filter(Boolean)
            .map((line) => {
              // 解析单行格式: "abc1234 Commit message (HEAD -> main)"
              const match = line.match(/^([a-f0-9]+)\s+(.+)$/);
              if (match) {
                return {
                  hash: match[1],
                  message: match[2],
                };
              }
              return { raw: line };
            });

          return {
            success: true,
            commits,
            count: commits.length,
            output,
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'git_push',
      description: '推送本地提交到远程仓库',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          workingDir: {
            type: 'string',
            description: '工作目录',
          },
          remote: {
            type: 'string',
            description: '远程仓库名称',
            default: 'origin',
          },
          branch: {
            type: 'string',
            description: '分支名称（默认当前分支）',
          },
          force: {
            type: 'boolean',
            description: '强制推送（谨慎使用）',
            default: false,
          },
          setUpstream: {
            type: 'boolean',
            description: '设置上游分支（首次推送）',
            default: false,
          },
        },
      },
      handler: async ({
        workingDir = '.',
        remote = 'origin',
        branch,
        force = false,
        setUpstream = false,
      }) => {
        const cwd = resolve(workingDir);

        if (!isGitRepo(cwd)) {
          return { success: false, error: 'Not a git repository' };
        }

        try {
          let command = 'push';

          if (force) {
            command += ' --force';
          }
          if (setUpstream) {
            command += ' -u';
          }
          command += ` ${remote}`;
          if (branch) {
            command += ` "${branch}"`;
          }

          const output = execGit(command, cwd);

          return {
            success: true,
            message: 'Push successful',
            output,
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'git_pull',
      description: '从远程仓库拉取更新',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          workingDir: {
            type: 'string',
            description: '工作目录',
          },
          remote: {
            type: 'string',
            description: '远程仓库名称',
            default: 'origin',
          },
          branch: {
            type: 'string',
            description: '分支名称',
          },
          rebase: {
            type: 'boolean',
            description: '使用 rebase 而不是 merge',
            default: false,
          },
        },
      },
      handler: async ({ workingDir = '.', remote = 'origin', branch, rebase = false }) => {
        const cwd = resolve(workingDir);

        if (!isGitRepo(cwd)) {
          return { success: false, error: 'Not a git repository' };
        }

        try {
          let command = 'pull';

          if (rebase) {
            command += ' --rebase';
          }
          command += ` ${remote}`;
          if (branch) {
            command += ` "${branch}"`;
          }

          const output = execGit(command, cwd);

          return {
            success: true,
            message: 'Pull successful',
            output,
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'git_reset',
      description: '重置到指定状态（撤销修改）',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          workingDir: {
            type: 'string',
            description: '工作目录',
          },
          mode: {
            type: 'string',
            enum: ['soft', 'mixed', 'hard'],
            description: '重置模式',
            default: 'mixed',
          },
          target: {
            type: 'string',
            description: '重置目标（HEAD, commit hash, 等）',
            default: 'HEAD',
          },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: '仅重置特定文件',
          },
        },
      },
      handler: async ({ workingDir = '.', mode = 'mixed', target = 'HEAD', files = [] }) => {
        const cwd = resolve(workingDir);

        if (!isGitRepo(cwd)) {
          return { success: false, error: 'Not a git repository' };
        }

        try {
          let command = 'reset';

          if (files.length > 0) {
            // 文件级重置
            command += ` HEAD -- ${files.map((f) => `"${f}"`).join(' ')}`;
          } else {
            // 提交级重置
            command += ` --${mode} ${target}`;
          }

          const output = execGit(command, cwd);

          return {
            success: true,
            message: `Reset ${files.length > 0 ? 'files' : 'to ' + target} (${mode})`,
            output,
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'git_stash',
      description: '暂存当前修改',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          workingDir: {
            type: 'string',
            description: '工作目录',
          },
          action: {
            type: 'string',
            enum: ['push', 'pop', 'list', 'drop', 'clear'],
            description: '操作类型',
            default: 'push',
          },
          message: {
            type: 'string',
            description: '暂存信息（push 时使用）',
          },
          index: {
            type: 'number',
            description: '暂存索引（pop/drop 时使用）',
            default: 0,
          },
        },
      },
      handler: async ({ workingDir = '.', action = 'push', message, index = 0 }) => {
        const cwd = resolve(workingDir);

        if (!isGitRepo(cwd)) {
          return { success: false, error: 'Not a git repository' };
        }

        try {
          let command = 'stash';

          switch (action) {
            case 'push':
              command += ' push';
              if (message) {
                command += ` -m "${message}"`;
              }
              break;
            case 'pop':
              command += ` pop stash@{${index}}`;
              break;
            case 'list':
              command += ' list';
              break;
            case 'drop':
              command += ` drop stash@{${index}}`;
              break;
            case 'clear':
              command += ' clear';
              break;
          }

          const output = execGit(command, cwd);

          return {
            success: true,
            action,
            output: output || `Stash ${action} successful`,
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },
  ];
}

export default createGitTools;
