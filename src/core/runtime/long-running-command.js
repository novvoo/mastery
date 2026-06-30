import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const MAX_SNIPPET_CHARS = 5000;
const CLASSIFIER_TIMEOUT_MS = 5000;

const NON_LONG_RUNNING_COMMAND_PATTERNS = [
  {
    pattern:
      /\b(?:npm|pnpm|yarn|bun)\s+(?:install|i|add|ci|exec|dlx)\b/i,
    reason: 'Package install command — finite shell task',
  },
  {
    pattern:
      /\b(?:npm|pnpm|yarn|bun)\s+run\s+(?!dev\b|serve\b|start\b)[\w:-]+/i,
    reason: 'Package run script — finite shell task',
  },
  {
    pattern: /\b(?:npm|pnpm|yarn|bun)\s+test\b/i,
    reason: 'Package test command — finite shell task',
  },
  {
    pattern: /\b(?:vitest|jest|mocha)\b(?:\s|$)/i,
    reason: 'Test runner invocation — finite shell task',
  },
  {
    pattern: /\bvite\s+(?:build|preview|optimize|test|benchmark)\b/i,
    reason: 'Vite build / utility command — finite shell task',
  },
];

const LONG_RUNNING_COMMAND_PATTERNS = [
  {
    pattern: /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|serve|start)(?:\b|:)/i,
    reason: 'Starts a package script that is commonly a persistent dev server',
  },
  {
    pattern:
      /\b(?:vite|vite-preview|webpack-dev-server|webpack\s+serve|parcel|live-server|http-server)\b/i,
    reason: 'Starts a local development server',
  },
  {
    pattern: /\b(?:next|nuxt|astro)\s+dev\b/i,
    reason: 'Starts a framework development server',
  },
  {
    pattern: /\b(?:react-scripts|svelte-kit)\s+start\b/i,
    reason: 'Starts a framework development server',
  },
  {
    pattern: /\b(?:nodemon|tsx\s+watch|node\s+--watch|deno\s+task\s+dev)\b/i,
    reason: 'Starts a watcher process',
  },
  {
    pattern: /\b(?:jest|vitest|mocha|tsc|webpack|rollup|esbuild)\b[\s\S]*\s(?:--watch|-w)\b/i,
    reason: 'Starts a watch-mode command',
  },
  {
    pattern:
      /\b(?:python3?|uvicorn|gunicorn|flask|fastapi|streamlit)\b[\s\S]*(?:--reload|runserver|streamlit\s+run)\b/i,
    reason: 'Starts a Python server or reload watcher',
  },
  {
    pattern: /\b(?:rails|bin\/rails)\s+(?:server|s)\b/i,
    reason: 'Starts a Rails server',
  },
];

