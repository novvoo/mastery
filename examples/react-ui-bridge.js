#!/usr/bin/env bun
/**
 * React UI Bridge 示例
 * 展示如何在 React 中使用 Runtime 和 IPC 通信
 * 
 * 包含：
 * - React Hooks 使用示例
 * - 组件集成示例
 * - 状态管理示例
 * - 事件处理示例
 */

import React, { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';

// 导入 UI Bridge
import { UIBridge, createUIBridge } from '../src/adapters/desktop/desktop-core.js';
import { RuntimeEvent } from '../src/runtime/index.js';

/**
 * React Context for UI Bridge
 * 用于在整个应用中共享 UI Bridge 实例
 */
const UIBridgeContext = createContext(null);

/**
 * UI Bridge Provider 组件
 * 在应用顶层提供 UI Bridge 上下文
 */
export function UIBridgeProvider({ children, config = {} }) {
  const [bridge, setBridge] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    // 创建并连接 UI Bridge
    const initBridge = async () => {
      try {
        const uiBridge = createUIBridge({
          debug: config.debug || false,
          maxQueueSize: config.maxQueueSize || 100
        });

        // 在 Electron 环境中连接 IPC
        if (window.electronAPI) {
          await uiBridge.connect(window.electronAPI);
          setIsConnected(true);
        } else {
          // 非 Electron 环境，使用模拟模式
          console.log('⚠️  未检测到 Electron 环境，使用模拟模式');
          setIsConnected(false);
        }

        setBridge(uiBridge);
      } catch (err) {
        setError(err.message);
        console.error('UI Bridge 初始化失败:', err);
      }
    };

    initBridge();

    // 清理
    return () => {
      if (bridge) {
        bridge.disconnect();
      }
    };
  }, []);

  // 提供上下文值
  const contextValue = {
    bridge,
    isConnected,
    error,
    // 便捷方法
    processInput: bridge?.processInput.bind(bridge),
    stop: bridge?.stop.bind(bridge),
    getState: bridge?.getState.bind(bridge),
    getTools: bridge?.getTools.bind(bridge),
    subscribe: bridge?.subscribe.bind(bridge),
    unsubscribe: bridge?.unsubscribe.bind(bridge),
    sendMessage: bridge?.sendToCore.bind(bridge),
    getMessageQueue: bridge?.getMessageQueue.bind(bridge)
  };

  return (
    <UIBridgeContext.Provider value={contextValue}>
      {children}
    </UIBridgeContext.Provider>
  );
}

/**
 * 使用 UI Bridge 的 Hook
 * 在组件中获取 UI Bridge 实例和状态
 */
export function useUIBridge() {
  const context = useContext(UIBridgeContext);
  
  if (!context) {
    throw new Error('useUIBridge 必须在 UIBridgeProvider 内使用');
  }
  
  return context;
}

/**
 * 使用 Agent 状态的 Hook
 * 自动订阅和更新 Agent 状态
 */
export function useAgentState() {
  const { bridge, isConnected } = useUIBridge();
  const [state, setState] = useState({
    status: 'idle',
    currentTask: null,
    iteration: 0,
    startTime: null,
    lastActivity: null
  });

  useEffect(() => {
    if (!bridge || !isConnected) return;

    // 订阅状态更新事件
    const unsubStatusUpdate = bridge.subscribe(RuntimeEvent.STATUS_UPDATE, (message) => {
      setState(prev => ({
        ...prev,
        ...message.data
      }));
    });

    // 订阅 Agent 启动事件
    const unsubAgentStart = bridge.subscribe(RuntimeEvent.AGENT_START, (message) => {
      setState({
        status: 'running',
        currentTask: message.data.task,
        startTime: message.data.timestamp,
        iteration: 0,
        lastActivity: message.data.timestamp
      });
    });

    // 订阅 Agent 完成事件
    const unsubAgentComplete = bridge.subscribe(RuntimeEvent.AGENT_COMPLETE, (message) => {
      setState(prev => ({
        ...prev,
        status: 'completed',
        lastActivity: Date.now()
      }));
    });

    // 订阅 Agent 错误事件
    const unsubAgentError = bridge.subscribe(RuntimeEvent.AGENT_ERROR, (message) => {
      setState(prev => ({
        ...prev,
        status: 'error',
        lastActivity: Date.now()
      }));
    });

    // 订阅 Agent 停止事件
    const unsubAgentStop = bridge.subscribe(RuntimeEvent.AGENT_STOP, (message) => {
      setState(prev => ({
        ...prev,
        status: 'idle',
        lastActivity: Date.now()
      }));
    });

    return () => {
      unsubStatusUpdate();
      unsubAgentStart();
      unsubAgentComplete();
      unsubAgentError();
      unsubAgentStop();
    };
  }, [bridge, isConnected]);

  return state;
}

