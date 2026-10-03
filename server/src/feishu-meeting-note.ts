export interface MeetingNoteLink {
  documentId: string
  sourceUrl: string
}

export interface MeetingNoteParticipant {
  id: string
  name: string
  avatarUrl: string
  role: 'owner' | 'speaker'
}

export interface ParsedMeetingNote {
  title: string
  createdAt: string
  durationMs: number
  summary: string
  todos: Array<{ content: string; is_done: boolean }>
  participants: MeetingNoteParticipant[]
  minuteToken: string
  transcriptDocumentId: string
}

const allowedDocumentHosts = /(?:^|\.)(?:feishu\.cn|larksuite\.com)$/i

export function meetingNoteLinksFromMessage(message: Record<string, unknown>): MeetingNoteLink[] {
  const body = record(message.body)
  const candidates = collectStrings(body.content)
  const links = new Map<string, MeetingNoteLink>()
  for (const candidate of candidates) {
    for (const raw of candidate.match(/https:\/\/[^\s<>"']+\/docx\/[A-Za-z0-9]+[^\s<>"']*/g) ?? []) {
      const cleaned = raw.replace(/[),.;，。；]+$/u, '')
      try {
        const url = new URL(cleaned)
        if (url.protocol !== 'https:' || !allowedDocumentHosts.test(url.hostname)) continue
        const match = /^\/docx\/([A-Za-z0-9]+)/.exec(url.pathname)
        if (!match?.[1]) continue
        links.set(match[1], { documentId: match[1], sourceUrl: cleaned })
      } catch {
        // Ignore malformed message text; only canonical Feishu document links are accepted.
      }
    }
  }
  return [...links.values()]
}

export function parseMeetingNote(markdown: string, documentId: string): ParsedMeetingNote {
  const titleText = decodeEntities(markdown.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '')
  const topic = decodeEntities(markdown.match(/(?:会议|录音)主题[:：]\s*([^<\n]+)/)?.[1]?.trim() ?? '')
  const title = topic || titleText.replace(/^智能纪要[:：]\s*/u, '').trim() || '飞书智能纪要'
  const time = parseMeetingTime(markdown)
  const participants = parseParticipants(markdown)
  const summary = sanitizeSummary(extractSection(markdown, '总结', '待办'))
  const todoSection = extractSection(markdown, '待办', '相关链接')
  const todos = [...todoSection.matchAll(/^\s*-\s+\[([ xX])\]\s+(.+)$/gm)].map((match) => ({
    content: stripInlineMarkup(match[2] ?? ''),
    is_done: (match[1] ?? '').toLowerCase() === 'x',
  })).filter((item) => item.content)
  const related = extractSection(markdown, '相关链接')
  const minuteToken = related.match(/https:\/\/[^\s)]+\/minutes\/([A-Za-z0-9]+)/i)?.[1] ?? ''
  const transcriptDocumentId = [...related.matchAll(/https:\/\/[^\s)]+\/docx\/([A-Za-z0-9]+)/gi)]
    .map((match) => match[1] ?? '')
    .find((id) => id && id !== documentId) ?? ''

  return {
    title,
    createdAt: time.createdAt,
    durationMs: time.durationMs,
    summary,
    todos,
    participants,
    minuteToken,
    transcriptDocumentId,
  }
}

