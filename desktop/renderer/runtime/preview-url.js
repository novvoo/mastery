const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

export function normalizePreviewUrlInput(value) {
  const input = String(value || '').trim();
  if (!input) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `http://${input}`);
    return ['http:', 'https:'].includes(url.protocol) && LOCAL_HOSTS.has(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function formatPreviewUrlInput(value) {
  const normalized = normalizePreviewUrlInput(value);
  if (!normalized) return String(value || '');
  const url = new URL(normalized);
  return `${url.host}${url.pathname === '/' ? '' : url.pathname}${url.search}${url.hash}`;
}
