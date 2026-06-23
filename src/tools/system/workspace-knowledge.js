/**
 * Workspace Knowledge Tool - 让 Agent 查询已知的工作区状态
 *
 * 这是一个元工具，用于查询 WorkspaceState 中存储的信息
 */

export function createWorkspaceKnowledgeTools(workspaceState) {
  return [
    {
      name: 'workspace_knowledge',
      description:
        '查询工作区状态：已知存在的文件/目录、不存在的路径、关键事实。用于避免重复检查已知信息。',
      category: 'System',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['query', 'check_path', 'get_facts', 'get_summary', 'get_not_found'],
            description: '查询动作',
          },
          path: {
            type: 'string',
            description: '要检查的路径（用于 check_path）',
          },
          query: {
            type: 'string',
            description: '查询关键词（用于 query）',
          },
          limit: {
            type: 'number',
            description: '返回结果数量限制',
            default: 10,
          },
        },
        required: ['action'],
      },
      required: ['action'],
      handler: async (args, context) => {
        const { action, path, query, limit = 10 } = args;

        switch (action) {
          case 'check_path': {
            if (!path) {
              return { error: 'path 参数是必需的' };
            }
            const exists = workspaceState.checkPathExists(path);
            const reason =
              exists === 'not_found' ? workspaceState.getPathNotFoundReason(path) : null;

            return {
              path,
              exists,
              reason,
              suggestion:
                exists === 'not_found'
                  ? `跳过此文件的读取操作，因为它已被确认不存在`
                  : exists === 'exists'
                    ? `文件/目录存在，可以安全访问`
                    : `需要实际检查以确认是否存在`,
            };
          }

          case 'query': {
            if (!query) {
              return { error: 'query 参数是必需的' };
            }
            const facts = workspaceState.queryFacts(query, limit);

            return {
              query,
              count: facts.length,
              results: facts.map((f) => ({
                type: f.type,
                value: typeof f.value === 'object' ? JSON.stringify(f.value) : f.value,
                priority: f.priority,
                source: f.source,
              })),
            };
          }

          case 'get_facts': {
            const criticalFacts = workspaceState.getCriticalFacts();
            return {
              type: 'critical_facts',
              count: criticalFacts.length,
              facts: criticalFacts.map((f) => ({
                type: f.type,
                value: typeof f.value === 'object' ? JSON.stringify(f.value) : f.value,
              })),
            };
          }

          case 'get_summary': {
            const summary = workspaceState.getSummary();
            const workspaceDescription =
              context?.observationSummarizer?.generateWorkspaceDescription?.() || '无法生成描述';

            return {
              summary,
              description: workspaceDescription,
            };
          }

          case 'get_not_found': {
            // 返回所有已知不存在的路径
            const facts = workspaceState.queryFacts('not_found', 50);
            const notFoundPaths = facts
              .filter((f) => f.type === 'path_not_found')
              .map((f) => ({
                path: f.value?.path,
                reason: f.value?.reason,
                timestamp: f.timestamp,
              }));

            return {
              count: notFoundPaths.length,
              paths: notFoundPaths,
              suggestion:
                notFoundPaths.length > 0
                  ? `避免读取以下路径: ${notFoundPaths.map((p) => p.path).join(', ')}`
                  : '暂无已知的不存在路径',
            };
          }

          default:
            return { error: `未知动作: ${action}` };
        }
      },
    },
    {
      name: 'workspace_check_operation',
      description: '预测操作结果：检查基于当前工作区状态，某操作是否可以跳过或应该执行。',
      category: 'System',
      parameters: {
        type: 'object',
        properties: {
          tool_name: {
            type: 'string',
            description: '工具名称',
          },
          args: {
            type: 'object',
            description: '工具参数',
          },
          dry_run: {
            type: 'boolean',
            description: '如果为 true，只返回预测而不执行',
            default: true,
          },
        },
        required: ['tool_name', 'args'],
      },
      required: ['tool_name', 'args'],
      handler: async (args, context) => {
        const { tool_name, args: toolArgs, dry_run = true } = args;

        const prediction = workspaceState.predictToolResult(tool_name, toolArgs);

        return {
          tool: tool_name,
          arguments: toolArgs,
          prediction,
          canSkip: prediction.canSkip,
          reason: prediction.reason,
          predictedResult: prediction.predicted,
          advice: prediction.canSkip
            ? '⚠️  建议跳过此操作，基于之前的观察它会失败'
            : '✅ 建议执行，操作可能会成功',
        };
      },
    },
  ];
}

export default createWorkspaceKnowledgeTools;
