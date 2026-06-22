/**
 * 统一工具注册入口 —— Hashline + LSP 工具集合。
 *
 * 对外暴露：
 *  - createCodeTools()       — 创建所有代码相关工具（文件系统 + LSP + Hashline）
 *  - createHashlineTools()   — 创建 Hashline 相关工具（apply_hashline_patch）
 *  - createLSPTools()        — 创建 LSP 相关工具（rename, references, etc.）
 */

import { createFileSystemTools } from '../../../tools/filesystem/filesystem-tools.js';
import { createLSPTools as createLSPToolsImpl } from '../../../../lsp/lsp-tools.js';

export function createHashlineTools() {
  const fsTools = createFileSystemTools();
  return fsTools.filter(t => t.name === 'apply_hashline_patch');
}

export function createLSPTools(options) {
  return createLSPToolsImpl(options);
}

export function createCodeTools(options = {}) {
  const tools = [];

  tools.push(...createFileSystemTools());

  if (options.lspManager || options.hashlinePatcher || options.contentStore) {
    tools.push(...createLSPToolsImpl(options));
  }

  return tools;
}

export function registerCodeTools(toolRegistry, options = {}) {
  const tools = createCodeTools(options);
  for (const tool of tools) {
    try {
      toolRegistry.register(tool);
    } catch {
      // 忽略重复注册
    }
  }
  return tools.length;
}