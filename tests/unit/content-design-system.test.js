import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const CSS_PATH = path.resolve(import.meta.dir, '../../desktop/renderer/index.css');
const MESSAGE_STYLES_PATH = path.resolve(
  import.meta.dir,
  '../../desktop/renderer/components/message-log/styles/MessageLog.styles.js',
);
const MESSAGE_LOG_PATH = path.resolve(
  import.meta.dir,
  '../../desktop/renderer/components/MessageLog.jsx',
);

describe('content design system', () => {
  test('defines and consumes shared content typography tokens', () => {
    const css = readFileSync(CSS_PATH, 'utf8');
    const messageStyles = readFileSync(MESSAGE_STYLES_PATH, 'utf8');

    for (const token of [
      '--content-font-size',
      '--content-line-height',
      '--content-block-gap',
      '--content-code-line-height',
      '--content-measure',
    ]) {
      expect(css).toContain(`${token}:`);
      expect(`${css}\n${messageStyles}`).toContain(`var(${token})`);
    }
    expect(css).toMatch(/\.markdown\s*\{[^}]*line-height:\s*var\(--content-line-height\)/s);
  });

  test('keeps prose readable and wide tables horizontally recoverable', () => {
    const css = readFileSync(CSS_PATH, 'utf8');
    const lineHeight = Number(css.match(/--content-line-height:\s*([\d.]+)/)?.[1]);
    const tableScrollRule = css.match(/\.markdown-table-scroll\s*\{([^}]*)\}/s)?.[1] ?? '';
    const messageLog = readFileSync(MESSAGE_LOG_PATH, 'utf8');

    expect(lineHeight).toBeGreaterThanOrEqual(1.5);
    expect(tableScrollRule).toMatch(/overflow-x:\s*auto/);
    expect(tableScrollRule).not.toMatch(/\boverflow:\s*hidden/);
    expect(messageLog).toContain('className="markdown-table-scroll"');
    expect(messageLog).toContain('role="region"');
    expect(messageLog).toContain('tabIndex={0}');
    expect(css).toMatch(/\.markdown pre\s*\{[^}]*white-space:\s*pre/s);
  });

  test('keeps Markdown presentation in the shared stylesheet', () => {
    const css = readFileSync(CSS_PATH, 'utf8');
    const messageLog = readFileSync(MESSAGE_LOG_PATH, 'utf8');

    expect(messageLog).not.toContain('<style>');
    expect(messageLog).not.toContain("style={{ maxWidth: '100%', height: 'auto'");
    expect(css).toContain('.markdown .markup-block');
    expect(css).toContain('@keyframes thinkingPulse');
    expect(css).toContain('@keyframes streamingDot');
    expect(css).toContain('@keyframes streamingSkeleton');
  });

  test('message style module does not introduce hard-coded hex colors', () => {
    const messageStyles = readFileSync(MESSAGE_STYLES_PATH, 'utf8');
    expect(messageStyles).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
