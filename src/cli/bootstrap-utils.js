import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { enhancedUI } from './enhanced-ui.js';
import {
  getMissingRequiredConfig,
  getProviderModel,
  getUserEnvPath,
} from '../core/runtime-config.js';

export function printCliHelp() {
  console.log(`AI Engineering Mastery Agent

Usage:
  agent                 Start the interactive agent
  agent setup           Run the first-time configuration wizard
  agent doctor          Check configuration and workspace readiness
  agent config-path     Print the user configuration file path
  agent --version       Print version
  agent --help          Show this help

Inside the agent:
  /help                 Show interactive commands
  /tools                List tools
  /status               Show runtime status
  /debug on|off         Toggle debug logs
  /menu                 Open interactive menu
  exit                  Quit

Configuration:
  Environment variables take priority, then .env in the current directory,
  then the user config file at:
  ${getUserEnvPath()}
`);
}

export function runDoctor() {
  const provider = process.env.MODEL_PROVIDER || 'openai';
  const model = getProviderModel(provider);
  const workingDirectory = resolve(process.env.WORKING_DIRECTORY || process.cwd());
  const missing = getMissingRequiredConfig();
  const userEnvPath = getUserEnvPath();

  console.log(enhancedUI.createHeader('Agent Doctor'));
  console.log(`Provider: ${provider}`);
  console.log(`Model: ${model}`);
  console.log(`Working directory: ${workingDirectory}`);
  console.log(`User config: ${userEnvPath}${existsSync(userEnvPath) ? ' (found)' : ' (missing)'}`);
  console.log(`Workspace: ${existsSync(workingDirectory) ? 'found' : 'will be created on startup'}`);

  if (missing.length > 0) {
    enhancedUI.error(`Missing required configuration: ${missing.join(', ')}`);
    console.log(`Run \`agent setup\` or edit ${userEnvPath}`);
    process.exitCode = 1;
    return;
  }

  enhancedUI.success('Configuration looks ready.');
}

export function getPackageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', '..', 'package.json'), 'utf8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}
