const STORAGE_KEY = 'agent_message_queue_v1';

let queue = [];
let isProcessing = false;

const listeners = new Map();

function on(event, callback) {
  if (!listeners.has(event)) {
    listeners.set(event, new Set());
  }
  listeners.get(event).add(callback);
  return () => listeners.get(event)?.delete(callback);
}

function emit(event, payload) {
  const set = listeners.get(event);
  if (set) {
    for (const cb of set) {
      try {
        cb(payload);
      } catch (e) {
        console.error('[message-queue] listener error:', e);
      }
    }
  }
}

function persist() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(queue.map((item) => ({ input: item.input, timestamp: item.timestamp }))),
    );
  } catch {}
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        queue = parsed.map((item, index) => ({
          id: `q_${Date.now()}_${index}`,
          input: String(item.input || ''),
          timestamp: item.timestamp || Date.now(),
        }));
      }
    }
  } catch {
    queue = [];
  }
}

loadPersisted();

function emitChange() {
  emit('change', getSnapshot());
}

export function getQueue() {
  return [...queue];
}

export function getSnapshot() {
  return Object.freeze([...queue]);
}

export function getQueueLength() {
  return queue.length;
}

export function hasQueuedMessages() {
  return queue.length > 0;
}

export function peekNext() {
  return queue[0] || null;
}

export function enqueueMessage(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) {
    return null;
  }
  const item = {
    id: `q_${Date.now()}_${queue.length}`,
    input: trimmed,
    timestamp: Date.now(),
  };
  queue.push(item);
  persist();
  emitChange();
  return item;
}

export function dequeueMessage() {
  if (queue.length === 0) {
    return null;
  }
  const item = queue.shift();
  persist();
  emitChange();
  return item;
}

export function removeMessage(id) {
  const idx = queue.findIndex((item) => item.id === id);
  if (idx === -1) {
    return false;
  }
  queue.splice(idx, 1);
  persist();
  emitChange();
  return true;
}

export function clearQueue() {
  if (queue.length === 0) {
    return;
  }
  queue = [];
  persist();
  emitChange();
}

export function moveMessage(id, direction) {
  const idx = queue.findIndex((item) => item.id === id);
  if (idx === -1) return false;
  const newIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (newIdx < 0 || newIdx >= queue.length) return false;
  const [item] = queue.splice(idx, 1);
  queue.splice(newIdx, 0, item);
  persist();
  emitChange();
  return true;
}

export function setProcessing(value) {
  isProcessing = Boolean(value);
  emit('processing', isProcessing);
}

export function isQueueProcessing() {
  return isProcessing;
}

export function subscribeQueue(callback) {
  return on('change', callback);
}

export function subscribeProcessing(callback) {
  return on('processing', callback);
}

export function getQueuePreview(maxItems = 3, maxLength = 60) {
  return queue.slice(0, maxItems).map((item) => ({
    id: item.id,
    preview:
      typeof item.input === 'string' && item.input.length > maxLength
        ? item.input.slice(0, maxLength) + '...'
        : String(item.input ?? ''),
  }));
}
