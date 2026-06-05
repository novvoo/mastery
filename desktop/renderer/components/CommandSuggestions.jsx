/**
 * 命令提示组件
 * 在用户输入 / 时显示可用命令列表
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';

// 内置命令列表
const BUILTIN_COMMANDS = [
  { name: '/help', description: '显示帮助信息', source: 'builtin' },
  { name: '/clear', description: '清空对话', source: 'builtin' },
  { name: '/menu', description: '打开交互菜单', source: 'builtin' },
  { name: '/task', description: '管理任务', source: 'builtin' },
  { name: '/tasks', description: '列出所有任务', source: 'builtin' },
  { name: '/schedule', description: '管理定时任务', source: 'builtin' },
  { name: '/schedules', description: '列出所有定时任务', source: 'builtin' },
  { name: '/subagent', description: '管理子代理', source: 'builtin' },
  { name: '/subagents', description: '列出所有子代理', source: 'builtin' },
  { name: '/git', description: '显示 Git 状态', source: 'builtin' },
  { name: '/context', description: '显示项目上下文', source: 'builtin' },
  { name: '/memory', description: '显示项目记忆', source: 'builtin' },
  { name: '/doc', description: '管理文档 RAG', source: 'builtin' },
  { name: '/compress', description: '压缩文本', source: 'builtin' },
  { name: '/reason', description: '显示推理使用情况', source: 'builtin' },
  { name: '/auto', description: '显示自动化状态', source: 'builtin' },
  { name: '/stats', description: '显示统计信息', source: 'builtin' },
  { name: '/status', description: '显示状态', source: 'builtin' },
  { name: '/tools', description: '列出工具', source: 'builtin' },
  { name: '/list', description: '列出工具', source: 'builtin' },
  { name: '/debug', description: '切换调试日志', source: 'builtin' },
  { name: '/model', description: '切换模型', source: 'builtin' },
];

// 子命令
const SUBCOMMANDS = [
  { name: '/doc add', description: '索引本地文档或 URL', source: 'builtin_subcommand' },
  { name: '/doc init', description: '初始化文档 RAG 运行时', source: 'builtin_subcommand' },
  { name: '/doc search', description: '搜索已索引文档', source: 'builtin_subcommand' },
  { name: '/doc list', description: '列出已索引文档', source: 'builtin_subcommand' },
  { name: '/doc clear', description: '清空文档上下文', source: 'builtin_subcommand' },
  { name: '/doc help', description: '显示文档 RAG 帮助', source: 'builtin_subcommand' },
];

// 样式
const styles = {
  container: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    right: 0,
    marginBottom: '8px',
    backgroundColor: 'var(--surface-color)',
    border: '1px solid var(--border-color)',
    borderRadius: '10px',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
    maxHeight: '280px',
    overflow: 'hidden',
    zIndex: 100,
    display: 'flex',
    flexDirection: 'column'
  },
  
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 12px',
    borderBottom: '1px solid var(--border-subtle)',
    backgroundColor: '#141922'
  },
  
  title: {
    fontSize: '11px',
    fontWeight: '700',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  
  hint: {
    fontSize: '11px',
    color: 'var(--text-dark)'
  },
  
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: '6px 0'
  },
  
  item: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    cursor: 'pointer',
    transition: 'background-color 0.1s',
    gap: '12px'
  },
  
  itemActive: {
    backgroundColor: 'var(--primary-soft)'
  },
  
  commandName: {
    fontSize: '13px',
    fontWeight: '500',
    color: 'var(--primary-color)',
    fontFamily: 'monospace'
  },
  
  commandDesc: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  
  source: {
    fontSize: '10px',
    color: 'var(--text-dark)',
    padding: '2px 6px',
    borderRadius: '4px',
    backgroundColor: 'var(--background-color)',
    flexShrink: 0
  },
  
  footer: {
    padding: '8px 12px',
    borderTop: '1px solid var(--border-subtle)',
    backgroundColor: '#141922',
    display: 'flex',
    gap: '16px',
    fontSize: '11px',
    color: 'var(--text-dark)'
  },
  
  footerKey: {
    fontFamily: 'monospace',
    backgroundColor: 'var(--background-color)',
    padding: '2px 5px',
    borderRadius: '3px',
    marginRight: '4px'
  }
};

/**
 * 命令提示组件
 * @param {Object} props
 * @param {string} props.input - 当前输入
 * @param {Array} props.tools - 可用工具列表
 * @param {Function} props.onSelect - 选择命令回调
 * @param {Function} props.onClose - 关闭回调
 */
