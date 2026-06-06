/**
 * File System Tools: read_file, write_file, edit_file, search, glob, list_dir
 */

import { readFile, writeFile, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { ToolCategory } from '../../core/types.js';

export function createFileSystemTools() {
  return [
    {
      name: 'read_file',
      description: 'Read the contents of a file. Returns the file content as text.',
      category: ToolCategory.FILESYSTEM,
      params: {
        path: { type: 'string', description: 'File path relative to working directory' },
        offset: { type: 'number', description: 'Line number to start reading from (1-based)' },
        limit: { type: 'number', description: 'Number of lines to read' },
      },
      required: ['path'],
      handler: async ({ path, offset, limit }, ctx) => {
        const fullPath = resolve(join(ctx.workingDirectory, path));
        if (!existsSync(fullPath)) {return `Error: File not found: ${path}`;}

        try {
          let content = await readFile(fullPath, 'utf-8');
          const lines = content.split('\n');

          if (offset || limit) {
            const start = ((offset) || 1) - 1;
            const end = start + ((limit) || lines.length);
            const sliced = lines.slice(start, end);
            content = sliced.map((line, i) => `${start + i + 1}: ${line}`).join('\n');
          } else {
            content = lines.map((line, i) => `${i + 1}: ${line}`).join('\n');
          }

          // Update file map
          await ctx.memoryManager.updateFileMap(path, 'read');

          return content;
        } catch (error) {
          return `Error reading file: ${error instanceof Error ? error.message : error}`;
        }
      },
    },

    {
      name: 'write_file',
      description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
      category: ToolCategory.FILESYSTEM,
      params: {
        path: { type: 'string', description: 'File path relative to working directory' },
        content: { type: 'string', description: 'Content to write to the file' },
      },
      required: ['path', 'content'],
      handler: async ({ path, content }, ctx) => {
        const fullPath = resolve(join(ctx.workingDirectory, path));

        try {
          const { mkdir } = await import('fs/promises');
          const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
          if (dir && !existsSync(dir)) {
            await mkdir(dir, { recursive: true });
          }

          await writeFile(fullPath, content, 'utf-8');
          await ctx.memoryManager.updateFileMap(path, 'created/modified');
          return `File written successfully: ${path} (${content.split('\n').length} lines)`;
        } catch (error) {
          return `Error writing file: ${error instanceof Error ? error.message : error}`;
        }
      },
    },

    {
      name: 'edit_file',
      description: 'Edit a file by replacing a specific text segment. Use this for surgical changes.',
      category: ToolCategory.FILESYSTEM,
      params: {
        path: { type: 'string', description: 'File path relative to working directory' },
        old_text: { type: 'string', description: 'The exact text to find and replace' },
        new_text: { type: 'string', description: 'The replacement text' },
      },
      required: ['path', 'old_text', 'new_text'],
      handler: async ({ path, old_text, new_text }, ctx) => {
        const fullPath = resolve(join(ctx.workingDirectory, path));
        if (!existsSync(fullPath)) {return `Error: File not found: ${path}`;}

        try {
          const content = await readFile(fullPath, 'utf-8');
          if (!content.includes(old_text)) {
            return `Error: The specified old_text was not found in the file. Make sure it matches exactly.`;
          }

          const newContent = content.replace(old_text, new_text);
          await writeFile(fullPath, newContent, 'utf-8');
          await ctx.memoryManager.updateFileMap(path, 'edited');
          return `File edited successfully: ${path}`;
        } catch (error) {
          return `Error editing file: ${error instanceof Error ? error.message : error}`;
        }
      },
    },

    {
      name: 'search',
      description: 'Search for a pattern in files within the working directory. Returns matching lines with file paths and line numbers.',
      category: ToolCategory.FILESYSTEM,
      params: {
        pattern: { type: 'string', description: 'Search pattern (text or regex)' },
        file_pattern: { type: 'string', description: 'File glob pattern to filter files (e.g., "*.ts")' },
        max_results: { type: 'number', description: 'Maximum number of results to return (default 20, max 100)' },
      },
      required: ['pattern'],
      handler: async ({ pattern, file_pattern, max_results }, ctx) => {
        try {
          const { execSync } = await import('child_process');
          const HARD_MAX_RESULTS = 100;
          const SEARCH_TIMEOUT_MS = 30000;
          
          const max = Math.max(1, Math.min((max_results || 20), HARD_MAX_RESULTS));
          const fileFilter = file_pattern ? `--include="${file_pattern}"` : '';
          
          const excludeDirs = [
            '.git', 'node_modules', '.agent-data', '.automation',
            '.test-temp', 'dist', 'build', 'coverage', '.next', '.cache'
          ];
          const excludeArgs = excludeDirs.map(dir => `--exclude-dir="${dir}"`).join(' ');
          
          const cmd = `grep -rn --color=never ${excludeArgs} ${fileFilter} -m ${max} "${pattern}" ${ctx.workingDirectory} 2>/dev/null || true`;

          const result = execSync(cmd, { 
            encoding: 'utf-8', 
            maxBuffer: 5 * 1024 * 1024,
            timeout: SEARCH_TIMEOUT_MS
          });
          
          if (!result.trim()) {return `No matches found for pattern: ${pattern}`;}
          
          const lines = result.trim().split('\n');
          const limitedLines = lines.slice(0, HARD_MAX_RESULTS);
          
          return limitedLines.join('\n');
        } catch (error) {
          if (error.message && error.message.includes('timeout')) {
            return `Search timed out after 30 seconds. Try a more specific pattern or smaller scope.`;
          }
          return `Error searching: ${error instanceof Error ? error.message : error}`;
        }
      },
    },

    {
      name: 'glob',
      description: 'Find files matching a glob pattern in the working directory.',
      category: ToolCategory.FILESYSTEM,
      params: {
        pattern: { type: 'string', description: 'Glob pattern (e.g., "**/*.ts", "src/**/*.js")' },
      },
      required: ['pattern'],
      handler: async ({ pattern }, ctx) => {
        if (!pattern || typeof pattern !== 'string') {
          return 'Error: Missing required glob pattern.';
        }

        try {
          const { glob } = await import('glob');
          const files = await glob(pattern, {
            cwd: ctx.workingDirectory,
            absolute: false,
            ignore: ['**/node_modules/**', '**/.git/**'],
          });
          if (files.length === 0) {return `No files matched pattern: ${pattern}`;}
          return files.join('\n');
        } catch (error) {
          return `Error globbing: ${error instanceof Error ? error.message : error}`;
        }
      },
    },

    {
      name: 'list_dir',
      description: 'List files and directories at a given path.',
      category: ToolCategory.FILESYSTEM,
      params: {
        path: { type: 'string', description: 'Directory path relative to working directory (default: root)' },
      },
      required: [],
      handler: async ({ path }, ctx) => {
        const dirPath = resolve(join(ctx.workingDirectory, (path) || '.'));

        try {
          if (!existsSync(dirPath)) {return `Error: Directory not found: ${path || '.'}`;}
          const entries = await readdir(dirPath);
          /** @type {string[]} */
          const results = [];

          for (const entry of entries) {
            const fullPath = join(dirPath, entry);
            const s = await stat(fullPath);
            const prefix = s.isDirectory() ? 'D ' : 'F ';
            results.push(`${prefix}${entry}`);
          }

          return results.length > 0 ? results.join('\n') : '(empty directory)';
        } catch (error) {
          return `Error listing directory: ${error instanceof Error ? error.message : error}`;
        }
      },
    },
  ];
}
