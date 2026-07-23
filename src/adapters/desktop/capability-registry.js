export const CapabilityStatus = Object.freeze({
  AVAILABLE: 'available',
  DEGRADED: 'degraded',
  UNAVAILABLE: 'unavailable',
});

export class CapabilityRegistry {
  #capabilities = new Map();

  register(definition) {
    if (!definition?.id || typeof definition.id !== 'string') {
      throw new TypeError('capability requires a stable id');
    }
    const capability = Object.freeze({
      version: 1,
      status: CapabilityStatus.AVAILABLE,
      risk: 'standard',
      ...definition,
    });
    this.#capabilities.set(capability.id, capability);
    return capability;
  }

  setStatus(id, status, reason = null) {
    const current = this.#capabilities.get(id);
    if (!current) throw new Error(`unknown capability: ${id}`);
    if (!Object.values(CapabilityStatus).includes(status)) {
      throw new TypeError(`invalid capability status: ${status}`);
    }
    return this.register({ ...current, status, reason });
  }

  get(id) {
    return this.#capabilities.get(id) || null;
  }

  list() {
    return [...this.#capabilities.values()]
      .map((capability) => ({ ...capability }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}

export function createDesktopCapabilityRegistry() {
  const registry = new CapabilityRegistry();
  for (const capability of [
    { id: 'agent.runtime', owner: 'DesktopCore', transport: 'ipc', risk: 'high' },
    { id: 'workspace.files', owner: 'MainProcess', transport: 'ipc', risk: 'high' },
    { id: 'session.store', owner: 'MainProcess', transport: 'ipc' },
    {
      id: 'preview.process',
      owner: 'MainProcess',
      transport: 'ipc',
      risk: 'high',
      status: CapabilityStatus.UNAVAILABLE,
      reason: 'legacy preview runner removed; attach an externally managed local URL',
    },
    { id: 'preview.viewer', owner: 'Renderer', transport: 'local', risk: 'standard' },
    { id: 'terminal.execute', owner: 'MainProcess', transport: 'ipc', risk: 'critical' },
    { id: 'model.config', owner: 'MainProcess', transport: 'ipc', risk: 'critical' },
    { id: 'policy.engine', owner: 'MainProcess', transport: 'in-process', risk: 'critical' },
  ]) {
    registry.register(capability);
  }
  return registry;
}
