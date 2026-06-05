/**
 * Runtime Hook
 * 提供 Agent Runtime 的状态管理和操作方法
 */

import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * Runtime Hook
 * 管理 Agent 的状态、消息、工具等
 * @returns {Object} Runtime 状态和方法
 */
export function useRuntime() {
  // 状态
  const [status, setStatus] = useState('idle');
  const [messages, setMessages] = useState([]);
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({
    messageCount: 0,
    toolCalls: 0,
    startTime: null,
    endTime: null
  });
  
  // 引用
  const messageBufferRef = useRef([]);
  const statsRef = useRef(stats);
  const lastAnswerRef = useRef('');
  
  // 添加消息
  const addMessage = useCallback((message) => {
    const newMessage = {
      ...message,
      timestamp: message.timestamp || Date.now(),
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };
    
    // 更新消息缓冲
    messageBufferRef.current = [...messageBufferRef.current, newMessage];
    
    // 更新状态
    setMessages(prev => [...prev, newMessage]);
    
    // 更新统计
    setStats(prev => ({
      ...prev,
      messageCount: prev.messageCount + 1
    }));
    
    return newMessage;
  }, []);
  
  // 清空消息
  const clearMessages = useCallback(() => {
    messageBufferRef.current = [];
    setMessages([]);
    setStats(prev => ({
      ...prev,
      messageCount: 0
    }));
  }, []);
  
  // 加载工具列表
  const loadTools = useCallback(async () => {
    setLoading(true);
    
    try {
      // 通过 IPC 获取工具列表
      if (window.electronAPI) {
        const toolList = await window.electronAPI.getTools();
        setTools(toolList || []);
      } else {
        // 如果没有 electronAPI，使用模拟数据
        setTools(getMockTools());
      }
    } catch (error) {
      console.error('[useRuntime] 加载工具失败:', error);
      addMessage({
        type: 'error',
        content: `加载工具失败: ${error.message}`
      });
    } finally {
      setLoading(false);
    }
  }, [addMessage]);
  
  // 刷新状态
  const refreshState = useCallback(async () => {
    try {
      if (window.electronAPI) {
        const state = await window.electronAPI.getState();
        setStatus(state.status || 'idle');
        setStats(prev => ({
          ...prev,
          ...state.stats
        }));
      }
    } catch (error) {
      console.error('[useRuntime] 刷新状态失败:', error);
    }
  }, []);
  
  // 处理用户输入
  const processInput = useCallback(async (input, options = {}) => {
    if (!input) {
      addMessage({
        type: 'warning',
        content: '请输入任务描述'
      });
      return;
    }
    
    // 设置运行状态
    setStatus('running');
    setStats(prev => ({
      ...prev,
      startTime: Date.now(),
      endTime: null
    }));
    
    // 添加用户输入消息
    lastAnswerRef.current = '';
    addMessage({
      type: 'info',
      content: `用户输入: ${input}`
    });
    
    try {
      // 通过 IPC 发送输入
      if (window.electronAPI) {
        const result = await window.electronAPI.processInput(input, options);
        const answer = extractAgentAnswer(result);
        
        // 添加结果消息
        if (answer && answer !== lastAnswerRef.current) {
          lastAnswerRef.current = answer;
          addMessage({
            type: 'result',
            content: answer,
            ...result
          });
        } else if (!answer) {
          addMessage({
            type: 'success',
            content: '执行完成',
            ...result
          });
        }
        
        setStatus('completed');
        setStats(prev => ({
          ...prev,
          endTime: Date.now()
        }));
        
        return result;
      } else {
        // 模拟执行
        await simulateExecution(input, addMessage, setStatus, setStats);
      }
    } catch (error) {
      console.error('[useRuntime] 执行失败:', error);
      
      addMessage({
        type: 'error',
        content: `执行失败: ${error.message}`
      });
      
      setStatus('error');
      setStats(prev => ({
        ...prev,
        endTime: Date.now()
      }));
      
      throw error;
    }
  }, [addMessage]);
  
  // 停止执行
  const stop = useCallback(async () => {
    try {
      if (window.electronAPI) {
        await window.electronAPI.stop();
      }
      
      setStatus('idle');
      setStats(prev => ({
        ...prev,
        endTime: Date.now()
      }));
      
      addMessage({
        type: 'warning',
        content: '执行已停止'
      });
    } catch (error) {
      console.error('[useRuntime] 停止失败:', error);
      addMessage({
        type: 'error',
        content: `停止失败: ${error.message}`
      });
    }
  }, [addMessage]);
  
  // 订阅 IPC 事件
  useEffect(() => {
    if (!window.electronAPI) return;
    
    // 订阅 Agent 启动事件
    const unsubStart = window.electronAPI.onAgentStart((data) => {
      setStatus('running');
      addMessage({
        type: 'info',
        content: `Agent 启动: ${data.task || ''}`,
        ...data
      });
    });
    
    // 订阅 Agent 完成事件
    const unsubComplete = window.electronAPI.onAgentComplete((data) => {
      setStatus('completed');
      const answer = extractAgentAnswer(data);
      if (answer) {
        if (answer === lastAnswerRef.current) {
          return;
        }
        lastAnswerRef.current = answer;
        addMessage({
          type: 'result',
          content: answer,
          ...data
        });
        return;
      }

      addMessage({
        type: 'success',
        content: 'Agent 执行完成',
        ...data
      });
    });
    
    // 订阅 Agent 错误事件
    const unsubError = window.electronAPI.onAgentError((data) => {
      setStatus('error');
      addMessage({
        type: 'error',
        content: `Agent 错误: ${data.error || ''}`,
        ...data
      });
    });
    
    // 订阅工具调用事件
    const unsubToolCall = window.electronAPI.onToolCall((data) => {
      addMessage({
        type: 'tool',
        content: `调用工具: ${data.toolName}`,
        toolName: data.toolName,
        args: data.args,
        ...data
      });
      
      setStats(prev => ({
        ...prev,
        toolCalls: prev.toolCalls + 1
      }));
    });
    
    // 订阅工具结果事件
    const unsubToolResult = window.electronAPI.onToolResult((data) => {
      addMessage({
        type: 'result',
        content: `工具结果: ${data.toolName}`,
        toolName: data.toolName,
        result: data.result,
        ...data
      });
    });
    
    // 订阅状态更新事件
    const unsubStatus = window.electronAPI.onStatusUpdate((data) => {
      addMessage({
        type: data.level || 'info',
        content: data.message || '',
        ...data
      });
    });

    // 订阅通用 IPC 事件
    const unsubIpcEvent = window.electronAPI.on('ipc:event', (data) => {
      // IPCMessage shape: { id, type, payload, timestamp, status, correlationId, metadata }
      const eventName = data?.metadata?.eventName || data?.payload?.event || data?.payload?.name || 'ipc:event';
      const payload = data?.payload ?? data;

      console.debug('[useRuntime] 收到 ipc:event ->', { eventName, payload });

      const normalized = normalizeRuntimeEventMessage(eventName, payload);
      if (normalized.stats?.toolCall) {
        setStats(prev => ({
          ...prev,
          toolCalls: prev.toolCalls + 1
        }));
      }
      if (normalized.message) {
        addMessage(normalized.message);
      }
    });
    
    // 清理订阅
    return () => {
      unsubStart?.();
      unsubComplete?.();
      unsubError?.();
      unsubToolCall?.();
      unsubToolResult?.();
      unsubStatus?.();
      unsubIpcEvent?.();
    };
  }, [addMessage]);
  
  return {
    // 状态
    status,
    messages,
    tools,
    loading,
    stats,
    
    // 方法
    addMessage,
    clearMessages,
    loadTools,
    refreshState,
    processInput,
    stop
  };
}