function CommandSuggestions({ input, tools = [], onSelect, onClose }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef(null);
  const itemRefs = useRef([]);
  
  // 过滤命令
  const filteredCommands = React.useMemo(() => {
    const trimmed = input.trimStart();
    if (!trimmed.startsWith('/')) {
      return [];
    }
    
    const hasSpace = /\s/.test(trimmed);
    
    // 构建完整命令列表
    const allCommands = [...BUILTIN_COMMANDS];
    
    // 添加工具作为命令
    if (tools && tools.length > 0) {
      for (const tool of tools) {
        const name = `/${tool.name.replace(/_/g, '-')}`;
        if (!allCommands.find(c => c.name === name)) {
          allCommands.push({
            name,
            description: tool.description || `运行 ${tool.name}`,
            source: 'skill'
          });
        }
      }
    }
    
    // 排序：先显示精确匹配，再显示子命令
    return allCommands
      .filter(cmd => {
        if (!cmd.name.startsWith(trimmed)) {
          return false;
        }
        // 如果输入有空格，只显示子命令
        return hasSpace ? cmd.source === 'builtin_subcommand' : !cmd.name.includes(' ');
      })
      .sort((a, b) => {
        // 内置命令优先
        if (a.source !== b.source) {
          if (a.source === 'builtin') return -1;
          if (b.source === 'builtin') return 1;
          if (a.source === 'skill') return -1;
          if (b.source === 'skill') return 1;
        }
        return a.name.localeCompare(b.name);
      })
      .slice(0, 10);
  }, [input, tools]);
  
  // 显示条件
  const visible = input.startsWith('/') && filteredCommands.length > 0;
  
  // 滚动到激活项
  useEffect(() => {
    if (visible && itemRefs.current[activeIndex]) {
      itemRefs.current[activeIndex].scrollIntoView({
        block: 'nearest',
        behavior: 'smooth'
      });
    }
  }, [activeIndex, visible]);
  
  // 键盘导航
  const handleKeyDown = useCallback((e) => {
    if (!visible) return;
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex(prev => Math.min(prev + 1, filteredCommands.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredCommands[activeIndex]) {
          onSelect(filteredCommands[activeIndex].name + ' ');
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
      case 'Tab':
        e.preventDefault();
        if (filteredCommands[activeIndex]) {
          onSelect(filteredCommands[activeIndex].name + ' ');
        }
        break;
    }
  }, [visible, filteredCommands, activeIndex, onSelect, onClose]);
  
  // 监听键盘事件
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
  
  // 重置激活索引
  useEffect(() => {
    setActiveIndex(0);
    itemRefs.current = [];
  }, [filteredCommands]);
  
  // 获取来源标签
  const getSourceLabel = (source) => {
    switch (source) {
      case 'builtin': return '内置';
      case 'skill': return '技能';
      case 'builtin_subcommand': return '子命令';
      default: return source;
    }
  };
  
  // 获取来源颜色
  const getSourceStyle = (source) => {
    switch (source) {
      case 'builtin': 
        return { backgroundColor: 'rgba(93, 211, 158, 0.12)', color: 'var(--success-color)' };
      case 'skill': 
        return { backgroundColor: 'var(--primary-soft)', color: 'var(--primary-color)' };
      case 'builtin_subcommand': 
        return { backgroundColor: 'rgba(125, 211, 252, 0.12)', color: 'var(--info-color)' };
      default:
        return {};
    }
  };
  
  if (!visible) return null;
  
  return (
    <div style={styles.container}>
      {/* 头部 */}
      <div style={styles.header}>
        <span style={styles.title}>命令</span>
        <span style={styles.hint}>{filteredCommands.length} 个可用</span>
      </div>
      
      {/* 命令列表 */}
      <div ref={listRef} style={styles.list}>
        {filteredCommands.map((cmd, index) => (
          <div
            key={cmd.name}
            ref={el => itemRefs.current[index] = el}
            style={{
              ...styles.item,
              ...(index === activeIndex ? styles.itemActive : {})
            }}
            onClick={() => onSelect(cmd.name + ' ')}
            onMouseEnter={() => setActiveIndex(index)}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={styles.commandName}>{cmd.name}</div>
              <div style={styles.commandDesc}>{cmd.description}</div>
            </div>
            <span style={{
              ...styles.source,
              ...getSourceStyle(cmd.source)
            }}>
              {getSourceLabel(cmd.source)}
            </span>
          </div>
        ))}
      </div>
      
      {/* 底部提示 */}
      <div style={styles.footer}>
        <span>
          <span style={styles.footerKey}>↑↓</span> 导航
        </span>
        <span>
          <span style={styles.footerKey}>Tab</span> 选择
        </span>
        <span>
          <span style={styles.footerKey}>Esc</span> 关闭
        </span>
      </div>
    </div>
  );
}

export default CommandSuggestions;
