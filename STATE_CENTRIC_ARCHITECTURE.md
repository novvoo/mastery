# State-Centric Editing Architecture

## 概述

本实现将 oh-my-pi 的 State-Centric Editing（状态驱动编辑）架构思想集成到现有 Agent 系统中，解决了传统 Context-Centric Editing（上下文驱动编辑）的若干问题。

## 核心组件

### 1. Content Addressing System (`src/core/harness/content-addressing.js`)

基于 Git 风格的内容寻址存储系统：

```typescript
- ContentAddressableStore
  - store(type, data) -> hash
  - get(hash) -> object
  - storeBlob(content) -> hash
  - storeAnchor(path, start, end, text) -> hash

- FileAnalyzer
  - analyzeFile(path, content) -> { fileHash, anchors }
  - analyzeByBlocks(path, content) -> { fileHash, blocks }
```

**特点**：
- 每个内容片段有唯一的哈希标识
- 支持按行或按代码块分析
- 类似 Git 的不可变对象存储

### 2. Hash-Anchored Patch System (`src/core/harness/hash-anchored-patch.js`)

基于内容哈希的补丁系统：

```typescript
- HashAnchoredPatcher
  - applyPatch(content, intent) -> result
  - applyPatches(content, intents[]) -> result
  - initializeFile(path, content) -> analysis

- PatchIntent (REPLACE | INSERT | DELETE | MODIFY)
  - type: PatchIntentType
  - anchorHash: string
  - content?: string

- StateGraph
  - createInitialNode(path, content) -> hash
  - createNodeFromPatch(parentHash, patch, content) -> hash
  - rollbackTo(hash) -> boolean
  - getHistory(limit) -> history
```

**特点**：
- 基于内容而非位置定位
- 支持回滚和历史追踪
- 模糊匹配增强鲁棒性

### 3. State-Centric Tools (`src/tools/harness/state-centric-tools.js`)

Agent 可用的编辑工具：

| 工具 | 描述 |
|------|------|
| `harness_analyze` | 分析文件，创建锚点 |
| `harness_replace` | 基于锚点替换内容 |
| `harness_insert` | 在锚点后插入内容 |
| `harness_delete` | 删除锚点内容 |
| `harness_query` | 查询状态/历史/锚点 |
| `harness_rollback` | 回滚到之前状态 |

## 架构对比

### Context-Centric (传统方式)

```
┌─────────────────────────────────────┐
│                                     │
│  Model reads full file content      │
│  into context window                │
│                                     │
│  Model determines line numbers      │
│  and generates complete new code    │
│                                     │
│  Apply text patch based on lines    │
│                                     │
└─────────────────────────────────────┘
         Costs: O(file size)
         Problems: 
           - Line numbers unstable
           - Context bloat
           - Memory dependent
           - Hard to rollback
```

### State-Centric (oh-my-pi 风格)

```
┌─────────────────────────────────────┐
│  ┌───────────────────────────────┐  │
│  │  Harness                      │  │
│  │  - Content Addressable Store  │  │
│  │  - Hash-Anchored Patches      │  │
│  │  - State Graph                │  │
│  └───────────┬───────────────────┘  │
│              ^                       │
│              │ State queries         │
│              │ Patch intents         │
│              │                       │
│  ┌───────────┴───────────────────┐  │
│  │  Model                        │  │
│  │  "What to change"             │  │
│  │  - Describe change intent     │  │
│  │  - Reference anchor hashes    │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
         Costs: O(change size)
         Benefits:
           - Stable content anchors
           - Minimal context
           - State continuity
           - Built-in versioning
```

## 工作流程示例

### 完整编辑流程

```
1. Initial Analysis
   └─ harness_analyze file.js
   └─ Returns: file hash + anchor list

2. Make Changes (Iteration 1)
   └─ harness_replace /workspace/src/file.js anchor_hash_1 new_content
   └─ Creates new state node in State Graph

3. Make Changes (Iteration N)
   └─ harness_insert /workspace/src/file.js anchor_hash_k new_content
   └─ References state from prior iterations (no context dependency)

4. Verify / Rollback
   └─ harness_query history
   └─ harness_rollback target_hash
```

### 对比：在多个迭代中的表现

**Context-Centric**:
```
Iteration 1: read file (100 lines) → edit → full file in context
Iteration 2: read file again (100 lines) → lost context from Iteration 1
Iteration 3: read file (100 lines) → memory exhausted as edits accumulate
```

**State-Centric**:
```
Iteration 1: analyze → anchors → small anchor ref in context
Iteration 2: use anchor from Iteration 1 → small patch
Iteration N: use any prior anchor → cost remains low
```

## 文件结构

```
src/
├── core/
│   └── harness/
│       ├── content-addressing.js     # Content Addressable Store
│       └── hash-anchored-patch.js    # Patcher + State Graph
├── tools/
│   └── harness/
│       └── state-centric-tools.js    # Agent tools
└── runtime/
    └── agent-engine.js               # (集成了新工具)
```

## 核心优势

1. **编辑成本优化**
   - O(change size) 而非 O(file size)
   - 减少不必要的 Token 消耗

2. **定位稳定性**
   - 基于内容哈希，不依赖行号
   - 代码移动、插入不影响锚点有效性

3. **状态连续性**
   - 迭代 N 可引用迭代 1 的锚点
   - 不依赖 LLM 的记忆能力

4. **上下文效率**
   - 无需将完整文件放入上下文
   - 只传递变化和锚点引用

5. **版本控制**
   - 内置状态图支持回滚
   - 完整的编辑历史记录

6. **职责分离**
   - 模型：描述变化 (What)
   - Harness：执行修改 (How/Where)

## 下一步改进方向

1. **持久化存储**
   - 将 ContentAddressableStore 持久化到磁盘
   - 跨会话保持状态

2. **锚点质量提升**
   - 更智能的代码块分析（AST 级别）
   - 多粒度锚点（函数/块/行）

3. **冲突解决**
   - 分支和合并策略
   - 三方合并支持

4. **工具扩展**
   - 批量修改工具
   - 搜索+替换组合操作
   - 重构专用工具

5. **优化**
   - 锚点前缀匹配优化
   - 智能缓存策略

## 示例

运行演示脚本：

```bash
bun demo-state-centric-editing.mjs
```

查看完整演示：
- 对比 Context-Centric vs State-Centric
- 展示完整工作流程
- 展示优势特性
