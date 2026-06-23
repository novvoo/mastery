/**
 * LSP 子系统 — IDE 级代码理解和重构能力。
 *
 * 出口：
 *  - LSPClient        JSON-RPC 客户端
 *  - ServerManager     多语言 server 管理
 *  - createLSPTools    创建 LSP 工具集
 *  - detectLanguage    文件 -> 语言 ID
 */

export { LSPClient, LSPClientError, LSPServerError } from './lsp-client.js';
export { ServerManager, detectLanguage } from './lsp-manager.js';
export { createLSPTools } from './lsp-tools.js';
export { LSPSandboxInstaller } from './lsp-sandbox-installer.js';
