/**
 * 统一错误系统入口
 *
 * 参考 oh-my-pi 的设计：集中管理所有错误类型、错误码、严重级别。
 * 所有子系统的自定义错误统一注册在这里。
 */

export { AppError, ErrorSeverity, ErrorCode } from './app-error.js';

// —— 各子系统自定义错误可以在这里 re-export ——
// 例如：
// export { PatchParseError, PatchApplyError } from '../harness/hashline/project-adapter.js';
// export { SessionFileStoreError } from '../session/session-file-store.js';
