/**
 * Plugin System for Runtime Layer
 * 运行时插件系统
 */

export class PluginManager {
  #plugins = new Map();
  #hooks = new Map();
  #eventBus;

  constructor(eventBus) {
    this.#eventBus = eventBus;
  }

  register(plugin) {
    if (!plugin || !plugin.name) {
      throw new Error('Plugin must have a name');
    }
    
    if (this.#plugins.has(plugin.name)) {
      console.warn('Plugin "' + plugin.name + '" already registered');
      return;
    }
    
    this.#plugins.set(plugin.name, plugin);
    
    if (typeof plugin.initialize === 'function') {
      plugin.initialize({
        eventBus: this.#eventBus,
        getEngine: () => null
      });
    }
    
    if (plugin.hooks) {
      for (const [hookName, hookFn] of Object.entries(plugin.hooks)) {
        const boundHook = hookFn.bind(plugin);
        this.registerHook(hookName, boundHook);
      }
    }
    
    console.log('Plugin "' + plugin.name + '" registered');
    return true;
  }

  unregister(pluginName) {
    const plugin = this.#plugins.get(pluginName);
    if (!plugin) {
      return false;
    }
    
    if (typeof plugin.cleanup === 'function') {
      plugin.cleanup();
    }
    
    this.#plugins.delete(pluginName);
    console.log('Plugin "' + pluginName + '" unregistered');
    return true;
  }

  registerHook(hookName, hookFn) {
    if (!this.#hooks.has(hookName)) {
      this.#hooks.set(hookName, []);
    }
    this.#hooks.get(hookName).push(hookFn);
  }

  async triggerHook(hookName, ...args) {
    const hooks = this.#hooks.get(hookName) || [];
    const results = [];
    
    for (const hook of hooks) {
      try {
        const result = await hook(...args);
        results.push(result);
      } catch (error) {
        console.error('Error in hook "' + hookName + '":', error);
      }
    }
    
    return results;
  }

  getPlugin(name) {
    return this.#plugins.get(name);
  }

  getAllPlugins() {
    return Array.from(this.#plugins.values());
  }

  getPluginCount() {
    return this.#plugins.size;
  }
}

export const HOOKS = {
  BEFORE_AGENT_START: 'before_agent_start',
  AFTER_AGENT_START: 'after_agent_start',
  BEFORE_AGENT_STOP: 'before_agent_stop',
  AFTER_AGENT_STOP: 'after_agent_stop',
  
  BEFORE_TOOL_CALL: 'before_tool_call',
  AFTER_TOOL_CALL: 'after_tool_call',
  ON_TOOL_ERROR: 'on_tool_error',
  
  BEFORE_STATUS_UPDATE: 'before_status_update',
  AFTER_STATUS_UPDATE: 'after_status_update',
  
  ON_INPUT_RECEIVED: 'on_input_received',
  ON_OUTPUT_GENERATED: 'on_output_generated',
  
  BEFORE_INIT: 'before_init',
  AFTER_INIT: 'after_init',
  BEFORE_DISPOSE: 'before_dispose',
  AFTER_DISPOSE: 'after_dispose'
};

export function createPlugin(config) {
  return {
    name: config.name,
    version: config.version || '1.0.0',
    description: config.description || '',
    initialize: config.initialize,
    cleanup: config.cleanup,
    hooks: config.hooks || {}
  };
}

export const LoggerPlugin = createPlugin({
  name: 'logger',
  version: '1.0.0',
  description: 'Log all events to console',
  
  hooks: {
    'before_agent_start': async (input) => {
      console.log('[Logger] Starting agent with input:', input);
    },
    'after_agent_complete': async (result) => {
      console.log('[Logger] Agent completed with result:', result);
    },
    'before_tool_call': async (toolName, args) => {
      console.log('[Logger] Calling tool: ' + toolName, args);
    },
    'on_tool_error': async (toolName, error) => {
      console.error('[Logger] Tool ' + toolName + ' failed:', error);
    }
  }
});

export const PerformancePlugin = createPlugin({
  name: 'performance',
  version: '1.0.0',
  description: 'Track performance metrics',
  
  initialize({ eventBus }) {
    this.startTime = Date.now();
    this.calls = 0;
    this.events = [];
    
    eventBus.subscribe('*', (event) => {
      this.calls++;
      this.events.push({
        type: event.type,
        timestamp: Date.now()
      });
    });
  },
  
  cleanup() {
    console.log('[Performance] Plugin processed ' + this.calls + ' events in ' + (Date.now() - this.startTime) + 'ms');
  },
  
  hooks: {
    'before_agent_start': async () => {
      this.agentStartTime = Date.now();
    },
    'after_agent_complete': async () => {
      console.log('[Performance] Agent took ' + (Date.now() - this.agentStartTime) + 'ms');
    }
  }
});
