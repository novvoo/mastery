/**
 * 工具面板组件
 * 展示当前对话中的工具活动，以及 Agent 可用的工具目录。
 */

import React, { useMemo, useState, useCallback } from 'react';

const styles = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },

  section: {
    borderBottom: '1px solid var(--border-subtle)'
  },

  sectionHeader: {
    paddingTop: '12px',
    paddingRight: '12px',
    paddingBottom: '8px',
    paddingLeft: '12px',
    backgroundColor: '#141922'
  },

  sectionTitle: {
    fontSize: '12px',
    fontWeight: '700',
    color: 'var(--text-color)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px'
  },

  sectionMeta: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    fontWeight: '500'
  },

  activityList: {
    maxHeight: '220px',
    overflowY: 'auto',
    paddingTop: '8px',
    paddingRight: '8px',
    paddingBottom: '8px',
    paddingLeft: '8px',
    backgroundColor: '#11161e'
  },

  activityItem: {
    paddingTop: '9px',
    paddingRight: '10px',
    paddingBottom: '9px',
    paddingLeft: '10px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#151a23',
    marginBottom: '8px'
  },

  activityHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    marginBottom: '6px'
  },

  activityName: {
    fontSize: '12px',
    fontWeight: '650',
    color: 'var(--text-color)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },

  activityBadge: {
    flexShrink: 0,
    paddingTop: '2px',
    paddingRight: '7px',
    paddingBottom: '2px',
    paddingLeft: '7px',
    borderRadius: '999px',
    fontSize: '10px',
    color: 'var(--primary-color)',
    border: 'none',
    backgroundColor: 'var(--primary-soft)'
  },

  activityText: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    lineHeight: '1.45',
    maxHeight: '54px',
    overflow: 'hidden',
    wordBreak: 'break-word'
  },

  emptyActivity: {
    paddingTop: '18px',
    paddingRight: '14px',
    paddingBottom: '18px',
    paddingLeft: '14px',
    color: 'var(--text-muted)',
    fontSize: '12px',
    lineHeight: '1.5',
    textAlign: 'center'
  },

  catalogHeader: {
    paddingTop: '12px',
    paddingRight: '12px',
    paddingBottom: '10px',
    paddingLeft: '12px',
    backgroundColor: '#141922',
    borderBottom: '1px solid var(--border-subtle)'
  },

  searchRow: {
    display: 'flex',
    gap: '8px',
    marginTop: '10px'
  },

  searchInput: {
    flex: 1,
    height: '32px',
    paddingTop: '0',
    paddingRight: '10px',
    paddingBottom: '0',
    paddingLeft: '10px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#11161e',
    color: 'var(--text-color)',
    fontSize: '12px',
    outline: 'none'
  },

  categorySelect: {
    width: '106px',
    height: '32px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#11161e',
    color: 'var(--text-color)',
    fontSize: '12px'
  },

  toolList: {
    flex: 1,
    overflowY: 'auto',
    paddingTop: '8px',
    paddingRight: '8px',
    paddingBottom: '8px',
    paddingLeft: '8px'
  },

  toolItem: {
    paddingTop: '11px',
    paddingRight: '12px',
    paddingBottom: '11px',
    paddingLeft: '12px',
    borderRadius: '8px',
    backgroundColor: '#151a23',
    marginBottom: '8px',
    cursor: 'pointer',
    transition: 'border-color 0.15s, background-color 0.15s',
    border: 'none'
  },

  toolItemSelected: {
    border: 'none',
    backgroundColor: 'var(--primary-soft)'
  },

  toolHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '7px'
  },

  toolName: {
    minWidth: 0,
    fontSize: '13px',
    fontWeight: '650',
    color: 'var(--text-color)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },

  toolCategory: {
    flexShrink: 0,
    fontSize: '10px',
    paddingTop: '2px',
    paddingRight: '6px',
    paddingBottom: '2px',
    paddingLeft: '6px',
    borderRadius: '4px',
    backgroundColor: '#11161e',
    color: 'var(--text-muted)',
    border: 'none'
  },

  toolDescription: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    lineHeight: '1.45',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },

  toolMeta: {
    display: 'flex',
    gap: '10px',
    marginTop: '8px',
    fontSize: '11px',
    color: 'var(--text-dark)',
    flexWrap: 'wrap'
  },

  detail: {
    marginTop: '10px',
    paddingTop: '10px',
    paddingRight: '10px',
    paddingBottom: '10px',
    paddingLeft: '10px',
    borderRadius: '6px',
    backgroundColor: '#0f141c',
    border: 'none'
  },

  detailTitle: {
    fontSize: '11px',
    fontWeight: '700',
    color: 'var(--text-muted)',
    marginBottom: '8px'
  },

  parameterList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },

  parameterItem: {
    display: 'grid',
    gridTemplateColumns: 'minmax(72px, 1fr) auto',
    gap: '8px',
    alignItems: 'start',
    fontSize: '11px',
    color: 'var(--text-muted)'
  },

  parameterName: {
    color: 'var(--primary-color)',
    fontWeight: '650',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },

  parameterType: {
    color: 'var(--text-dark)'
  },

  parameterDesc: {
    gridColumn: '1 / -1',
    color: 'var(--text-muted)',
    lineHeight: '1.4',
    wordBreak: 'break-word'
  },

  emptyContainer: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100%',
    color: 'var(--text-muted)',
    textAlign: 'center',
    paddingTop: '32px',
    paddingRight: '28px',
    paddingBottom: '32px',
    paddingLeft: '28px'
  },

  emptyText: {
    fontSize: '14px',
    color: 'var(--text-color)',
    marginBottom: '8px'
  },

  emptyHint: {
    fontSize: '12px',
    color: 'var(--text-dark)',
    lineHeight: '1.5'
  }
};

