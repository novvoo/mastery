import { execSync } from 'child_process';
import { resolve, join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { ToolCategory } from '../../core/types/index.js';

const CHECKPOINT_DIR = '.checkpoints';

function execGit(command, cwd, throwOnError = true) {
  try {
    const result = execSync(`git ${command}`, {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return result.trim();
  } catch (error) {
    if (throwOnError) {
      throw new Error(`Git command failed: ${error.message}`);
    }
    return '';
  }
}

function isGitRepo(cwd) {
  try {
    execGit('rev-parse --git-dir', cwd, false);
    return true;
  } catch {
    return false;
  }
}

function ensureCheckpointDir(cwd) {
  const dir = join(cwd, CHECKPOINT_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function writeCheckpointMeta(cwd, id, meta) {
  const dir = ensureCheckpointDir(cwd);
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(meta, null, 2));
}

function readCheckpointMeta(cwd, id) {
  const path = join(cwd, CHECKPOINT_DIR, `${id}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function deleteCheckpointMeta(cwd, id) {
  const path = join(cwd, CHECKPOINT_DIR, `${id}.json`);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

export function createCheckpointTools() {
  return [
    {
      name: 'checkpoint',
      description: `Create a checkpoint of the current workspace state. You can later restore to this checkpoint if needed.

**Parameters:**
- \`reason\` (optional): A description of why you're creating this checkpoint (e.g., "before refactoring user auth").
- \`stashOnly\` (optional, default: false): If true, stash uncommitted changes without creating a commit.

**Returns:**
- \`checkpointId\`: Unique identifier for this checkpoint
- \`message\`: Human-readable confirmation

**Example:**
Create a checkpoint before making risky changes:
<function_calls>
<invoke name="checkpoint">
<parameter name="reason">before refactoring authentication module</parameter>
</invoke>
</function_calls>`,
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Description of why this checkpoint is being created',
          },
          stashOnly: {
            type: 'boolean',
            description: 'If true, only stash changes without committing',
            default: false,
          },
          workingDir: {
            type: 'string',
            description: 'Working directory (defaults to current directory)',
          },
        },
      },
      handler: async ({ reason = '', stashOnly = false, workingDir = '.' }) => {
        const cwd = resolve(workingDir);

        if (!isGitRepo(cwd)) {
          return { success: false, error: 'Not a git repository' };
        }

        try {
          const id = `ckpt-${Date.now()}`;
          const branch = execGit('branch --show-current', cwd, false) || 'HEAD';
          const head = execGit('rev-parse HEAD', cwd, false);
          const hasChanges = execGit('status --porcelain', cwd, false).length > 0;

          let stashRef = null;
          let commitHash = head;

          if (hasChanges) {
            if (stashOnly) {
              execGit(`stash push -m "checkpoint:${id}"`, cwd);
              stashRef = execGit('stash list --format=%H -n 1', cwd, false);
            } else {
              execGit('add -A', cwd);
              execGit(`commit -m "checkpoint: ${reason || id}" --no-verify`, cwd);
              commitHash = execGit('rev-parse HEAD', cwd, false);
            }
          }

          writeCheckpointMeta(cwd, id, {
            id,
            reason,
            stashOnly,
            branch,
            head: commitHash,
            stashRef,
            createdAt: Date.now(),
            hasChanges,
          });

          return {
            success: true,
            checkpointId: id,
            message: `Checkpoint created: ${id}${stashOnly ? ' (stashed)' : ' (committed)'}`,
            branch,
            commitHash: commitHash.substring(0, 7),
            hasChanges,
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'rewind',
      description: `Restore the workspace to a previously created checkpoint.

**Parameters:**
- \`checkpointId\` (required): The ID of the checkpoint to restore to.
- \`mode\` (optional, default: 'hard'): 'hard' resets all changes; 'soft' keeps working directory changes.

**Returns:**
- Confirmation message with restored state details

**Example:**
Restore to a previous checkpoint:
<function_calls>
<invoke name="rewind">
<parameter name="checkpointId">ckpt-1234567890</parameter>
</invoke>
</function_calls>`,
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          checkpointId: {
            type: 'string',
            description: 'The ID of the checkpoint to restore to',
          },
          mode: {
            type: 'string',
            enum: ['hard', 'soft'],
            description: 'Reset mode: hard resets all changes, soft keeps working directory',
            default: 'hard',
          },
          workingDir: {
            type: 'string',
            description: 'Working directory (defaults to current directory)',
          },
        },
        required: ['checkpointId'],
      },
      handler: async ({ checkpointId, mode = 'hard', workingDir = '.' }) => {
        const cwd = resolve(workingDir);

        if (!isGitRepo(cwd)) {
          return { success: false, error: 'Not a git repository' };
        }

        const meta = readCheckpointMeta(cwd, checkpointId);
        if (!meta) {
          return { success: false, error: `Checkpoint not found: ${checkpointId}` };
        }

        try {
          // Reset to the checkpoint state
          if (mode === 'hard') {
            execGit('reset --hard HEAD', cwd);
            execGit(`checkout ${meta.branch}`, cwd, false);
            execGit(`reset --hard ${meta.head}`, cwd);
          } else {
            execGit(`checkout ${meta.head}`, cwd, false);
          }

          // Restore stashed changes if applicable
          if (meta.stashRef) {
            try {
              execGit('stash pop', cwd);
            } catch {
              // Stash may have been dropped; ignore
            }
          }

          deleteCheckpointMeta(cwd, checkpointId);

          return {
            success: true,
            message: `Restored to checkpoint: ${checkpointId}`,
            branch: meta.branch,
            commitHash: meta.head.substring(0, 7),
            mode,
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'list_checkpoints',
      description: 'List all available checkpoints in the workspace.',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          workingDir: {
            type: 'string',
            description: 'Working directory (defaults to current directory)',
          },
        },
      },
      handler: async ({ workingDir = '.' }) => {
        const cwd = resolve(workingDir);
        const dir = join(cwd, CHECKPOINT_DIR);

        if (!existsSync(dir)) {
          return { success: true, checkpoints: [] };
        }

        try {
          const checkpoints = [];
          const files = require('fs').readdirSync(dir);

          for (const file of files) {
            if (!file.endsWith('.json')) continue;
            const meta = readCheckpointMeta(cwd, file.replace('.json', ''));
            if (meta) {
              checkpoints.push({
                id: meta.id,
                reason: meta.reason,
                branch: meta.branch,
                commitHash: meta.head?.substring(0, 7),
                createdAt: meta.createdAt,
                stashOnly: meta.stashOnly,
              });
            }
          }

          checkpoints.sort((a, b) => b.createdAt - a.createdAt);

          return {
            success: true,
            checkpoints,
            count: checkpoints.length,
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },
  ];
}
