// Browser-only public layout data. Mutations are rejected, never simulated as successful.
const item = { id: 'mygo-public-inbox-1', sender: '测试同事', title: '公开演示准备', channel: 'manual', status: 'pending', body: '请核对下次演示的准备情况。\n正文尾标 END', draft: '我会先核对环境，确认后回复', updatedAt: '2026-10-07T00:00:00.000Z', attentionOverride: true };
export async function previewRequest(method: string, path: string) {
    if (method !== 'GET')
        throw Error('这是只读布局预览，请在 MyGO App 中执行真实操作');
    const route = path.split('?')[0];
    if (route === '/api/conversations/primary')
        return { conversationId: 'preview-primary' };
    if (route === '/api/conversations')
        return [{ id: 'preview-primary', title: '公开预览' }];
    if (route.endsWith('/messages'))
        return [{ id: 'preview-welcome', role: 'assistant', content: '这是与桌面 App **同一组件和样式**的浏览器布局预览。\n\n- 只包含公开数据\n- 真实业务操作请使用独立 App' }];
    if (route.endsWith('/unresolved'))
        return { conversationId: 'preview-primary', items: [], hasMore: false };
    if (route === '/api/inbox')
        return [item];
    if (route === '/api/inbox/' + item.id)
        return item;
    if (route === '/api/settings/models')
        return { version: 'preview', standard: { providerId: 'public', model: 'public-model' }, deep: { providerId: 'public', model: 'public-model' }, providers: [{ id: 'public', name: '公开供应商', baseUrl: 'https://example.com', api: 'openai-responses', configured: false, enabled: true, models: ['public-model'], definitions: [{ id: 'public-model', smart: true, contextWindow: 200000, maxTokens: 7000, reasoning: false, vision: true }] }] };
    throw Error('布局预览不提供此业务记录');
}
