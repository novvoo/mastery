/**
 * Desktop 渲染层 — 轻量 React 组件集合
 *
 * 设计原则：
 *  - 不依赖构建器之外的 UI 库（Tailwind 的 class 名只是示例，可被 CSS Modules 替换）
 *  - 组件通过 `host` 与主进程通信（host.invoke/host.send），默认实现降级为 console
 *  - 所有公共组件通过 `export { ... }` 列出，方便按需 import
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { parseFileReferences, replaceFileReferences, formatReferenceLabel }
  from '../core/file-reference.js';
import { computeDiff } from '../core/diff-preview.js';

// ---------- 与主进程通信的抽象（桌面端可用 electron-api，Web 端可用 fetch） ----------
const defaultHost = {
  invoke: async (method, payload) => {
    // 默认实现：仅输出日志，方便单元测试与原型运行
    // 真实环境中会被 electron: `ipcRenderer.invoke(method, payload)` 替换
    console.debug('[host.invoke]', method, payload);
    return { success: true, data: null };
  },
  send: (channel, payload) => {
    console.debug('[host.send]', channel, payload);
  },
};

export function withHost(Component) {
  return (props) => <Component host={props.host || defaultHost} {...props} />;
}

// ========================== FileReferenceCard ==========================
/**
 * 渲染一个可点击的文件引用。onClick 在桌面端可以打开文件/跳转到对应行。
 */
export function FileReferenceCard({
  ref,
  onClick,
  compact = false,
  host = defaultHost,
}) {
  const label = formatReferenceLabel(ref);
  const [peek, setPeek] = useState(null);
  const handleClick = () => {
    if (onClick) return onClick(ref);
    return host.invoke('open-file', { path: ref.path, line: ref.startLine });
  };
  const handlePeek = async () => {
    try {
      const res = await host.invoke('peek-file', {
        path: ref.path,
        startLine: ref.startLine,
        endLine: ref.endLine,
      });
      if (res?.success && typeof res?.data === 'string') setPeek(res.data);
      else setPeek('(暂无内容)');
    } catch (e) {
      setPeek(`无法读取: ${e.message}`);
    }
  };
  const baseClass = compact
    ? 'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[12px] bg-slate-100 hover:bg-slate-200 text-slate-700'
    : 'inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-[13px]';
  return (
    <span className="file-ref-card inline-block">
      <button className={baseClass} onClick={handleClick} type="button">
        <span className="font-medium">{label}</span>
        {!compact && (
          <span
            className="ml-1 text-slate-400 hover:text-slate-700"
            onClick={(e) => { e.stopPropagation(); handlePeek(); }}
            title="预览片段"
          >
            👁
          </span>
        )}
      </button>
      {peek != null && (
        <pre className="ml-2 mt-1 p-2 rounded border text-[11px] max-w-xl whitespace-pre-wrap">
          {peek}
        </pre>
      )}
    </span>
  );
}

// ========================== RichMessageText（自动解析引用） ==========================
export function RichMessageText({ text, onReferenceClick, host = defaultHost }) {
  const refs = useMemo(() => parseFileReferences(text), [text]);
  if (!refs.length) return <span className="whitespace-pre-wrap">{text}</span>;
  const nodes = replaceFileReferences(text, (ref, i) => (
    <FileReferenceCard
      key={`ref-${i}`}
      ref={ref}
      onClick={onReferenceClick}
      compact
      host={host}
    />
  ));
  return <span className="whitespace-pre-wrap">{nodes}</span>;
}

