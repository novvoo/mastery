/**
 * AgentEngine 事件发射与 UI 适配器
 *
 * 职责：
 *   - 设置外部 UI adapter（如 desktop-core 或 CLI）
 *   - 提供事件总线的便捷访问
 */

import { RuntimeEvent } from '../types.js';

export function setUIAdapter(ctx, adapter) {
  ctx.uiAdapter = adapter;
}

export function getEventBus(ctx) {
  return ctx.eventBus;
}

export function emit(ctx, eventName, payload) {
  ctx.eventBus.emit(eventName, payload);
}

export { RuntimeEvent };
