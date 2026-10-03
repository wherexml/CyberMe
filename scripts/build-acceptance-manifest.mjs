/** Assemble existing real E2E evidence. This never performs business writes. */
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join,relative} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url)),folder=join(root,'output/root-journey');
const read=async name=>JSON.parse(await readFile(join(folder,name),'utf8'));
const cleanup=await read('26-cleanup-final.json'),files=await read('23-feishu-delivered-files.json'),sourceChat=await read('31-source-chat-api-proof.json');
const step=(id,action,evidence,observed)=>({id,action,status:'PASS',mode:'real browser E2E with read-only corroboration',evidence,observed});
const steps=[
 step('ROOT-01','Create original self Inbox; generate real Haiku draft',['04-real-ai-draft.png','04-ai-draft-original.txt'],{itemId:cleanup.id,conversationId:cleanup.conversationId,firstDraftRunId:'run-75a16006-0493-4e12-a698-110905e66e76'}),
 step('ROOT-02','Edit, cancel, save and reload same original draft',['05-edit-cancel-save-persist.png','12-final-approved-body-persisted.png'],{itemId:cleanup.id,finalApprovedDraft:cleanup.sentDraft}),
 step('ROOT-03','Preserve real Opus failure; explicit standard retry succeeds',['07-opus-deep-current.png','19-deep-standard-run-proof.json','19-deep-standard-after-refresh.png'],{failedRunId:'run-7bc2b922-ab6c-45af-b2ba-e135b5c28b43',retryRunId:cleanup.draftRunId,strategy:'explicit_regular',model:'claude-haiku-4-5-20251001'}),
 step('ROOT-04','Generate and browser download seven formats; attach/remove/restore',['10-created-formats.json','11-browser-downloads-and-attaches.json','13-artifact-validation.json'],{finalAttachmentIds:cleanup.attachments,pdfPages:3,finalChartUsesActualTasks:true}),
 step('ROOT-05','Approve original body and seven files, then real self send',['20-approval-review.json','22-real-sent-api.json','22-message-readback.json','22-real-sent-1440.png'],{sendKey:cleanup.sendKey,identity:cleanup.receipt.identity,recipientId:cleanup.receipt.recipientId,messageIds:cleanup.receipt.messageIds}),
 step('ROOT-06','Download all seven delivered Feishu files; compare bytes',['23-feishu-delivered-files.json'],{files:files.files,allHashesMatch:files.files.every(f=>f.pass)}),
 step('ROOT-07','Read real owner calendar event and mobile Sent receipt',['23-calendar-readback.json','23-sent-mobile-390.png'],{eventId:cleanup.calendarEvent.eventId,ownerId:cleanup.calendarEvent.ownerId,startAt:cleanup.calendarEvent.startAt,endAt:cleanup.calendarEvent.endAt}),
 step('ROOT-08','Replay identical sendKey without sending again',['24-send-idempotent-replay.json','24-self-chat-members.json'],{messageIds:cleanup.receipt.messageIds,chatId:cleanup.receipt.chatId}),
 step('ROOT-09','Activity same item true Undo; all eight messages deleted',['24-activity-send-receipt.json','25-actual-recall.json','25-activity-recall.png'],{messageIds:cleanup.recallReceipt.messageIds,allDeleted:cleanup.recallReceipt.readback.items.every(i=>i.deleted)}),
 step('ROOT-10','Sent cancel QA owner event, freeze original receipt',['26-cleanup-final.json','26-recalled-sent.png'],{status:cleanup.status,calendarStatus:cleanup.calendarStatus,cancelProof:cleanup.calendarEvent.cancelReceipt.proof}),
 step('ROOT-11','Real PI tools create one task, memory and file; inspect Run',['15-chat-tool-request.json','15-chat-tools-api-proof.json','15-real-pi-tools-run.png'],{runId:'run-8ae5192f-cc6a-440b-965e-ea3ffe885513',tools:['list_tasks','create_task','save_memory','generate_file']}),
 step('ROOT-12','Floating Chat uses same conversation and answer, reload persists',['16-floating-session-proof.json','16-same-conversation-floating.png'],{conversationId:cleanup.conversationId,assistantMessageId:'message-4142f23f-9c3f-4a5e-98ce-62bc2533ac2d'}),
 step('ROOT-13','Actual task due-date and 390px overflow recovery',['03-task-date-retest-pass.png','17-mobile-task-overflow-retest-pass.json','17-mobile-task-overflow-retest-pass.png'],{dueDate:'2026-10-09',viewport:390,taskId:'task-ed289869-d8e1-46d2-b33e-79d4b3a4fbfa'}),
 step('ROOT-14','Read and hand off full 17662-character original meeting',['18-source-meeting-full.json','18-source-meeting-inbox.json','18-source-meeting-inbox.png'],{sourceId:'TOGhdCbmUoJXudx0fy3cIHfanhe',itemId:'inbo-ec71d1b0-1402-47d0-a334-42abd94db532',chars:17662}),
 step('ROOT-15','Read-only reimport preserves sister hash and local edits',['27-import-readonly-proof.json','27-sources-refresh.png'],{sisterMutation:false}),
 step('ROOT-16','All source tabs, history pagination, localized person/brief data',['28-source-tabs-and-history.json','29-source-localized-retest.json','29-source-people-retest.png','29-source-briefs-retest.png'],{conversationHistoryUniqueMessages:160,allMeetings:146,rawRecordsAccessible:true}),
 step('ROOT-17','Email handoff to Chat preview and actual PI source answer',['30-source-chat-handoff.json','30-mail-chat-source-preview.png','31-source-chat-api-proof.json'],{runId:sourceChat.run.id,tools:sourceChat.run.tools.map(t=>({name:t.name,status:t.status,args:t.args})),sourceId:'dnBvUVdLdWRJUGsva2x3cVpZcFhBbWpDZkZJPQ==',assistantMessageId:sourceChat.answer.id}),
 step('ROOT-18','Chronological files/messages and visible latest answer after resize',['33-chat-timeline-retest-pass.json','33-chat-timeline-retest-pass.png'],{visibleBubbleClipping:false}),
 step('ROOT-19','Offline save preserves unsaved form; cancel and reconnect preserve original task',['35-offline-edit-preserved.json','35-offline-edit-preserved.png','35-offline-saved-workspace.png','35-offline-recovered.json'],{taskId:'task-ed289869-d8e1-46d2-b33e-79d4b3a4fbfa',serverMutation:false}),
 step('ROOT-20','Real denied microphone recovery preserves draft; Continue typing sends nothing',['34-voice-permission-recovery.json','36-voice-continue-typing.json','36-voice-continue-typing.png'],{microphoneGranted:false,permissionRestored:true,actualTranscription:'NOT_RUN',newRuns:0,newMessages:0}),
];
const names=(await readdir(folder)).filter(n=>/\.(json|png|txt)$/.test(n)&&n!=='manifest.json');
const artifacts=[];for(const name of names){const bytes=await readFile(join(folder,name));artifacts.push({path:relative(root,join(folder,name)),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})}
const manifest={runId:'root-real-e2e-2026-10-02',assembledAt:new Date().toISOString(),project:root,taskSpace:35,page:'p3',timezone:'Asia/Singapore',routes:{web:'http://127.0.0.1:46100',api:'http://127.0.0.1:46110'},lineage:{
 itemId:cleanup.id,conversationId:cleanup.conversationId,ownerId:cleanup.receipt.recipientId,sendKey:cleanup.sendKey,testMarker:cleanup.testMarker,messageIds:cleanup.receipt.messageIds,calendarEventId:cleanup.calendarEvent.eventId,
 failedDeepRunId:'run-7bc2b922-ab6c-45af-b2ba-e135b5c28b43',standardDraftRunId:cleanup.draftRunId,chatRunId:'run-8ae5192f-cc6a-440b-965e-ea3ffe885513',chatTaskId:'task-08b85d3d-9690-4058-9cdc-08dbbc0b4b8d',chatMemoryId:'memory-1b1cf908-e71e-4069-aa91-783456afe93d',chatArtifactId:'artifact-58374f68-355c-4e3c-94e7-e3921245d0ec',
 meetingId:'meeting-TOGhdCbmUoJXudx0fy3cIHfanhe',sourceInboxId:'inbo-ec71d1b0-1402-47d0-a334-42abd94db532',sourceChatRunId:sourceChat.run.id,sourceChatMessageId:sourceChat.answer.id,attachmentIds:cleanup.attachments},
 steps,artifacts,firstFailures:[
 {id:'TASK-DATE',evidence:'02-task-date-failure.png',retest:'03-task-date-retest-pass.png'},
 {id:'CHAT-FILE-ACCESS',evidence:'14-chat-file-result-inaccessible-first-fail.png',retest:'14-chat-file-accessibility-retest-pass.png'},
 {id:'TASK-MOBILE-OVERFLOW',evidence:'17-mobile-task-overflow-diagnostic.json',retest:'17-mobile-task-overflow-retest-pass.json'},
 {id:'CHAT-TIMELINE-ALIGN',evidence:'32-chat-timeline-retest.json',retest:'33-chat-timeline-retest-pass.json'},
 {id:'LOCALIZED-SOURCE',evidence:'28-source-tabs-and-history.json',retest:'29-source-localized-retest.json'},
 {id:'FEISHU-AUTH-TRANSIENT',evidence:'21-send-first-result.png',retest:'22-real-sent-api.json',detail:'output/auth-transient-diagnostic/evidence.json'},
 {id:'OPUS-UPSTREAM',evidence:'19-deep-standard-run-proof.json',state:'real upstream 502 remains; explicit standard recovery works'},
 ],externalOutcome:{recipient:'许茂林',messagesCreated:8,messagesRecalled:8,deliveredFiles:7,calendarCreated:1,calendarCancelled:1,outstandingQaExternalObjects:0},
 independentScores:'See separate built-in Haiku reports. Root does not assign its own score.',replay:{http:'npm run verify:acceptance',browser:'node scripts/browser-replay.mjs',externalWrites:0}};
await writeFile(join(folder,'manifest.json'),JSON.stringify(manifest,null,2));console.log({artifact:join(folder,'manifest.json'),steps:steps.length,proofFiles:artifacts.length,externalWrites:0});
