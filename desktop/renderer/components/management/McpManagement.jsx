/**
 * McpManagement — MCP（Model Context Protocol）管理组件
 *
 * 管理 MCP 服务器连接：添加/删除/连接/断开。
 * 本次实现 UI 骨架和基础列表显示，连接逻辑可后续迭代。
 */
import React, { useState, useCallback } from 'react';
import Switch from '../ui/Switch.jsx';
import { t } from '../../i18n.js';
import { styles } from '../../app/styles.js';

let _serverIdCounter = Date.now();

function generateServerId() {
  return `mcp_${++_serverIdCounter}`;
}

const SERVER_TYPES = {
  stdio: { label: 'STDIO', color: 'var(--primary-color)' },
  http: { label: 'HTTP', color: 'var(--success-color)' },
  websocket: { label: 'WebSocket', color: 'var(--info-color)' },
};

export default function McpManagement({
  mcpServers = [],
  onAddServer,
  onDeleteServer,
  onToggleServer,
  onConnectServer,
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({
    name: '',
    type: 'http',
    url: '',
    command: '',
    args: '',
    enabled: true,
  });

  const handleAdd = useCallback(() => {
    const server = {
      id: generateServerId(),
      ...addForm,
      status: 'disconnected',
      tools: [],
      resources: [],
    };
    onAddServer && onAddServer(server);
    setShowAddForm(false);
    setAddForm({ name: '', type: 'http', url: '', command: '', args: '', enabled: true });
  }, [addForm, onAddServer]);

  const rowHover = {
    onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'var(--glass-bg-light)',
    onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'transparent',
  };

  return (
    <div style={styles.mgmtContentInner}>
      <div style={styles.mgmtContentHeader}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>{t('management.mcp')}</h3>
        <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
          {t('management.mcp_desc')}
        </p>
      </div>

      {/* MCP Server List */}
      {mcpServers.length === 0 && !showAddForm && (
        <div style={{
          padding: '32px 16px',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: '13px',
          border: '1px dashed var(--glass-border)',
          borderRadius: '8px',
          marginTop: '12px',
        }}>
          <div style={{ fontSize: '28px', marginBottom: '8px' }}>🔌</div>
          <div>{t('management.mcp_empty')}</div>
          <button
            style={{ ...styles.modelAddBtn, marginTop: '12px' }}
            onClick={() => setShowAddForm(true)}
          >
            + {t('management.mcp_add_server')}
          </button>
        </div>
      )}

      {mcpServers.map(server => (
        <div key={server.id} style={styles.mcpServerCard}>
          <div style={styles.mcpServerHeader}>
            <div style={styles.mcpServerInfo}>
              <span style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor:
                  server.status === 'connected' ? 'var(--success-color)'
                  : server.status === 'connecting' ? 'var(--warning-color)'
                  : 'var(--text-muted)',
                marginRight: '8px',
              }} />
              <span style={{ fontWeight: 600, fontSize: '13px' }}>{server.name}</span>
              <span style={{
                fontSize: '10px',
                padding: '1px 6px',
                borderRadius: '3px',
                backgroundColor: 'var(--glass-bg-light)',
                color: SERVER_TYPES[server.type]?.color || 'var(--text-muted)',
                marginLeft: '8px',
              }}>
                {SERVER_TYPES[server.type]?.label || server.type}
              </span>
            </div>
            <div style={styles.modelCardActions}>
              <span style={{
                fontSize: '10px',
                color: server.status === 'connected' ? 'var(--success-color)' : 'var(--text-muted)',
                marginRight: '8px',
              }}>
                {server.status === 'connected' ? t('management.mcp_connected')
                  : server.status === 'connecting' ? t('management.mcp_connecting')
                  : t('management.mcp_disconnected')}
              </span>
              {server.status !== 'connected' ? (
                <button
                  style={{ ...styles.modelActionBtn, color: 'var(--primary-color)' }}
                  onClick={() => onConnectServer && onConnectServer(server.id)}
                  title={t('management.mcp_connect')}
                >
                  ▶
                </button>
              ) : (
                <button
                  style={{ ...styles.modelActionBtn, color: 'var(--warning-color)' }}
                  onClick={() => onToggleServer && onToggleServer(server.id)}
                  title={t('management.mcp_disconnect')}
                >
                  ■
                </button>
              )}
              <button
                style={{ ...styles.modelActionBtn, color: 'var(--error-color)' }}
                onClick={() => onDeleteServer && onDeleteServer(server.id)}
                title={t('management.delete')}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Tools count */}
          {server.tools && server.tools.length > 0 && (
            <div style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              padding: '4px 16px 8px',
            }}>
              {t('management.mcp_tools_count', { count: server.tools.length })}: {server.tools.slice(0, 5).join(', ')}{server.tools.length > 5 ? '...' : ''}
            </div>
          )}
        </div>
      ))}

      {/* Add Server Button */}
      <button
        style={styles.modelAddBtn}
        onClick={() => setShowAddForm(true)}
      >
        + {t('management.mcp_add_server')}
      </button>

      {/* Add Server Form */}
      {showAddForm && (
        <div style={{ ...styles.mcpServerCard, marginTop: '8px', border: '1px solid var(--primary-soft)' }}>
          <div style={styles.modelForm}>
            <div style={styles.formRow}>
              <label style={styles.formLabel}>{t('management.mcp_server_name')}</label>
              <input
                style={styles.formInput}
                value={addForm.name}
                onChange={(e) => setAddForm(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. filesystem-server"
              />
            </div>

            <div style={styles.formRow}>
              <label style={styles.formLabel}>{t('management.mcp_server_type')}</label>
              <select
                style={styles.formInput}
                value={addForm.type}
                onChange={(e) => setAddForm(p => ({ ...p, type: e.target.value }))}
              >
                {Object.entries(SERVER_TYPES).map(([value, info]) => (
                  <option key={value} value={value}>{info.label}</option>
                ))}
              </select>
            </div>

            {addForm.type === 'http' || addForm.type === 'websocket' ? (
              <div style={styles.formRow}>
                <label style={styles.formLabel}>URL</label>
                <input
                  style={styles.formInput}
                  value={addForm.url}
                  onChange={(e) => setAddForm(p => ({ ...p, url: e.target.value }))}
                  placeholder={addForm.type === 'websocket' ? 'ws://localhost:8080' : 'http://localhost:8080'}
                />
              </div>
            ) : (
              <>
                <div style={styles.formRow}>
                  <label style={styles.formLabel}>{t('management.mcp_command')}</label>
                  <input
                    style={styles.formInput}
                    value={addForm.command}
                    onChange={(e) => setAddForm(p => ({ ...p, command: e.target.value }))}
                    placeholder="e.g. npx"
                  />
                </div>
                <div style={styles.formRow}>
                  <label style={styles.formLabel}>{t('management.mcp_args')}</label>
                  <input
                    style={styles.formInput}
                    value={addForm.args}
                    onChange={(e) => setAddForm(p => ({ ...p, args: e.target.value }))}
                    placeholder="e.g. -y @modelcontextprotocol/server-filesystem /tmp"
                  />
                </div>
              </>
            )}

            <div style={styles.modelFormActions}>
              <button style={styles.textButton} onClick={() => setShowAddForm(false)}>
                {t('common.cancel')}
              </button>
              <button
                style={styles.primaryAction}
                onClick={handleAdd}
                disabled={!addForm.name.trim()}
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