function ToolPanel({ tools = [], loading, messages = [] }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedToolName, setSelectedToolName] = useState(null);

  const toolActivities = useMemo(() => {
    return messages
      .filter(message => message.toolName || message.type === 'tool')
      .slice(-8)
      .reverse()
      .map(message => ({
        id: message.id,
        toolName: message.toolName || 'unknown_tool',
        kind: message.type === 'tool' ? '调用' : '结果',
        summary: summarizeToolMessage(message)
      }));
  }, [messages]);

  const categories = useMemo(() => {
    const values = new Set(['all']);
    tools.forEach(tool => values.add(tool.category || 'general'));
    return Array.from(values);
  }, [tools]);

  const filteredTools = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return tools.filter(tool => {
      const category = tool.category || 'general';
      if (selectedCategory !== 'all' && category !== selectedCategory) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [
        tool.name,
        tool.description,
        category
      ].filter(Boolean).some(value => String(value).toLowerCase().includes(query));
    });
  }, [tools, searchQuery, selectedCategory]);

  const selectedTool = useMemo(() => {
    return tools.find(tool => tool.name === selectedToolName);
  }, [tools, selectedToolName]);

  const handleToolSelect = useCallback((tool) => {
    setSelectedToolName(prev => prev === tool.name ? null : tool.name);
  }, []);

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyContainer}>
          <div style={styles.emptyText}>加载工具列表...</div>
          <div style={styles.emptyHint}>Runtime 初始化后会同步可用工具</div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <div style={styles.sectionTitle}>
            <span>对话工具活动</span>
            <span style={styles.sectionMeta}>{toolActivities.length} 条</span>
          </div>
        </div>

        <div style={styles.activityList}>
          {toolActivities.length > 0 ? (
            toolActivities.map(activity => (
              <div key={activity.id} style={styles.activityItem}>
                <div style={styles.activityHeader}>
                  <span style={styles.activityName}>{activity.toolName}</span>
                  <span style={styles.activityBadge}>{activity.kind}</span>
                </div>
                <div style={styles.activityText}>{activity.summary}</div>
              </div>
            ))
          ) : (
            <div style={styles.emptyActivity}>
              工具会由 Agent 在对话执行中自动选择和调用；开始任务后，这里会显示本轮调用轨迹。
            </div>
          )}
        </div>
      </section>

      <div style={styles.catalogHeader}>
        <div style={styles.sectionTitle}>
          <span>可用工具目录</span>
          <span style={styles.sectionMeta}>{filteredTools.length}/{tools.length}</span>
        </div>
        <div style={styles.searchRow}>
          <input
            type="text"
            style={styles.searchInput}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索工具名称、说明或分类"
          />
          <select
            style={styles.categorySelect}
            value={selectedCategory}
            onChange={(event) => setSelectedCategory(event.target.value)}
          >
            {categories.map(category => (
              <option key={category} value={category}>
                {category === 'all' ? '全部' : category}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={styles.toolList}>
        {tools.length === 0 && (
          <div style={styles.emptyContainer}>
            <div style={styles.emptyText}>暂无可用工具</div>
            <div style={styles.emptyHint}>工具将在 Runtime 初始化完成后加载。</div>
          </div>
        )}

        {tools.length > 0 && filteredTools.length === 0 && (
          <div style={styles.emptyContainer}>
            <div style={styles.emptyText}>没有匹配的工具</div>
            <div style={styles.emptyHint}>调整搜索关键词或分类后再试。</div>
          </div>
        )}

        {filteredTools.map(tool => {
          const isSelected = selectedTool?.name === tool.name;
          const parameterCount = getParameterEntries(tool).length;

          return (
            <div
              key={tool.name}
              style={{
                ...styles.toolItem,
                ...(isSelected ? styles.toolItemSelected : {})
              }}
              onClick={() => handleToolSelect(tool)}
            >
              <div style={styles.toolHeader}>
                <span style={styles.toolName}>{tool.name}</span>
                <span style={styles.toolCategory}>{tool.category || 'general'}</span>
              </div>
              <div style={styles.toolDescription}>{tool.description || '无描述'}</div>
              <div style={styles.toolMeta}>
                <span>{tool.enabled === false ? '禁用' : '启用'}</span>
                <span>参数 {parameterCount}</span>
                <span>优先级 {tool.priority || 50}</span>
              </div>
              {isSelected && renderToolDetail(tool)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function renderToolDetail(tool) {
  const parameters = getParameterEntries(tool);

  return (
    <div style={styles.detail}>
      <div style={styles.detailTitle}>参数说明</div>
      {parameters.length === 0 ? (
        <div style={styles.emptyHint}>这个工具不需要显式参数。</div>
      ) : (
        <div style={styles.parameterList}>
          {parameters.map(([name, parameter]) => (
            <div key={name} style={styles.parameterItem}>
              <span style={styles.parameterName}>{name}</span>
              <span style={styles.parameterType}>{parameter.type || 'any'}</span>
              {parameter.description && (
                <span style={styles.parameterDesc}>{parameter.description}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getParameterEntries(tool) {
  if (!tool?.parameters || typeof tool.parameters !== 'object') {
    return [];
  }

  return Object.entries(tool.parameters);
}

function summarizeToolMessage(message) {
  if (message.args) {
    return truncate(JSON.stringify(message.args, null, 2));
  }

  if (message.result) {
    if (typeof message.result === 'string') {
      return truncate(message.result);
    }
    return truncate(JSON.stringify(message.result, null, 2));
  }

  return truncate(message.content || message.message || '等待工具返回结果');
}

function truncate(value, maxLength = 180) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}...`;
}

export default ToolPanel;
