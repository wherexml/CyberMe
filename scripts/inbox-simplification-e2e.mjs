// Run with: ego-browser nodejs < scripts/inbox-simplification-e2e.mjs
// Reuses the task's shared space; does not send or modify messages.
const sharedSpace = process.env.EGO_TASK_SPACE;
const task = await taskSpace(sharedSpace ? Number(sharedSpace) : 'Inbox simplification regression');
const page = task.page('p1');
const url = 'http://127.0.0.1:46100/inbox?item=chat-oc_5f5f6e2e61676c3ba36ad01afd79739b';
await page.goto(url);
await page.waitForSelector('.op-draft-card');
await page.fill('input[aria-label="搜索收件箱"]', '郑方圆');
await page.waitForSelector('.op-message-row.selected');
const checks = await page.evaluate(() => {
 const card = document.querySelector('.op-draft-card');
 const row = document.querySelector('.op-message-row.selected');
 return {
  title: card.querySelector('header strong').textContent === '草稿',
  noReviewBadge: !card.querySelector('.op-draft-tone'),
  noLineage: !card.querySelector('.op-draft-lineage'),
  noTestBanner: !card.textContent.includes('仅可发送你自己创建'),
  personalExcerpt: !row.querySelector('.op-message-excerpt').textContent.startsWith('郑方圆:'),
  initialFormatted: !!card.querySelector('.op-markdown, .op-draft-body p'),
 };
});
await page.click('text="查看原文"');
checks.sourceToggle = await page.evaluate(() => !!document.querySelector('.op-draft-source'));
await page.click('text="查看排版"');
checks.formattedToggle = await page.evaluate(() => !document.querySelector('.op-draft-source') && !!document.querySelector('.op-draft-body p'));
await page.click('.op-draft-header-tools button:last-child');
checks.edit = await page.evaluate(() => !!document.querySelector('.op-edit-draft textarea'));
await page.evaluate(() => document.querySelector('.op-edit-actions button')?.scrollIntoView({block:'center'}));
await page.click('.op-edit-actions button:first-of-type');
await page.waitForSelector('.op-edit-draft', {state:'hidden'});
checks.cancel = await page.evaluate(() => !document.querySelector('.op-edit-draft'));
await page.goto(url);
await page.waitForSelector('.op-draft-card');
checks.refresh = await page.evaluate(() => document.querySelector('.op-draft-card header strong').textContent === '草稿' && !document.querySelector('.op-draft-lineage'));
const fs = await import('node:fs/promises');
const report = {checkedAt:new Date().toISOString(),checks,pass:Object.values(checks).every(Boolean),scope:'Live UI, read-only; no messages sent or drafts saved'};
await fs.writeFile('/Users/steve/Projects/opstwin-advance/output/inbox-simplification-20261003/browser.json', JSON.stringify(report,null,2));
console.log(report);
if (!sharedSpace) await task.finish({keep:[]});
if (!report.pass) throw new Error('Inbox simplification regression');
