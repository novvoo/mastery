/**
 * Tab — 统一标签页组件
 *
 * 用法:
 *   <Tab.Group activeTab={tab} onChange={setTab}>
 *     <Tab id="rag">RAG</Tab>
 *     <Tab id="preview">Preview</Tab>
 *   </Tab.Group>
 */
import React, { createContext, useContext } from 'react';

const TabContext = createContext({ activeTab: '', onChange: () => {} });

export function TabGroup({ activeTab, onChange, children, style }) {
  return (
    <TabContext.Provider value={{ activeTab, onChange }}>
      <div
        role="tablist"
        style={{
          display: 'flex',
          gap: '4px',
          minWidth: 0,
          ...style,
        }}
      >
        {children}
      </div>
    </TabContext.Provider>
  );
}

export function TabItem({ id, children, style }) {
  const { activeTab, onChange } = useContext(TabContext);
  const isActive = activeTab === id;

  return (
    <button
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      style={{
        height: '30px',
        borderRadius: 'var(--radius-md)',
        border: 'none',
        backgroundColor: isActive ? 'var(--primary-soft)' : 'transparent',
        color: isActive ? 'var(--primary-color)' : 'var(--text-muted)',
        cursor: 'pointer',
        fontSize: '12px',
        fontWeight: 700,
        padding: '0 12px',
        transition: 'all var(--transition-fast)',
        ...style,
      }}
      onClick={() => onChange(id)}
    >
      {children}
    </button>
  );
}