export function normalizeRuntimeEventMessage(eventName, payload = {}) {
  const payloadSummary = typeof payload === 'object'
    ? JSON.stringify(payload).slice(0, 500)
    : String(payload);
  const base = {
    raw: payload,
    details: typeof payload === 'object' ? JSON.stringify(payload, null, 2) : String(payload),
    event: eventName,
    payload,
    payloadSummary,
    eventMessage: true
  };

  switch (eventName) {
    case 'agent:start':
      return {
        message: {
          ...base,
          type: 'agent',
          content: `Agent 启动${payload?.task ? `: ${payload.task}` : ''}`,
        },
      };
    case 'agent:complete': {
      const answer = extractAgentAnswer(payload);
      return {
        message: {
          ...base,
          type: answer ? 'result' : 'success',
          content: answer || 'Agent 执行完成',
        },
      };
    }
    case 'agent:error':
      return {
        message: {
          ...base,
          type: 'error',
          content: `Agent 错误: ${payload?.error || payload?.message || '未知错误'}`,
        },
      };
    case 'tool:call':
      return {
        stats: { toolCall: true },
        message: {
          ...base,
          type: 'tool',
          content: `调用工具: ${payload?.toolName || payload?.name || 'unknown'}`,
          toolName: payload?.toolName || payload?.name,
          args: payload?.args,
        },
      };
    case 'tool:result':
      return {
        message: {
          ...base,
          type: 'tool_result',
          content: `工具结果: ${payload?.toolName || payload?.name || 'unknown'}`,
          toolName: payload?.toolName || payload?.name,
          result: payload?.result,
        },
      };
    case 'tool:error':
      return {
        message: {
          ...base,
          type: 'error',
          content: `工具错误: ${payload?.toolName || payload?.name || 'unknown'} ${payload?.error || ''}`.trim(),
          toolName: payload?.toolName || payload?.name,
        },
      };
    case 'status:update':
      return {
        message: {
          ...base,
          type: payload?.level || 'info',
          content: payload?.message || '状态更新',
        },
      };
    case 'workspace:changed':
      return {
        message: null,
      };
    default:
      return {
        message: {
          ...base,
          type: 'event',
          content: `事件: ${eventName}`,
        },
      };
  }
}

