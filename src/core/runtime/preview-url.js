/**
 * Preview URL validation and formatting.
 * 纯逻辑模块，不依赖 React/Electron，可被 Desktop 和 CLI 共享。
 */

const LOCAL_PREVIEW_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * 规范化并验证预览 URL（仅允许 localhost/127.0.0.1）
 * @param {string} value - 用户输入的 URL
 * @returns {string|null} 规范化后的 URL，无效返回 null
 */
export function normalizePreviewUrlInput(value) {
  const input = String(value || '').trim();
  if (!input) {return null;}

  const candidate = /^https?:\/\//i.test(input) ? input : `http://${input}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (!LOCAL_PREVIEW_HOSTS.has(parsed.hostname)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * 格式化预览 URL 用于显示
 * @param {string} value - 用户输入的 URL
 * @returns {string} 格式化后的显示字符串
 */
export function formatPreviewUrlInput(value) {
  const normalized = normalizePreviewUrlInput(value);
  if (!normalized) {return String(value || '');}

  const parsed = new URL(normalized);
  const path = parsed.pathname === '/' ? '' : parsed.pathname;
  return `${parsed.host}${path}${parsed.search}${parsed.hash}`;
}
