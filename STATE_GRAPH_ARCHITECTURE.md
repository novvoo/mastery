# State Graph Architecture - 状态图架构

## 核心洞见

**该架构的核心并非引入内容哈希，而是将 Agent 的系统状态从 Token Context 中提升为 Runtime 维护的显式 State Graph。**

### 三个关键要素

1. **内容寻址（Content Addressing）**：提供稳定的对象身份
2. **状态图（State Graph）**：提供长期的状态连续性
3. **上下文投影（Context Projection）**：上下文仅作为状态图在当前任务下的局部视图

---

## 架构视角的根本转变

### 传统架构（Context-Centric）
```
┌─────────────────────────────────────┐
│                                     │
│  ┌───────────────────────────────┐  │
│  │  Token Context Window         │  │
│  │  - 所有状态都存储在这里        │  │
│  │  - 有限、易丢失、难以恢复      │  │
│  └───────────────────────────────┘  │
│                                     │
│  Agent 在上下文中重建对状态的理解    │
│                                     │
└─────────────────────────────────────┘
      问题：状态脆弱、记忆依赖上下文
```

### 新架构（State-Centric）
```
┌─────────────────────────────────────────────────┐
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │  Runtime State Graph (持久、完整)          │  │
│  │  - Blobs（文件内容）                       │  │
│  │  - Trees（目录结构）                       │  │
│  │  - Symbols（符号索引）                     │  │
│  │  - Dependencies（依赖关系）               │  │
│  │  - Commits（变更历史）                    │  │
│  └──────────────────────┬────────────────────┘  │
│                         │                        │
│                         │ 稳定的对象身份        │
│                         │ (Content Addressing)   │
│                         │                        │
│  ┌──────────────────────▼────────────────────┐  │
│  │  Context Projection (短暂、局部)           │  │
│  │  - 按需从 State Graph 投影                 │  │
│  │  - 仅包含当前任务所需内容                  │  │
│  │  - 用完即弃，State Graph 才是真相来源      │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  Agent 通过投影操作 State Graph                │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## 核心概念详解

### 1. State Graph（状态图）

状态图是 Agent 对世界的持久化、完整的理解。

```typescript
// 状态图包含：
- Blobs：文件内容（通过内容哈希寻址）
- Trees：目录结构
- Symbols：函数、类、变量等符号
- Dependencies：文件/符号间的依赖关系
- Commits：变更历史（形成有向无环图）
```

**特点：**
- **持久化**：存在于磁盘/内存中，不依赖上下文窗口
- **完整**：包含所有已知状态，不只是当前任务的部分
- **可追溯**：支持回滚和历史查询
- **稳定寻址**：内容哈希确保对象身份稳定

### 2. Content Addressing（内容寻址）

内容寻址不是目的，而是手段——它提供了稳定的对象身份。

```typescript
hash = SHA256(content)
```

**为什么重要？**
- 内容不变，哈希不变 → 稳定引用
- 相同内容自动去重 → 高效存储
- 检测变更 → 看哈希是否改变

### 3. Context Projection（上下文投影）

**上下文不是真相来源，它只是状态图在当前任务下的局部视图。**

```
State Graph (完整、持久)
     |
     | 投影（按需选择节点）
     ↓
Context Projection (局部、短暂)
     |
     | 供 Agent 使用
     ↓
Agent 操作
     |
     | 产生变更
     ↓
更新 State Graph
```

**投影策略：**
- `symbol_and_context`：符号及其上下文
- `dependencies_only`：仅依赖关系
- `file_and_dependencies`：文件及其依赖
- `minimal_for_task`：任务所需最小视图

---

## 工具使用示例

### 完整工作流

```javascript
// 1. 索引项目到 State Graph
sg_index // 建立初始状态图

// 2. 获取投影（而不是直接读文件）
sg_project task=understand query="How does user auth work?"

