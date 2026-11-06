// Typed message actions. A model may never name one of these: labels are fixed here and the
// server re-checks the version binding before anything runs. A draft is never a send.
import {textHash} from './inbox-surfacing';

export const ATTENTION_ACTIONS=['draft_reply','create_task','snooze','dismiss','discuss'] as const;
export type AttentionActionType=typeof ATTENTION_ACTIONS[number];
export const DELIVERY_STRATEGIES=['auto','immediate','digest','quiet'] as const;
export type DeliveryStrategy=typeof DELIVERY_STRATEGIES[number];
export interface AttentionBinding{entityKind:'inbox'|'idea';entityId:string;requestMessageId?:string;requestRevision?:string;provenanceKey?:string}

const LABELS:Record<AttentionActionType,[string,string]>={draft_reply:['Draft a reply for my review','起草回复，等我确认'],create_task:['Turn into a task','转成任务'],snooze:['Remind me tomorrow','明天再提醒'],dismiss:['Dismiss','忽略'],discuss:['Talk it through','展开聊聊']};
export const attentionActionLabel=(type:AttentionActionType,zh:boolean)=>LABELS[type][zh?1:0];
export const DELIVERY_LABELS:Record<DeliveryStrategy,[string,string]>={auto:['Follow settings','跟随设置'],immediate:['Individual','单独提醒'],digest:['Summary','汇总提醒'],quiet:['Off','不提醒']};

/** Which source versions back an idea. Compared for equality only; runs in both server and browser. */
export function ideaProvenance(idea:any){return textHash(JSON.stringify(Object.entries(idea?.sourceFingerprints||{}).sort(([a],[b])=>a.localeCompare(b))));}
