/**
 * CLI Adapter Entry Point
 * Provides backward-compatible CLI interface using the new runtime
 */

import { createAgentEngine, PlatformType } from '../../runtime/index.js';
import { getEventBus } from '../../runtime/event-bus.js';
import { CLIUIAdapter } from './ui-adapter.js';

/**
 * Run the CLI adapter with backward compatibility
 */
export async function runCLIRuntime(options = {}) {
  const workingDirectory = options.workingDirectory || process.cwd();
  const debug = options.debug || false;
  const maxIterations = options.maxIterations || 180;

  // Create the agent engine
  const engine = createAgentEngine({
    platform: PlatformType.CLI,
    workingDirectory,
    debug,
    maxIterations
  });

  try {
    // Initialize engine
    await engine.initialize();
    
    // Return engine for use
    return {
      engine,
      toolRegistry: engine.getToolRegistry(),
      memoryManager: engine.getMemoryManager(),
      securityPolicy: engine.getSecurityPolicy()
    };
  } catch (error) {
    engine.dispose();
    throw error;
  }
}

export { CLIUIAdapter };
