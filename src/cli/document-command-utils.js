import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { platform } from 'os';
import { resolve } from 'path';

export function stripWrappingQuotes(value) {
  const text = String(value || '').trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) {
    return `${value} B`;
  }
  const units = ['KB', 'MB', 'GB'];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

export function stripTrailingReferencePunctuation(value) {
  return String(value || '').replace(/[.,;:!?，。；：！？、)）\]】]+$/u, '');
}

export async function chooseDocumentFile() {
  if (platform() !== 'darwin') {
    return '';
  }

  try {
    return execFileSync(
      'osascript',
      ['-e', 'POSIX path of (choose file with prompt "Choose a document to add to RAG")'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
  } catch {
    return '';
  }
}

export function extractDocumentReferences(userInput, workingDirectory) {
  const refs = [];
  const pattern = /(^|\s)@(?:"([^"]+)"|'([^']+)'|([^\s]+))/g;
  for (const match of userInput.matchAll(pattern)) {
    const rawRef = match[2] || match[3] || match[4] || '';
    const source = stripTrailingReferencePunctuation(stripWrappingQuotes(rawRef));
    if (!source) {
      continue;
    }

    const isUrl = /^https?:\/\//i.test(source);
    const absolutePath = isUrl ? source : resolve(workingDirectory, source);
    if (!isUrl && !existsSync(absolutePath)) {
      continue;
    }

    refs.push(isUrl ? source : absolutePath);
  }

  return Array.from(new Set(refs));
}