/**
 * 使用工具调用的 Hook
 * 自动订阅工具调用事件
 */
export function useToolCalls() {
  const { bridge, isConnected } = useUIBridge();
  const [toolCalls, setToolCalls] = useState([]);
  const [currentTool, setCurrentTool] = useState(null);

  useEffect(() => {
    if (!bridge || !isConnected) return;

    // 订阅工具调用事件
    const unsubToolCall = bridge.subscribe(RuntimeEvent.TOOL_CALL, (message) => {
      const call = {
        toolName: message.data.toolName,
        args: message.data.args,
        startTime: Date.now(),
        status: 'running'
      };
      
      setCurrentTool(call);
      setToolCalls(prev => [...prev, call]);
    });

    // 订阅工具结果事件
    const unsubToolResult = bridge.subscribe(RuntimeEvent.TOOL_RESULT, (message) => {
      setCurrentTool(null);
      
      setToolCalls(prev => prev.map(call => {
        if (call.toolName === message.data.toolName && call.status === 'running') {
          return {
            ...call,
            result: message.data.result,
            endTime: Date.now(),
            status: 'completed'
          };
        }
        return call;
      }));
    });

    // 订阅工具错误事件
    const unsubToolError = bridge.subscribe(RuntimeEvent.TOOL_ERROR, (message) => {
      setCurrentTool(null);
      
      setToolCalls(prev => prev.map(call => {
        if (call.toolName === message.data.toolName && call.status === 'running') {
          return {
            ...call,
            error: message.data.error,
            endTime: Date.now(),
            status: 'error'
          };
        }
        return call;
      }));
    });

    return () => {
      unsubToolCall();
      unsubToolResult();
      unsubToolError();
    };
  }, [bridge, isConnected]);

  // 清空工具调用历史
  const clearToolCalls = useCallback(() => {
    setToolCalls([]);
    setCurrentTool(null);
  }, []);

  return { toolCalls, currentTool, clearToolCalls };
}

/**
 * 使用消息队列的 Hook
 * 获取和管理消息队列
 */
export function useMessageQueue() {
  const { bridge, isConnected } = useUIBridge();
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    if (!bridge || !isConnected) return;

    // 定期更新消息队列
    const interval = setInterval(() => {
      const queue = bridge.getMessageQueue();
      setMessages(queue);
    }, 100);

    return () => {
      clearInterval(interval);
    };
  }, [bridge, isConnected]);

  // 清空消息队列
  const clearMessages = useCallback(() => {
    if (bridge) {
      bridge.clearMessageQueue();
      setMessages([]);
    }
  }, [bridge]);

  // 获取特定类型的消息
  const getMessagesByType = useCallback((type) => {
    return messages.filter(msg => msg.type === type);
  }, [messages]);

  return { messages, clearMessages, getMessagesByType };
}

/**
 * Agent 控制面板组件示例
 */
