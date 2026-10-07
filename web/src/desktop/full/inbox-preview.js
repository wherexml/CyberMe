/* Source timestamps are unrelated to AI/record modification timestamps. */
(() => {
  const parse = value => window.OpsTwinsMessageTime.parse(value);
  function messageVisible(message) {
    return message.type !== 'recalled' && !/^(this message was recalled|此消息已撤回|消息已撤回|该消息已撤回)[.!。]?$/i.test(message.text?.trim() || '') && !(message.type === 'system' && !message.text?.trim());
  }
  function latest(item, histories = {}) {
    const messages = [...(item.messages || []), ...(histories[item.id]?.messages || [])].filter(messageVisible);
    const dated = messages.map(message => ({message, date:parse(message.sentAt)})).filter(x => x.date);
    if (dated.length) return dated.reduce((a, b) => a.date > b.date ? a : b);
    if (messages.length) return {message:messages.at(-1), date:null};
    const value = item.receivedAt || item.sentAt || item.eventAt || (!item.sourceId ? item.createdAt : null);
    return {message:null, date:parse(value)};
  }
  const replies = new Map();
  const state = id => replies.get(id) || {status:'idle'};
  const errors = {
    snapshot_changed:'来源快照已更新，请刷新设计稿后重试',
    model_unconfigured:'模型尚未配置，请先配置服务端渠道',
    model_timeout:'生成超时，可重试；已生成的草稿会保留',
    preview_busy:'其他草稿正在生成，请稍后重试',
    outbound_locked:'消息已发送或结果待确认，不能重新起草',
  };
  async function request() {}
  window.OpsTwinsInboxPreview = Object.freeze({latest, messageVisible, state, request});
})();
