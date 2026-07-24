import { useCallback, useMemo, useState } from 'react';
import {
  createBrowserCapabilityGraph,
  createCapabilityGraph,
} from '../app/capabilities/capability-graph.js';

export function useCapabilities(ipc) {
  const [manifest, setManifest] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setStatus('loading');
    try {
      const [capabilityResult, contractResult] = await Promise.all([
        ipc.getCapabilities(),
        ipc.getCommandContracts(),
      ]);
      const nextManifest = Array.isArray(capabilityResult?.capabilities)
        ? capabilityResult.capabilities
        : [];
      const nextContracts = Array.isArray(contractResult) ? contractResult : [];
      setManifest(nextManifest);
      setContracts(nextContracts);
      setError(null);
      setStatus('ready');
      return createCapabilityGraph(nextManifest, nextContracts);
    } catch (nextError) {
      setError(nextError);
      setStatus('degraded');
      return createBrowserCapabilityGraph();
    }
  }, [ipc]);

  const graph = useMemo(
    () => (status === 'idle' || status === 'degraded' || status === 'loading') && manifest.length === 0
      ? createBrowserCapabilityGraph()
      : createCapabilityGraph(manifest, contracts),
    [manifest, contracts, status],
  );

  return { graph, status, error, refresh };
}
