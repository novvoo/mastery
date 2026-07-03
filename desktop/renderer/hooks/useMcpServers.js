import { useState, useCallback } from 'react';

export function useMcpServers() {
  const [mcpServers, setMcpServers] = useState([]);

  const handleAddMcpServer = useCallback((server) => {
    setMcpServers((prev) => [...prev, server]);
  }, []);

  const handleDeleteMcpServer = useCallback((id) => {
    setMcpServers((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const handleToggleMcpServer = useCallback((id) => {
    setMcpServers((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, status: s.status === 'connected' ? 'disconnected' : 'connected' } : s,
      ),
    );
  }, []);

  const handleConnectMcpServer = useCallback((id) => {
    setMcpServers((prev) => prev.map((s) => (s.id === id ? { ...s, status: 'connecting' } : s)));
  }, []);

  return {
    mcpServers,
    setMcpServers,
    handleAddMcpServer,
    handleDeleteMcpServer,
    handleToggleMcpServer,
    handleConnectMcpServer,
  };
}