// 3. 需要更多信息时，获取特定节点
sg_get id=UserService type=symbol

// 4. 编辑时，操作 State Graph
sg_edit \
  path=src/auth.js \
  operation=replace \
  anchor="function validateToken(" \
  content="function validateToken(token) { /* new impl */" \
  message="Refactor token validation"

// 5. 查看历史
sg_history limit=5

// 6. 回滚（如需要）
sg_rollback commit_id=abc123...

// 7. 随时查看状态
sg_status
```

### 关键工具

| 工具 | 作用 |
|------|------|
| `sg_index` | 索引项目到状态图 |
| `sg_project` | 获取上下文投影 |
| `sg_get` | 获取特定节点 |
| `sg_edit` | 编辑并创建提交 |
| `sg_commit` | 显式提交 |
| `sg_history` | 查看历史 |
| `sg_rollback` | 回滚 |
| `sg_status` | 查看状态 |

---

## 文件结构

```
src/core/harness/
├── state-graph-core.js           # State Graph 核心
│   ├── ContentAddressableStore   # 内容寻址存储
│   ├── StateGraph                # 状态图实现
│   └── ContextProjectionEngine   # 投影引擎
├── content-addressable-store.js  # 对象存储（扩展）
│   ├── FileTreeIndex             # 文件树索引
│   ├── SymbolIndexer             # 符号索引
│   ├── DependencyAnalyzer        # 依赖分析
│   └── CompleteIndex             # 完整索引
├── context-projection.js         # 投影系统
│   ├── ContextProjectionGenerator # 投影生成器
│   └── HistoryProjection         # 历史投影
└── state-graph-tools.js          # Agent 工具集
```

---

## 与传统编辑模式的对比

### Context-Centric Editing
```
1. 读完整文件 → 放入上下文
2. 模型根据上下文理解状态
3. 模型生成完整的新内容
4. 写回文件

问题：
- 大文件 → 上下文溢出
- 多文件 → 上下文冲突
- 依赖关系 → 难以理解
- 历史 → 依赖模型记忆
```

### State-Centric Editing
```
1. sg_index → 建立 State Graph
2. sg_project → 获取任务相关投影
3. sg_get → 按需获取更多信息
4. sg_edit → 修改并创建 commit
5. 投影自动过期，State Graph 持久

优势：
- 投影按需生成 → 上下文精简
- State Graph 完整 → 理解深入
- Commit 历史 → 容易回滚
- 稳定的对象身份 → 避免重复工作
```

---

## 优势总结

### 1. 避免幻觉（Avoid Hallucinations）
- State Graph 是唯一真相来源
- 投影总是反映当前真实状态
- 变更直接作用于 State Graph，再写回文件

### 2. 长期记忆（Long-Term Memory）
- 状态不依赖上下文窗口
- 历史完整可追溯
- 多轮对话之间持续存在

### 3. 上下文效率（Context Efficiency）
- 只投影任务所需内容
- 避免预加载整个项目
- 智能选择最相关的节点

### 4. 稳定性（Stability）
- 内容哈希提供稳定的对象身份
- 代码插入/移动不破坏引用
- 可靠的影响分析

### 5. 可追溯性（Traceability）
- 所有变更都有 commit
- 容易回滚和调试
- 完整的变更历史

---

## 下一步方向

1. **持久化 State Graph**：存入 SQLite 或文件系统
2. **语义搜索**：基于嵌入的符号查找
3. **分支与合并**：Git 风格的状态分支
4. **协作编辑**：多 Agent 共享状态图
5. **实时同步**：监听文件变化自动更新索引

---

## 核心原则重申

> **该架构的核心并非引入内容哈希，而是将 Agent 的系统状态从 Token Context 中提升为 Runtime 维护的显式 State Graph。**

内容寻址只是提供稳定对象身份的手段，状态图提供长期状态连续性，而上下文仅作为状态图在当前任务下的局部投影。