// ========================== DiffPreview（内联 diff 预览，hunk 粒度可勾选） ==========================
export function DiffPreview({
  oldText = '',
  newText = '',
  path,
  initialSelected = null,          // 可选 Set，表示已选中的 hunk 索引（默认全选）
  onConfirm,                        // (selectedHunkIndices, newText) => void
  onCancel,
  host = defaultHost,
}) {
  const diff = useMemo(() => computeDiff(oldText, newText, { contextLines: 3 }),
    [oldText, newText]);
  const [selected, setSelected] = useState(() => {
    if (initialSelected) return new Set(initialSelected);
    return new Set(diff.hunks.map((_, idx) => idx));
  });
  const toggleHunk = (idx) => {
    const next = new Set(selected);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    setSelected(next);
  };
  const allSelected = diff.hunks.length > 0 && selected.size === diff.hunks.length;
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(diff.hunks.map((_, idx) => idx)));
  };
  const confirm = async () => {
    const indices = Array.from(selected).sort((a, b) => a - b);
    if (onConfirm) return onConfirm(indices, diff.newText);
    await host.invoke('apply-diff', { path, hunks: indices, newText: diff.newText });
  };
  if (!diff.hunks.length) {
    return (
      <div className="p-3 text-slate-500 text-sm">没有需要应用的变更（文件内容一致）。</div>
    );
  }
  return (
    <div className="diff-preview border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b">
        <div>
          <span className="font-medium text-sm">{path || 'Diff'}</span>
          <span className="ml-2 text-xs text-slate-500">{diff.hunks.length} hunk(s), ±{diff.added}/{diff.removed}</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-600 flex items-center gap-1">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />全选
          </label>
          <button
            className="text-xs px-2 py-1 rounded bg-slate-200 hover:bg-slate-300"
            onClick={onCancel}
          >取消</button>
          <button
            className="text-xs px-2 py-1 rounded bg-sky-600 text-white hover:bg-sky-700 disabled:bg-slate-300"
            disabled={selected.size === 0}
            onClick={confirm}
          >应用选中 ({selected.size})</button>
        </div>
      </div>
      <div className="overflow-auto max-h-[60vh] font-mono text-[12px]">
        {diff.hunks.map((h, idx) => (
          <div key={idx} className="hunk border-b last:border-b-0">
            <div className="sticky top-0 bg-white/90 flex items-center gap-2 px-3 py-1 border-b">
              <input
                type="checkbox"
                checked={selected.has(idx)}
                onChange={() => toggleHunk(idx)}
              />
              <span className="text-xs text-slate-500">
                @@ -{h.oldStart},{h.oldLines} +{h.newStart},{h.newLines} @@
              </span>
            </div>
            <pre className="p-0 m-0">
              {h.lines.map((ln, i) => {
                const bg = ln.type === 'added' ? 'bg-green-50'
                  : ln.type === 'removed' ? 'bg-red-50' : 'bg-transparent';
                const sign = ln.type === 'added' ? '+' : ln.type === 'removed' ? '-' : ' ';
                return (
                  <div key={i} className={`flex ${bg}`}>
                    <span className="w-8 text-right text-slate-400 select-none pr-2 shrink-0">{sign}</span>
                    <span className="whitespace-pre">{ln.content}\n</span>
                  </div>
                );
              })}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}

// ========================== CommandPalette（⌘K） ==========================
/**
 * 简单的命令面板。真实实现中：
 *   - onExecute 回调会转发到 core/command-catalog.js
 *   - getCommands 在默认情况下返回 catalog.filter(query)
 */
export function CommandPalette({
  open,
  onClose,
  getCommands,                       // (q: string) => Command[]
  onExecute,                         // (Command) => void
  placeholder = '搜索命令...',
}) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const commands = (getCommands ? getCommands(query) : []).slice(0, 50);

  useEffect(() => { if (open) { setQuery(''); setCursor(0); setTimeout(() => inputRef.current?.focus(), 10); } }, [open]);
  useEffect(() => { setCursor(0); }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(commands.length - 1, c + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
      else if (e.key === 'Enter') {
        if (commands[cursor]) { e.preventDefault(); onExecute && onExecute(commands[cursor]); }
      } else if (e.key === 'Escape') { e.preventDefault(); onClose && onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, commands, cursor, onExecute, onClose]);

  if (!open) return null;
  return (
    <div
      className="command-palette fixed inset-0 bg-black/30 z-50 flex items-start justify-center pt-[15vh]"
      onClick={() => onClose && onClose()}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-[90%] max-w-xl border overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="w-full px-4 py-3 text-sm outline-none border-b"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="max-h-80 overflow-auto text-sm">
          {commands.length === 0 && <li className="px-4 py-3 text-slate-400">没有匹配的命令</li>}
          {commands.map((cmd, idx) => (
            <li
              key={cmd.id}
              className={`px-4 py-2 cursor-pointer ${cursor === idx ? 'bg-sky-100' : 'hover:bg-slate-50'}`}
              onClick={() => onExecute && onExecute(cmd)}
              onMouseEnter={() => setCursor(idx)}
            >
              <div className="flex justify-between">
                <span className="font-medium">{cmd.title}</span>
                <span className="text-xs text-slate-500">{cmd.category}</span>
              </div>
              {cmd.description && <div className="text-xs text-slate-500">{cmd.description}</div>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ========================== CommandPaletteDemo（示例：连接到 catalog 的最简用法） ==========================
/**
 * 纯前端的 Demo 包装：演示如何把 CommandPalette 连到 command-catalog。
 * 实际产品中应直接在 Desktop 主进程提供 ipc 以调用 catalog.run(id, payload)。
 */
export function CommandPaletteDemo({ catalog }) {
  const [open, setOpen] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div>
      <CommandPalette
        open={open}
        onClose={() => setOpen(false)}
        getCommands={(q) => catalog.filter(q)}
        onExecute={async (cmd) => {
          setOpen(false);
          const result = await catalog.run(cmd.id);
          setLastResult(result);
        }}
      />
      <button className="px-3 py-1.5 text-sm border rounded" onClick={() => setOpen(true)}>
        命令面板 ⌘K
      </button>
      {lastResult && (
        <pre className="mt-3 text-[11px] text-slate-600 whitespace-pre-wrap">
          {JSON.stringify(lastResult, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default {
  FileReferenceCard,
  RichMessageText,
  DiffPreview,
  CommandPalette,
  CommandPaletteDemo,
};
