#!/usr/bin/env bun
/**
 * AI Engineering Mastery Agent public entrypoint.
 *
 * Keep this file thin so importing the package does not start the interactive CLI.
 *
 * - CLI entry: runCli, AIEngineeringAgent, handleCliArgs
 * - Library API: re-exported from ./runtime/index.js (single source of truth)
 */

import { pathToFileURL } from 'url';
import AIEngineeringAgent, { handleCliArgs } from './cli/agent-app.js';

export async function runCli(argv = process.argv.slice(2)) {
  if (!(await handleCliArgs(argv))) {
    const app = new AIEngineeringAgent();
    await app.run();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (import.meta.url === invokedPath) {
  runCli().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { AIEngineeringAgent, handleCliArgs };
export default AIEngineeringAgent;

export * from './runtime/index.js';
