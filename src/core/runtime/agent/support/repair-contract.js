import { existsSync } from 'fs';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';

const COMMAND_RE =
  /\b((?:npm\s+(?:run\s+)?test|bun\s+(?:run\s+)?test|pnpm\s+(?:run\s+)?test|yarn\s+test)(?:\s+[^\n`'";|&]+)?)/gi;

function normalizeCommand(command) {
  return String(command || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,:]+$/, '');
}

function runnerOf(command) {
  const match = normalizeCommand(command).match(/^(npm|bun|pnpm|yarn)\b/i);
  return match?.[1]?.toLowerCase() || 'unknown';
}

function commandsFromText(text) {
  return [...String(text || '').matchAll(COMMAND_RE)].map((match) => normalizeCommand(match[1]));
}

async function readIfPresent(path) {
  if (!existsSync(path)) return null;
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

export async function discoverRepairContract(workingDirectory) {
  const root = workingDirectory || process.cwd();
  const sources = [];
  const pkgPath = join(root, 'package.json');
  const pkgText = await readIfPresent(pkgPath);
  if (pkgText) {
    try {
      const pkg = JSON.parse(pkgText);
      if (pkg.scripts?.test) {
        sources.push({ source: 'package.json#scripts.test', commands: [`npm test`] });
        const scriptCommands = commandsFromText(pkg.scripts.test);
        if (scriptCommands.length) sources.at(-1).commands.push(...scriptCommands);
      }
    } catch {
      // Invalid manifests are reported by normal project diagnostics.
    }
  }

  const textSources = ['CONTEXT.md', 'README.md'];
  const adrDir = join(root, 'docs', 'adr');
  if (existsSync(adrDir)) {
    try {
      const adrFiles = (await readdir(adrDir)).filter((name) => name.endsWith('.md')).sort();
      textSources.push(...adrFiles.map((name) => join('docs', 'adr', name)));
    } catch {}
  }
  const workflowDir = join(root, '.github', 'workflows');
  if (existsSync(workflowDir)) {
    try {
      const workflows = (await readdir(workflowDir))
        .filter((name) => /\.ya?ml$/i.test(name))
        .sort();
      textSources.push(...workflows.map((name) => join('.github', 'workflows', name)));
    } catch {}
  }

  for (const relativePath of textSources) {
    const text = await readIfPresent(join(root, relativePath));
    if (!text) continue;
    const commands = commandsFromText(text);
    if (commands.length) sources.push({ source: relativePath, commands });
  }

  const declaredCommands = [...new Set(sources.flatMap((entry) => entry.commands))];
  const runners = [
    ...new Set(declaredCommands.map(runnerOf).filter((runner) => runner !== 'unknown')),
  ];
  return {
    sources,
    declaredCommands,
    runners,
    hasRunnerConflict: runners.length > 1,
  };
}

export function formatRepairContract(contract) {
  if (!contract?.declaredCommands?.length) return '';
  const lines = ['Discovered test contract:'];
  for (const source of contract.sources) {
    lines.push(`- ${source.source}: ${source.commands.join(', ')}`);
  }
  if (contract.hasRunnerConflict) {
    lines.push(
      `Runner conflict detected (${contract.runners.join(', ')}). Treat every declared runner as required until the contract is explicitly reconciled.`,
    );
    lines.push(
      'Before editing, call resolve_test_contract with every declared runner, the selected authority, evidence-based rationale, and every conflicting file that must be synchronized.',
    );
  }
  return lines.join('\n');
}