function extractAgentAnswer(data) {
  if (!data) return '';

  if (typeof data === 'string') {
    return data;
  }

  if (typeof data.answer === 'string' && data.answer.trim()) {
    return data.answer;
  }

  if (data.localCommand && typeof data.content === 'string' && data.content.trim()) {
    return data.content;
  }

  if (typeof data.result === 'string' && data.result.trim()) {
    return data.result;
  }

  if (typeof data.result?.answer === 'string' && data.result.answer.trim()) {
    return data.result.answer;
  }

  if (typeof data.result?.response === 'string' && data.result.response.trim()) {
    return data.result.response;
  }

  if (typeof data.result?.text === 'string' && data.result.text.trim()) {
    return data.result.text;
  }

  return '';
}

/**
 * 获取模拟工具列表
 * @returns {Array} 模拟工具列表
 */
function getMockTools() {
  return [
    {
      name: 'read_file',
      description: '读取文件内容',
      category: 'filesystem',
      parameters: {
        path: { type: 'string', description: '文件路径' }
      },
      required: ['path']
    },
    {
      name: 'write_file',
      description: '写入文件内容',
      category: 'filesystem',
      parameters: {
        path: { type: 'string', description: '文件路径' },
        content: { type: 'string', description: '文件内容' }
      },
      required: ['path', 'content']
    },
    {
      name: 'execute_shell',
      description: '执行 Shell 命令',
      category: 'shell',
      parameters: {
        command: { type: 'string', description: 'Shell 命令' }
      },
      required: ['command']
    },
    {
      name: 'brainstorm',
      description: '头脑风暴工具',
      category: 'skills',
      parameters: {
        topic: { type: 'string', description: '主题' }
      },
      required: ['topic']
    },
    {
      name: 'git_status',
      description: '查看 Git 状态',
      category: 'git',
      parameters: {},
      required: []
    }
  ];
}

/**
 * 模拟执行过程
 * @param {string} input - 用户输入
 * @param {Function} addMessage - 添加消息函数
 * @param {Function} setStatus - 设置状态函数
 * @param {Function} setStats - 设置统计函数
 */
async function simulateExecution(input, addMessage, setStatus, setStats) {
  // 模拟思考过程
  addMessage({
    type: 'info',
    content: '正在分析任务...'
  });
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // 模拟工具调用
  addMessage({
    type: 'tool',
    content: '调用工具: read_file',
    toolName: 'read_file'
  });
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  addMessage({
    type: 'result',
    content: '工具结果: read_file',
    toolName: 'read_file',
    result: '文件内容已读取'
  });
  
  // 模拟完成
  addMessage({
    type: 'success',
    content: '任务执行完成'
  });
  
  setStatus('completed');
  setStats(prev => ({
    ...prev,
    endTime: Date.now(),
    toolCalls: prev.toolCalls + 1
  }));
}

export default useRuntime;
