// Probe: run JS steps in a Maps tab of its own. Usage: node maps-probe.mjs <url> <js-body> [screenshot]
import {chromium} from '/srv/thinkering/current/node_modules/playwright/index.mjs';
const [url, js, shot] = process.argv.slice(2);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = await browser.contexts()[0].newPage();
try {
  await page.goto(url, {waitUntil: 'domcontentloaded'});
  await page.waitForTimeout(6000);
  const fn = new Function('page', `return (async()=>{${js}})()`);
  console.log(JSON.stringify(await fn(page), null, 1));
} catch (e) { console.log('ERR', e.message.slice(0, 400)); }
finally { if (shot) await page.screenshot({path: shot}).catch(()=>{}); await page.close().catch(() => {}); await browser.close().catch(() => {}); }