export function AgentControlPanel() {
  const { processInput, stop, isConnected, error } = useUIBridge();
  const agentState = useAgentState();
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // 处理输入提交
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!input.trim() || !isConnected || isProcessing) return;
    
    setIsProcessing(true);
    
    try {
      await processInput(input.trim());
      setInput('');
    } catch (err) {
      console.error('处理输入失败:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // 停止执行
  const handleStop = async () => {
    try {
      await stop();
      setIsProcessing(false);
    } catch (err) {
      console.error('停止失败:', err);
    }
  };

  return (
    <div className="agent-control-panel">
      <h2>Agent 控制面板</h2>
      
      {/* 连接状态 */}
      <div className="connection-status">
        <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
          {isConnected ? '已连接' : '未连接'}
        </span>
        {error && <span className="error">{error}</span>}
      </div>
      
      {/* Agent 状态 */}
      <div className="agent-status">
        <h3>Agent 状态</h3>
        <div className="status-details">
          <p>状态: <strong>{agentState.status}</strong></p>
          {agentState.currentTask && (
            <p>当前任务: {agentState.currentTask}</p>
          )}
          {agentState.startTime && (
            <p>开始时间: {new Date(agentState.startTime).toLocaleString()}</p>
          )}
        </div>
      </div>
      
      {/* 输入表单 */}
      <form onSubmit={handleSubmit} className="input-form">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入您的请求..."
          disabled={!isConnected || isProcessing}
          rows={3}
        />
        <div className="button-group">
          <button 
            type="submit" 
            disabled={!isConnected || isProcessing || !input.trim()}
          >
            {isProcessing ? '处理中...' : '提交'}
          </button>
          {isProcessing && (
            <button 
              type="button" 
              onClick={handleStop}
              className="stop-button"
            >
              停止
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

/**
 * 工具调用监控组件示例
 */
export function ToolCallsMonitor() {
  const { toolCalls, currentTool, clearToolCalls } = useToolCalls();

  return (
    <div className="tool-calls-monitor">
      <h2>工具调用监控</h2>
      
      {/* 当前工具 */}
      {currentTool && (
        <div className="current-tool">
          <h3>当前执行</h3>
          <div className="tool-info">
            <p>工具: <strong>{currentTool.toolName}</strong></p>
            <p>状态: <span className="running">运行中</span></p>
            <pre>{JSON.stringify(currentTool.args, null, 2)}</pre>
          </div>
        </div>
      )}
      
      {/* 工具调用历史 */}
      <div className="tool-history">
        <h3>调用历史 ({toolCalls.length})</h3>
        <button onClick={clearToolCalls} className="clear-button">
          清空历史
        </button>
        
        <ul className="tool-list">
          {toolCalls.slice(-10).reverse().map((call, index) => (
            <li key={index} className={`tool-item ${call.status}`}>
              <div className="tool-header">
                <span className="tool-name">{call.toolName}</span>
                <span className={`tool-status ${call.status}`}>
                  {call.status}
                </span>
              </div>
              
              {call.status === 'completed' && call.result && (
                <div className="tool-result">
                  <pre>{JSON.stringify(call.result, null, 2).slice(0, 200)}...</pre>
                </div>
              )}
              
              {call.status === 'error' && call.error && (
                <div className="tool-error">
                  <span className="error">{call.error}</span>
                </div>
              )}
              
              <div className="tool-time">
                开始: {new Date(call.startTime).toLocaleTimeString()}
                {call.endTime && ` | 耗时: ${call.endTime - call.startTime}ms`}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * 消息日志组件示例
 */
export function MessageLog() {
  const { messages, clearMessages, getMessagesByType } = useMessageQueue();
  const [filter, setFilter] = useState('all');

  // 根据过滤器获取消息
  const filteredMessages = filter === 'all' 
    ? messages 
    : getMessagesByType(filter);

  return (
    <div className="message-log">
      <h2>消息日志</h2>
      
      {/* 过滤器 */}
      <div className="filter-controls">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">全部消息</option>
          <option value={RuntimeEvent.AGENT_START}>Agent 启动</option>
          <option value={RuntimeEvent.AGENT_COMPLETE}>Agent 完成</option>
          <option value={RuntimeEvent.TOOL_CALL}>工具调用</option>
          <option value={RuntimeEvent.TOOL_RESULT}>工具结果</option>
          <option value={RuntimeEvent.STATUS_UPDATE}>状态更新</option>
        </select>
        
        <button onClick={clearMessages} className="clear-button">
          清空日志
        </button>
      </div>
      
      {/* 消息列表 */}
      <div className="message-list">
        {filteredMessages.slice(-50).reverse().map((msg, index) => (
          <div key={index} className={`message-item ${msg.type}`}>
            <div className="message-header">
              <span className="message-type">{msg.type}</span>
              <span className="message-time">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="message-content">
              <pre>{JSON.stringify(msg.data, null, 2)}</pre>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 完整的 React 应用示例
 */
export function ReactAppExample() {
  return (
    <UIBridgeProvider config={{ debug: true }}>
      <div className="app-container">
        <header>
          <h1>AI Agent Desktop</h1>
        </header>
        
        <main>
          <div className="grid-layout">
            <AgentControlPanel />
            <ToolCallsMonitor />
            <MessageLog />
          </div>
        </main>
        
        <footer>
          <p>AI Agent Desktop - React UI Bridge 示例</p>
        </footer>
      </div>
    </UIBridgeProvider>
  );
}

/**
 * 自定义 Hook 示例：使用特定事件
 */
export function useEvent(eventName) {
  const { bridge, isConnected } = useUIBridge();
  const [eventData, setEventData] = useState(null);

  useEffect(() => {
    if (!bridge || !isConnected) return;

    const unsubscribe = bridge.subscribe(eventName, (message) => {
      setEventData(message.data);
    });

    return () => {
      unsubscribe();
    };
  }, [bridge, isConnected, eventName]);

  return eventData;
}

/**
 * 自定义 Hook 示例：使用工具列表
 */
export function useTools() {
  const { getTools, isConnected } = useUIBridge();
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isConnected) return;

    const fetchTools = async () => {
      setLoading(true);
      try {
        const toolList = await getTools();
        setTools(toolList);
      } catch (err) {
        console.error('获取工具列表失败:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchTools();
  }, [getTools, isConnected]);

  return { tools, loading };
}

/**
 * 工具列表组件示例
 */
export function ToolsList() {
  const { tools, loading } = useTools();

  if (loading) {
    return <div className="tools-loading">加载工具列表...</div>;
  }

  return (
    <div className="tools-list">
      <h2>可用工具 ({tools.length})</h2>
      
      <ul>
        {tools.map((tool, index) => (
          <li key={index} className="tool-item">
            <div className="tool-name">{tool.name}</div>
            <div className="tool-category">{tool.category}</div>
            {tool.description && (
              <div className="tool-description">{tool.description}</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 示例：在组件中使用 Runtime
 */
export function ExampleComponent() {
  const { isConnected, processInput } = useUIBridge();
  const agentState = useAgentState();
  const { toolCalls, currentTool } = useToolCalls();
  const statusUpdate = useEvent(RuntimeEvent.STATUS_UPDATE);

  return (
    <div>
      {/* 显示连接状态 */}
      <p>连接状态: {isConnected ? '已连接' : '未连接'}</p>
      
      {/* 显示 Agent 状态 */}
      <p>Agent 状态: {agentState.status}</p>
      
      {/* 显示当前工具 */}
      {currentTool && (
        <p>当前工具: {currentTool.toolName}</p>
      )}
      
      {/* 显示最近的工具调用 */}
      <p>工具调用次数: {toolCalls.length}</p>
      
      {/* 显示状态更新 */}
      {statusUpdate && (
        <p>最新状态: {statusUpdate.message}</p>
      )}
      
      {/* 提交按钮 */}
      <button 
        onClick={() => processInput('帮我分析当前项目结构')}
        disabled={!isConnected || agentState.status === 'running'}
      >
        分析项目
      </button>
    </div>
  );
}

/**
 * 主函数 - 运行示例
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║          React UI Bridge Example                               ║');
  console.log('║          React UI 通信示例                                      ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  console.log('📚 React UI Bridge 使用说明:');
  console.log('');
  console.log('1. 基本设置:');
  console.log('   - 在应用顶层使用 UIBridgeProvider');
  console.log('   - 在组件中使用 useUIBridge Hook');
  console.log('');
  console.log('2. 可用的 Hooks:');
  console.log('   - useUIBridge(): 获取 UI Bridge 实例');
  console.log('   - useAgentState(): 自动订阅 Agent 状态');
  console.log('   - useToolCalls(): 监控工具调用');
  console.log('   - useMessageQueue(): 管理消息队列');
  console.log('   - useEvent(eventName): 订阅特定事件');
  console.log('   - useTools(): 获取工具列表');
  console.log('');
  console.log('3. 组件示例:');
  console.log('   - AgentControlPanel: Agent 控制面板');
  console.log('   - ToolCallsMonitor: 工具调用监控');
  console.log('   - MessageLog: 消息日志');
  console.log('   - ToolsList: 工具列表');
  console.log('');
  console.log('4. Electron 集成:');
  console.log('   - 在 preload.js 中暴露 electronAPI');
  console.log('   - UIBridge 会自动检测并连接');
  console.log('');
  console.log('5. 非 Electron 环境:');
  console.log('   - UIBridge 会进入模拟模式');
  console.log('   - 可以手动调用 onMessage 模拟事件');
  console.log('');

  // 创建一个简单的 UI Bridge 测试
  console.log('🔧 创建 UI Bridge 测试实例...');
  
  const uiBridge = createUIBridge({ debug: true });
  
  // 模拟一些事件
  console.log('');
  console.log('📡 模拟事件:');
  
  uiBridge.onMessage({
    type: RuntimeEvent.STATUS_UPDATE,
    data: { message: '初始化完成', level: 'info' },
    timestamp: Date.now()
  });
  
  uiBridge.onMessage({
    type: RuntimeEvent.AGENT_START,
    data: { task: '测试任务', timestamp: Date.now() },
    timestamp: Date.now()
  });
  
  uiBridge.onMessage({
    type: RuntimeEvent.TOOL_CALL,
    data: { toolName: 'list_files', args: { path: './' } },
    timestamp: Date.now()
  });
  
  // 查看消息队列
  const messages = uiBridge.getMessageQueue();
  console.log(`   消息队列大小: ${messages.length}`);
  console.log(`   最后一条消息类型: ${uiBridge.getLastMessage()?.type}`);
  
  console.log('');
  console.log('✅ 示例完成！');
  console.log('');
  console.log('💡 提示:');
  console.log('   - 在 React 项目中导入这些组件和 Hooks');
  console.log('   - 配合 Electron 使用时，确保 preload.js 正确设置');
  console.log('   - 可以根据需要自定义组件样式和行为');
  console.log('');
}

// 如果直接运行此文件
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

// 导出所有组件和 Hooks
export default {
  UIBridgeProvider,
  useUIBridge,
  useAgentState,
  useToolCalls,
  useMessageQueue,
  useEvent,
  useTools,
  AgentControlPanel,
  ToolCallsMonitor,
  MessageLog,
  ToolsList,
  ReactAppExample
};