export async function classifyLongRunningCommand(command, options = {}) {
  const normalized = String(command || '').trim();
  if (!normalized) {
    return { isLongRunning: false, confidence: 0, reason: 'Empty command' };
  }

  const deterministic = detectLongRunningCommand(normalized);
  if (deterministic) {
    return deterministic;
  }

  const modelProvider = options.modelProvider;
  if (!modelProvider || typeof modelProvider.chat !== 'function') {
    return {
      isLongRunning: false,
      confidence: 0,
      reason: 'No model provider available for long-running command classification',
    };
  }

  const context = collectCommandContext(normalized, options.cwd || process.cwd());
  const prompt = buildClassifierPrompt(normalized, context);

  try {
    const response = await withTimeout(
      () =>
        modelProvider.chat(
          [
            {
              role: 'system',
              content:
                'You classify terminal commands for an autonomous coding agent. Return strict JSON only.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          { maxTokens: 300 },
        ),
      options.timeoutMs || CLASSIFIER_TIMEOUT_MS,
    );

    return normalizeClassification(parseJsonObject(response?.text || response));
  } catch (error) {
    return {
      isLongRunning: false,
      confidence: 0,
      reason: `Long-running classifier unavailable: ${error.message}`,
    };
  }
}

function detectLongRunningCommand(command) {
  const segments = splitShellSegments(command);
  const searchableSegments = segments.length ? segments : [command];

  for (const segment of searchableSegments) {
    const normalizedSegment = normalizeShellSegment(segment);
    if (!normalizedSegment) {
      continue;
    }

    const exclusion = NON_LONG_RUNNING_COMMAND_PATTERNS.find(({ pattern }) =>
      pattern.test(normalizedSegment),
    );
    if (exclusion) {
      continue;
    }

    const longRunningMatch = LONG_RUNNING_COMMAND_PATTERNS.find(({ pattern }) =>
      pattern.test(normalizedSegment),
    );
    if (!longRunningMatch) {
      continue;
    }

    const compoundWithLongRunning =
      searchableSegments.filter((candidate) => normalizeShellSegment(candidate)).length > 1;

    return {
      isLongRunning: true,
      confidence: 0.95,
      reason: longRunningMatch.reason,
      recommendedTool: 'pty_start',
      longRunningSegment: normalizedSegment,
      compoundWithLongRunning,
    };
  }

  const allSegments = searchableSegments
    .map((segment) => normalizeShellSegment(segment))
    .filter(Boolean);

  const allExcluded =
    allSegments.length > 0 &&
    allSegments.every((segment) =>
      NON_LONG_RUNNING_COMMAND_PATTERNS.some(({ pattern }) => pattern.test(segment)),
    );

  if (allExcluded) {
    const matchedExclusion = NON_LONG_RUNNING_COMMAND_PATTERNS.find(({ pattern }) =>
      pattern.test(allSegments[0]),
    );
    if (matchedExclusion) {
      return {
        isLongRunning: false,
        confidence: 0.9,
        reason: matchedExclusion.reason,
        recommendedTool: 'shell',
      };
    }
  }

  return null;
}

function splitShellSegments(command) {
  return String(command || '')
    .split(/(?:&&|\|\||;|\n+)/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function normalizeShellSegment(segment) {
  return String(segment || '')
    .replace(/^\s*(?:#.*\n\s*)+/g, '')
    .replace(/\s+#.*$/g, '')
    .trim();
}

function collectCommandContext(command, cwd) {
  const files = extractCommandFiles(command)
    .map((file) => {
      const absolutePath = resolve(cwd, file);
      if (!existsSync(absolutePath)) {
        return null;
      }

      try {
        return {
          path: file,
          snippet: readFileSync(absolutePath, 'utf8').slice(0, MAX_SNIPPET_CHARS),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .slice(0, 3);

  return { cwd, files };
}

function extractCommandFiles(command) {
  const tokens = command.match(/"[^"]+"|'[^']+'|[^\s;&|]+/g) || [];
  return tokens
    .map((token) => token.replace(/^['"]|['"]$/g, ''))
    .filter((token) => /\.[A-Za-z0-9]+$/.test(token));
}

function buildClassifierPrompt(command, context) {
  const files = context.files.length
    ? context.files.map((file) => `File: ${file.path}\n---\n${file.snippet}\n---`).join('\n\n')
    : 'No readable entrypoint files were found from the command arguments.';

  return `Decide whether this command should be started as a persistent PTY session instead of a foreground shell command.

Use PTY when the command is expected to remain resident, needs manual input, opens a GUI/game loop, starts a server, starts a watcher, or needs incremental output and an explicit stop.
Use foreground shell when it is expected to finish on its own, even if it may take a while.

Return strict JSON with:
{
  "isLongRunning": boolean,
  "confidence": number from 0 to 1,
  "reason": "short reason",
  "recommendedTool": "pty_start" or "shell"
}

Command:
${command}

Working directory:
${context.cwd}

Relevant command file snippets:
${files}`;
}

function parseJsonObject(value) {
  if (value && typeof value === 'object') {
    return value;
  }

  const text = String(value || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || text.match(/\{[\s\S]*\}/)?.[0] || text;
  return JSON.parse(candidate);
}

function normalizeClassification(raw) {
  const confidence = Number(raw?.confidence ?? 0);
  const isLongRunning = Boolean(raw?.isLongRunning) && confidence >= 0.55;
  return {
    isLongRunning,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    reason: String(
      raw?.reason ||
        (isLongRunning
          ? 'Model classified command as long-running'
          : 'Model classified command as foreground'),
    ),
    recommendedTool: isLongRunning ? 'pty_start' : 'shell',
  };
}

function withTimeout(factory, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`classification timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    Promise.resolve()
      .then(factory)
      .then((value) => {
        clearTimeout(timer);
        resolvePromise(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}
