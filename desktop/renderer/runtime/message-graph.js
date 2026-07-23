import {
  buildLifecycleGraph,
  buildToolRuntimeCollections,
  createConversationGroups,
} from './runtime-details.js';

const AUTO_COLLAPSIBLE_TYPES = new Set([
  'agent',
  'assistant',
  'assistant_stream',
  'result',
  'success',
]);

export function isCompletedCollapsibleMessage(message = {}) {
  if (!AUTO_COLLAPSIBLE_TYPES.has(message.type)) {
    return false;
  }
  if (message.isStreaming || message.type === 'assistant_stream') {
    return message.streamComplete === true;
  }
  if (message.type === 'agent') {
    return message.event === 'agent:complete' || message.streamComplete === true;
  }
  return true;
}

export function isCompletedConversationGroup(group = {}) {
  if (group.status) {
    return ['completed', 'failed', 'stopped'].includes(group.status);
  }
  const primary = group.primaryMessage || group.primary;
  if (!primary) {
    return false;
  }
  if (primary.isStreaming || primary.type === 'assistant_stream') {
    return primary.streamComplete === true;
  }
  if (primary.type === 'agent') {
    return primary.event === 'agent:complete' || primary.streamComplete === true;
  }
  return ['user', 'result', 'success', 'error', 'warning', 'plan'].includes(primary.type);
}

export function resolveTurnVisibility({
  group = {},
  isCurrent = false,
  userPreference = 'unset',
} = {}) {
  if (group.status === 'running' || group.status === 'waiting') {
    return { state: 'expanded', reason: 'attention-required' };
  }
  if (userPreference === 'expanded') {
    return { state: 'expanded', reason: 'user-expanded' };
  }
  if (userPreference === 'collapsed') {
    return { state: 'collapsed', reason: 'user-collapsed' };
  }
  if (isCurrent) {
    return { state: 'expanded', reason: 'current-turn' };
  }
  if (isCompletedConversationGroup(group)) {
    return { state: 'collapsed', reason: 'historical-terminal' };
  }
  return { state: 'expanded', reason: 'non-terminal' };
}

export function createCompletedCollapseSignature(
  messages = [],
  getMessageId = (message, index) => message?.id || String(index),
) {
  return messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => isCompletedCollapsibleMessage(message))
    .map(({ message, index }) => getMessageId(message, index))
    .join('|');
}

export function computeNextCollapsedMessages({
  messages = [],
  previousCollapsed = new Set(),
  userExpandedMessageIds = new Set(),
  getMessageId = (message, index) => message?.id || String(index),
} = {}) {
  const completed = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => isCompletedCollapsibleMessage(message))
    .map(({ message, index }) => ({
      id: getMessageId(message, index),
      index,
    }));

  if (completed.length === 0) {
    return previousCollapsed;
  }

  const next = new Set(previousCollapsed);
  const latestCompletedId = completed.at(-1)?.id;
  let changed = false;

  for (const item of completed) {
    if (item.id === latestCompletedId) {
      changed = next.delete(item.id) || changed;
      continue;
    }
    if (!userExpandedMessageIds.has(item.id) && !next.has(item.id)) {
      next.add(item.id);
      changed = true;
    }
  }

  return changed ? next : previousCollapsed;
}

export function computeNextCollapsedGroups({
  groups = [],
  previousCollapsed = new Set(),
  userExpandedGroupIds = new Set(),
  userCollapsedGroupIds = new Set(),
} = {}) {
  const activeGroupId = groups.at(-1)?.id;
  const next = new Set(previousCollapsed);
  let changed = false;

  for (const group of groups) {
    const userPreference = userExpandedGroupIds.has(group.id)
      ? 'expanded'
      : userCollapsedGroupIds.has(group.id)
        ? 'collapsed'
        : 'unset';
    const visibility = resolveTurnVisibility({
      group,
      isCurrent: group.id === activeGroupId,
      userPreference,
    });
    const shouldCollapse = visibility.state === 'collapsed';

    if (shouldCollapse && !next.has(group.id)) {
      next.add(group.id);
      changed = true;
    } else if (!shouldCollapse && next.delete(group.id)) {
      changed = true;
    }
  }

  return changed ? next : previousCollapsed;
}

export function buildMessageDisplayGraph(messages = []) {
  return createConversationGroups(messages).map((group) => {
    const runtimeDetails = group.runtimeDetails || [];
    return {
      ...group,
      lifecycleGraph: buildLifecycleGraph(runtimeDetails),
      toolCollections: group.toolCollections || buildToolRuntimeCollections(runtimeDetails),
      isCompleted: isCompletedConversationGroup(group),
    };
  });
}
