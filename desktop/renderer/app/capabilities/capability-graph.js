export const UI_CAPABILITY_BINDINGS = Object.freeze({
  agent: 'agent.runtime',
  files: 'workspace.files',
  sessions: 'session.store',
  preview: 'preview.viewer',
  previewProcess: 'preview.process',
  terminal: 'terminal.execute',
  models: 'model.config',
  policy: 'policy.engine',
});

const UNKNOWN_CAPABILITY = Object.freeze({
  status: 'unavailable',
  reason: '能力清单尚未加载',
});

export function createCapabilityGraph(manifest = [], contracts = []) {
  const byId = new Map(manifest.map((capability) => [capability.id, { ...capability }]));
  const contractByChannel = new Map(
    contracts.map((contract) => [contract.channel, { ...contract }]),
  );

  const get = (id) => byId.get(id) || { id, ...UNKNOWN_CAPABILITY };
  const status = (id) => get(id).status;
  const canUse = (id) => status(id) === 'available';
  const isDegraded = (id) => status(id) === 'degraded';

  return {
    schemaVersion: 1,
    manifest: [...byId.values()],
    contracts: [...contractByChannel.values()],
    get,
    status,
    canUse,
    isDegraded,
    hasContract: (channel) => contractByChannel.has(channel),
    ui: Object.fromEntries(
      Object.entries(UI_CAPABILITY_BINDINGS).map(([surface, id]) => [
        surface,
        {
          ...get(id),
          enabled: canUse(id),
          degraded: isDegraded(id),
        },
      ]),
    ),
  };
}

export function createBrowserCapabilityGraph() {
  return createCapabilityGraph([
    {
      id: 'preview.viewer',
      version: 1,
      owner: 'Renderer',
      transport: 'local',
      risk: 'standard',
      status: 'available',
    },
  ]);
}
