import {ApiError} from './integrations';
import {collectCalendarEvidence,revalidateCalendarEvidence} from './calendar-evidence';
import type {SemanticCalendarProvider,CalendarSemanticEvidence} from './semantic-authorization';

function project(record:any):CalendarSemanticEvidence {
  return {evidenceId:record.id,calendarId:record.calendarId,eventId:record.event.eventId,
    ownerId:record.ownerId,title:record.event.title,startAt:record.event.startAt,
    endAt:record.event.endAt,timezone:record.event.timezone,observedAt:record.readAt,
    contentHash:record.factsHash};
}
export const semanticCalendarProvider:SemanticCalendarProvider={
  async read(snapshot){
    const query=snapshot.searchHint;
    if(!query)throw new ApiError(409,'calendar_query_required','请明确要核对的已有会议及时间范围');
    // A model's query is only a hint. The calendar reader verifies owner, all
    // search pages, unique event, live detail, status and exact normalized facts.
    return project(await collectCalendarEvidence(snapshot.itemId,query));
  },
  async revalidate(evidenceId,snapshot){
    // Do not search for a replacement if the original meeting changed.
    return project(await revalidateCalendarEvidence(evidenceId,snapshot.itemId));
  }
};
