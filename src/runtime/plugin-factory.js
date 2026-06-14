export function createPlugin(config) {
  return {
    name: config.name,
    version: config.version || '1.0.0',
    description: config.description || '',
    dependencies: config.dependencies || [],
    defaultConfig: config.defaultConfig || {},
    configSchema: config.configSchema || null,
    initialize: config.initialize,
    cleanup: config.cleanup,
    hooks: config.hooks || {},
    middlewares: config.middlewares || []
  };
}
