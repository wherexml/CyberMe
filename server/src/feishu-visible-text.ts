// Ported from opstwin sqlite-feishu-store; presentation text only, never HTML.
const optionalString = (v: unknown): string | undefined => typeof v === 'string' ? v : undefined;
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function extractMessageText(content: unknown, type: unknown, mentions: Record<string, unknown>[] = []) {
  if (typeof content !== 'string' || !content) return `[${optionalString(type) ?? 'message'}]`
  try {
    const parsed = JSON.parse(content) as unknown
    if (typeof parsed === 'object' && parsed !== null) {
      const value = parsed as Record<string, unknown>
      if (type === 'system') return formatSystemMessage(value)
      if (typeof value.text === 'string') return replaceMentionPlaceholders(normalizeVisibleMessageText(value.text), mentions)
      if (typeof value.file_name === 'string') return value.file_name
      if (Array.isArray(value.content)) {
        return normalizeVisibleMessageText(value.content
          .flatMap((line) => Array.isArray(line) ? line : [])
          .map(record)
          .map((part) => optionalString(part.text) ?? '')
          .filter(Boolean)
          .join(' '))
      }
    }
  } catch {
    return normalizeVisibleMessageText(content)
  }
  return `[${optionalString(type) ?? 'message'}]`
}

function replaceMentionPlaceholders(value: string, mentions: Record<string, unknown>[]) {
  let result = value.replace(/@_all\b/g, '@所有人')
  for (const mention of mentions) {
    const key = optionalString(mention.key)
    const name = optionalString(mention.name)
    if (key && name) result = result.split(key).join(`@${name}`)
  }
  return result.replace(/@_user_\d+\b/g, '@群成员')
}

function formatSystemMessage(value: Record<string, unknown>) {
  const template = optionalString(value.template) ?? ''
  const fromUsers = stringArray(value.from_user)
  const toChatters = stringArray(value.to_chatters)
  const actor = fromUsers.join('、')
  const targets = toChatters.join('、')
  if (!template.trim()) return ''
  if (/\{to_chatters\} joined \{group_name\}/i.test(template)) {
    return `${targets || '新成员'}加入群聊${/view all chat history/i.test(template) ? '；可查看全部历史消息' : ''}`
  }
  if (/invited .* to (?:this |the )?(?:group|chat)/i.test(template)) {
    const history = /view all chat history/i.test(template)
      ? '；新成员可查看全部历史消息'
      : /can view messages sent after they joined/i.test(template)
        ? '；新成员只能查看加入后的消息'
        : ''
    return `${actor || '群成员'}邀请${targets || '新成员'}加入群聊${history}`
  }
  if (/disallowed new bizs from seeing chat history/i.test(template)) {
    return `${actor ? `${actor}已` : '已'}关闭新成员查看历史消息`
  }
  if (/allowed new bizs to see chat history/i.test(template)) {
    return `${actor ? `${actor}已` : '已'}允许新成员查看历史消息`
  }
  if (/Meeting has started/i.test(template)) return '会议已开始；新消息将同步到群聊和会议聊天'
  if (/updated the group name/i.test(template)) return `${actor || '群成员'}修改了群名称`
  if (/added .* to group administrators/i.test(template)) return '群管理员已更新'
  if (/updated the group photo/i.test(template)) return `${actor || '群成员'}修改了群头像`
  if (/Welcome to \{group_type\}/i.test(template)) return '欢迎加入群聊'
  if (/started the group chat/i.test(template)) return `${actor || '群成员'}创建了群聊`
  if (/unclipped content from the top/i.test(template)) return '已取消置顶内容'
  if (/clipped content to top/i.test(template)) return '已置顶群聊内容'
  if (/removed .* from this chat/i.test(template)) return `${actor || '群管理员'}将${targets || '群成员'}移出群聊`
  if (/仅群主和群管理员可发言/.test(template)) return '已开启仅群主和群管理员可发言'
  if (/Only group owner and admin can pin/i.test(template)) return '已设置仅群主和群管理员可置顶内容'
  if (template === '{divider_text}') {
    const divider = record(value.divider_text)
    const i18nText = record(divider.i18n_text)
    return optionalString(i18nText.zh_CN ?? divider.text) ?? ''
  }
  if (/You are now connected/i.test(template)) return '已建立新联系人会话，可以开始聊天'
  return '群聊状态已更新'
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : []
}

function normalizeVisibleMessageText(value: string) {
  const withBreaks = value
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*p\s*>/gi, '\n')
    .replace(/<\s*p(?:\s[^>]*)?>/gi, '')
    .replace(/<[^>]+>/g, '')
  return decodeHtmlEntities(withBreaks)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
  }
  return value.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const hexadecimal = entity[1]?.toLowerCase() === 'x'
      const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10)
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match
    }
    return named[entity.toLowerCase()] ?? match
  })
}