export function normalizeMeetingTranscript(markdown: string) {
  const lines = markdown.split(/\r?\n/)
  const normalized = lines.map((raw) => {
    let line = raw.trimEnd()
    line = line.replace(/<cite\b([^>]*)><\/cite>/gi, (_full, rawAttributes: string) => {
      return decodeEntities(readAttributes(rawAttributes)['user-name'] ?? '')
    })
    line = line.replace(/^说话人\s+\d+\s+用\s+(.+?)\s+的设备\s+(\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s*$/u, '$1 $2')
    line = line.replace(/^#\s+/, '').replace(/^>\s?/, '')
    return line
  })
  return normalized.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function parseParticipants(markdown: string): MeetingNoteParticipant[] {
  const participants = new Map<string, MeetingNoteParticipant>()
  for (const match of markdown.matchAll(/<cite\b([^>]*)><\/cite>/gi)) {
    const attributes = readAttributes(match[1] ?? '')
    const id = attributes['user-id'] ?? ''
    const name = decodeEntities(attributes['user-name'] ?? '')
    if (!id || !name || participants.has(id)) continue
    participants.set(id, { id, name, avatarUrl: '', role: 'speaker' })
  }
  return [...participants.values()]
}

function parseMeetingTime(markdown: string) {
  const match = /(?:会议|录音)时间[:：]\s*(\d{4})年(\d{1,2})月(\d{1,2})日[^\d]*(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})/u.exec(markdown)
  if (!match) return { createdAt: '', durationMs: 0 }
  const [, year, month, day, startHour, startMinute, endHour, endMinute] = match
  const start = Date.parse(`${year}-${pad(month)}-${pad(day)}T${startHour}:${startMinute}:00+08:00`)
  let end = Date.parse(`${year}-${pad(month)}-${pad(day)}T${endHour}:${endMinute}:00+08:00`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { createdAt: '', durationMs: 0 }
  if (end < start) end += 86_400_000
  return { createdAt: String(start), durationMs: end - start }
}

function extractSection(markdown: string, heading: string, nextHeading?: string) {
  const startMatch = new RegExp(`^#\\s+${escapeRegExp(heading)}\\s*$`, 'm').exec(markdown)
  if (!startMatch?.index && startMatch?.index !== 0) return ''
  const start = startMatch.index + startMatch[0].length
  if (!nextHeading) return markdown.slice(start).trim()
  const tail = markdown.slice(start)
  const endMatch = new RegExp(`^#\\s+${escapeRegExp(nextHeading)}\\s*$`, 'm').exec(tail)
  return (endMatch ? tail.slice(0, endMatch.index) : tail).trim()
}

function sanitizeSummary(value: string) {
  return value
    .replace(/<whiteboard\b[^>]*><\/whiteboard>/gi, '')
    .replace(/<\/?(?:grid|column)\b[^>]*>/gi, '')
    .replace(/<readonly-block\b[^>]*><\/readonly-block>/gi, '')
    .replace(/^\s*!\[[^\]]*\]\([^\n]+\)\s*$/gm, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function stripInlineMarkup(value: string) {
  return decodeEntities(value.replace(/\*\*/g, '').replace(/<[^>]+>/g, '')).trim()
}

function readAttributes(value: string) {
  const attributes: Record<string, string> = {}
  for (const match of value.matchAll(/([\w-]+)="([^"]*)"/g)) attributes[match[1] ?? ''] = match[2] ?? ''
  return attributes
}

function collectStrings(value: unknown, depth = 0): string[] {
  if (depth > 5) return []
  if (typeof value !== 'string') return []
  const values = [value]
  try {
    const parsed = JSON.parse(value) as unknown
    if (typeof parsed === 'string') values.push(parsed)
    else if (Array.isArray(parsed)) values.push(...parsed.flatMap((item) => collectObjectStrings(item, depth + 1)))
    else values.push(...collectObjectStrings(parsed, depth + 1))
  } catch {
    // Plain message text is already included above.
  }
  return values
}

function collectObjectStrings(value: unknown, depth: number): string[] {
  if (depth > 5) return []
  if (typeof value === 'string') return collectStrings(value, depth + 1)
  if (Array.isArray(value)) return value.flatMap((item) => collectObjectStrings(item, depth + 1))
  return Object.values(record(value)).flatMap((item) => collectObjectStrings(item, depth + 1))
}

function decodeEntities(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#xA;/gi, '\n')
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function pad(value: string | undefined) {
  return String(value ?? '').padStart(2, '0')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
