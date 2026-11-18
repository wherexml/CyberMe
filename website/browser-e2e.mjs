// Run with: { printf 'const base = "%s"; const out = "%s";\n' "$URL" "$OUTPUT"; cat website/browser-e2e.mjs; } | ego-browser nodejs
const { mkdir, writeFile } = await import('node:fs/promises');
await mkdir(out, { recursive: true });
const task = await taskSpace("CyberMe 官网");
const page = task.page('p1');
const checks = [];
const screenshots = {};
const check = (name, ok) => {
  checks.push({ name, ok: !!ok });
  if (!ok) throw Error(name);
};
const capture = async (name) => {
  screenshots[name] = { url: await page.url(), file: await page.screenshot({ path: out + '/' + name + '.png' }) };
};
const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth === innerWidth);
const media = (features = []) => page.cdp('Emulation.setEmulatedMedia', { features });
const viewport = (width, height, mobile = false) => page.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
const canvasReady = () => page.waitForFunction(() => document.querySelector('.field').width > 300);

try {
  await viewport(1440, 900);
  await page.goto(base + '/');
  await canvasReady();
  check('Simplified Chinese and branded hero', (await page.title()).startsWith('CyberMe') && await page.evaluate(() => document.documentElement.lang === 'zh-Hans'));
  check('Desktop fits the viewport', await noOverflow());
  check('Desktop pan active', await page.evaluate(() => document.documentElement.classList.contains('has-pan')));
  await capture('desktop');

  await page.click('.primary[href="#demo"]', { label: 'Open the product preview' });
  check('Product button jumps to the preview', (await page.url()).endsWith('#demo'));
  await capture('product-preview');

  await page.click('.nav-links a[href="#features"]', { label: 'Open the feature showcase' });
  await page.evaluate(() => {
    const section = document.querySelector('.features');
    const pin = section.querySelector('.features-pin');
    scrollTo(0, scrollY + section.getBoundingClientRect().top + 2 / 3 * (section.offsetHeight - pin.offsetHeight));
  });
  await page.waitForFunction(() => document.querySelector('.progress i:nth-child(3)').classList.contains('active'));
  check('Desktop scroll presents the third scene', await page.evaluate(() => {
    const r = document.querySelector('.feature-panel:nth-child(3)').getBoundingClientRect();
    return Math.abs(r.left) < 3 && Math.abs(r.right - innerWidth) < 3;
  }));
  await capture('features');

  await page.click('.nav-links a[href="#faq"]', { label: 'Open the FAQ section' });
  await page.focus('.questions details:nth-child(2) summary');
  await page.keyboard.press('Enter');
  check('FAQ opens by keyboard', await page.evaluate(() => document.querySelector('.questions details:nth-child(2)').open));

  await page.click('.nav-end > .locales a[lang="en"]', { label: 'Switch to English' });
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  check('English keeps the active section', (await page.url()).endsWith('/en#faq'));
  await page.click('.nav-end > .locales a[lang="zh-Hant"]', { label: 'Switch to Traditional Chinese' });
  await page.waitForFunction(() => document.documentElement.lang === 'zh-Hant');
  check('Traditional Chinese keeps the active section', (await page.url()).endsWith('/zh-hant#faq'));

  await viewport(390, 844, true);
  await page.goto(base + '/');
  await canvasReady();
  check('Mobile stacks the four scenes', await page.evaluate(() => !document.documentElement.classList.contains('has-pan') && document.querySelectorAll('.feature-panel').length === 4));
  check('Mobile fits the viewport', await noOverflow());
  await capture('mobile');
  await page.click('.mobile-menu summary', { label: 'Open the mobile menu' });
  check('Mobile menu opens', await page.evaluate(() => document.querySelector('.mobile-menu').open));
  await page.keyboard.press('Escape');
  check('Escape closes mobile menu and restores focus', await page.evaluate(() => !document.querySelector('.mobile-menu').open && document.activeElement.matches('.mobile-menu summary')));
  await page.click('.mobile-menu summary', { label: 'Reopen the mobile menu' });
  await page.click('.mobile-panel a[href="#privacy"]', { label: 'Open privacy from menu' });
  check('Mobile section link closes the menu', (await page.url()).endsWith('#privacy') && await page.evaluate(() => !document.querySelector('.mobile-menu').open));

  await viewport(320, 740, true);
  await page.goto(base + '/en#demo');
  check('English fits a 320px screen', await noOverflow());

  await viewport(1440, 900);
  await media([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(base + '/#features');
  await canvasReady();
  check('Reduced motion leaves the scenes in normal flow', await page.evaluate(() => {
    const p = [...document.querySelectorAll('.feature-panel')].map((e) => e.getBoundingClientRect());
    return !document.documentElement.classList.contains('has-pan') && p.every((r,i) => i === 0 || r.top > p[i-1].bottom);
  }));

  await media();
  await page.cdp('Emulation.setScriptExecutionDisabled', { value: true });
  await page.goto(base + '/#access');
  await page.waitForLoadState();
  check('Private access message remains visible without JavaScript', (await page.snapshot()).includes('目前仅向私有测试用户分发。'));
  await page.cdp('Emulation.setScriptExecutionDisabled', { value: false });
  await page.cdp('Emulation.clearDeviceMetricsOverride');
  await page.goto(base + '/');
} finally {
  await writeFile(out + '/browser-results.json', JSON.stringify({ base, checks, screenshots }, null, 2) + '\n');
  console.log({ base, passed: checks.filter(x => x.ok).length, checks: checks.length, screenshots });
}
