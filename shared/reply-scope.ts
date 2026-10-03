import type { Artifact, Entity, InboxItem, Message } from './types';

/** Recover item ownership in older shared conversations without deleting history. */
export function replyMessages(item: InboxItem, conversationId: string, messages: Message[], conversations: Entity[]): Message[] {
  const thread = messages.filter(message => message.conversationId === conversationId && message.role !== 'system');
  if (conversations.some(conversation => conversation.id === conversationId && conversation.sourceItemId === item.id)) return thread;
  const runIds = new Set([item.draftRunId, item.runId, item.lastRunId, item.draftCandidate?.runId].filter(Boolean));
  let related = false;
  const scoped = thread.filter(message => {
    if (message.role === 'user') related = !!message.contextIds?.includes(item.id);
    return !!message.contextIds?.includes(item.id) || !!(message.runId && runIds.has(message.runId)) || related;
  });
  // A failed automatic draft followed by its retry has no intervening reply.
  // Collapse only these application prompts; retain all recorded history.
  const draftPrompts = new Set([`请为「${item.title}」生成草稿`, `请为「${item.title}」生成 DeepThink 草稿`]);
  return scoped.filter((message, index) => {
    const next = scoped[index + 1];
    return !(message.role === 'user' && message.requestId && draftPrompts.has(message.content)
      && next?.role === 'user' && next.requestId && next.content === message.content);
  });
}

export function replyArtifacts(item: InboxItem | undefined, conversationId: string, artifacts: Artifact[], conversations: Entity[], messages: Message[]): Artifact[] {
  if (!item) return [];
  const ids = new Set([...(item.attachments || []), ...(item.artifactIds || []), ...(item.draftCandidate?.artifactIds || []), ...messages.flatMap(message => message.attachments || [])]);
  const ownConversation = conversations.some(conversation => conversation.id === conversationId && conversation.sourceItemId === item.id);
  return artifacts.filter(file => ids.has(file.id) || file.sourceIds?.includes(item.id) || (!!conversationId && ownConversation && file.conversationId === conversationId));
}
