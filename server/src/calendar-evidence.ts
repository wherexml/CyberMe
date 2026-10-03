import { get, put, hash, now, uid } from './store';
import { ApiError, lark, requireSelf, connectionPermission } from './integrations';
import { primaryCalendar } from './calendar';

const TYPE = 'calendar_evidence'; // Deliberately absent from public CRUD TYPES.
const VERSION = 'calendar-read-v2';
type Query = { title: string; startAt: string; endAt: string };
function fail(code: string, message: string): never { throw new ApiError(409, code, message); }
function instant(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    fail('calendar_time_unclear', '日历取证需要带时区的明确时间');
  const ms = Date.parse(value);
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!Number.isFinite(ms) || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    fail('calendar_time_unclear', '日历日期无效');
  return ms;
}
function queryBounds(query: Query) {
  const start = instant(query.startAt), end = instant(query.endAt);
  if (!query.title.trim() || query.title.length > 200 || end <= start || end - start > 31 * 86400000)
    fail('calendar_query_unclear', '请提供明确的会议标题及不超过 31 天的时间范围');
  return { start, end };
}
function eventValue(data: any) { return data?.event || data?.data?.event || data; }
function normalize(data: any, expectedId: string) {
  const value = eventValue(data);
  if (!expectedId || value?.event_id !== expectedId) fail('calendar_readback_mismatch', '日历详情与搜索事件不一致');
  if (value.status !== 'confirmed') fail('calendar_event_unavailable', '日历事件无有效状态，需人工核对');
  if (value.recurrence) fail('calendar_instance_required', '重复日程需要明确到单次实例');
  if (value.start_time?.date || value.end_time?.date) fail('calendar_time_unclear', '全天日程不能作为具体会议时刻');
  const start = Number(value.start_time?.timestamp) * 1000, end = Number(value.end_time?.timestamp) * 1000;
  const timezone = value.start_time?.timezone;
  if (value.end_time?.timezone !== timezone) fail('calendar_time_unclear', '日历起止时区不一致，需人工核对');
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= start || typeof timezone !== 'string')
    fail('calendar_time_unclear', '日历详情缺少明确的起止时间和时区');
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(new Date(start)); }
  catch { fail('calendar_time_unclear', '日历时区无效'); }
  return { eventId: expectedId, title: String(value.summary || ''), status: value.status,
    startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(), timezone };
}
function permission() { connectionPermission('read'); }

/** Internal only. Query is a retrieval hint, never authorization to send. */
export async function collectCalendarEvidence(itemId: string, query: Query) {
  const { start, end } = queryBounds(query);
  permission();
  const auth = await requireSelf();
  const primary = await primaryCalendar(auth);
  permission();
  const ids = new Set<string>(), cursors = new Set<string>();
  let cursor = '', pages = 0;
  for (;;) {
    permission();
    const result = await lark(['calendar', '+search-event', '--as', 'user', '--calendar-id', primary.calendarId,
      '--query', query.title, '--start', query.startAt, '--end', query.endAt, '--page-size', '30',
      ...(cursor ? ['--page-token', cursor] : []), '--format', 'json']);
    permission();
    const data = result.data;
    const rows = Array.isArray(data) ? data : data?.items || data?.events;
    if (!Array.isArray(rows)) fail('calendar_search_incomplete', '无法确认日历搜索结果完整性');
    for (const row of rows) {
      if (row.status === 'cancelled') continue;
      if (typeof row.event_id !== 'string') fail('calendar_search_incomplete', '日历搜索缺少事件标识');
      ids.add(row.event_id);
    }
    pages++;
    const next = data?.page_token || data?.next_page_token || '';
    const more = typeof data?.has_more === 'boolean' ? data.has_more : Boolean(next);
    if (!more) break;
    if (!next || cursors.has(next) || pages >= 20) fail('calendar_search_incomplete', '日历搜索未完整结束，需人工核对');
    cursors.add(next); cursor = next;
  }
  if (ids.size !== 1) fail('calendar_event_ambiguous', '日历搜索没有唯一匹配事件');
  const eventId = [...ids][0];
  const response = await lark(['calendar', 'events', 'get', '--as', 'user', '--calendar-id', primary.calendarId, '--event-id', eventId, '--format', 'json']);
  permission();
  const event = normalize(response.data, eventId);
  if (Date.parse(event.startAt) < start || Date.parse(event.startAt) >= end || !event.title.includes(query.title.trim()))
    fail('calendar_event_changed', '详情与指定会议标题或时间范围不符');
  return put(TYPE, { id: uid('calendar-evidence'), itemId, validatorVersion: VERSION, ownerId: auth.openId,
    calendarId: primary.calendarId, event, factsHash: hash(event), rawResponseHash: hash(response.data), query, pages,
    readAt: now(), proof: 'cli_primary_owner_search_get' });
}

/** Resolve a server-owned record and reread upstream. Never accepts client facts. */
export async function revalidateCalendarEvidence(id: string, itemId: string) {
  const record = get(TYPE, id);
  if (!record || record.itemId !== itemId || record.validatorVersion !== VERSION)
    fail('calendar_evidence_missing', '缺少与当前来源对应的服务端日历取证');
  permission();
  const auth = await requireSelf(), primary = await primaryCalendar(auth);
  if (record.ownerId !== auth.openId || record.calendarId !== primary.calendarId)
    fail('calendar_owner_changed', '日历归属已变化');
  const result = await lark(['calendar', 'events', 'get', '--as', 'user', '--calendar-id', primary.calendarId,
    '--event-id', record.event.eventId, '--format', 'json']);
  permission();
  const event = normalize(result.data, record.event.eventId);
  if (hash(event) !== record.factsHash) fail('calendar_event_changed', '会议已变化，请重新生成并确认回复');
  return put(TYPE, { ...record, readAt: now(), rawResponseHash: hash(result.data) });
}
