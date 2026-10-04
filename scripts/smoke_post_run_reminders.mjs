import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:3033';
const output = process.argv[3] || 'output/web-game/post-run-reminder/native';
const local = new URL(base).hostname === '127.0.0.1';
const signed = Boolean(process.env.AUTH_FIXTURE);
const isolated = signed && !local;
const devices = [['desktop',1280,800,false],['phone',390,844,true],['narrow-phone',320,568,true],['landscape',844,390,true]];
const report = { at: new Date().toISOString(), base, mode: isolated ? 'live-assets-local-api-fixture' : signed ? 'real-local-signed-api' : 'real-guest-api', scenarios: [], documents: [], errors: [], expectedErrors: [], privateFixtureWritesStayLocal: isolated };
mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
let activePage, activeName;
const state = page => page.evaluate(() => JSON.parse(window.render_game_to_text()).activeScene);
const click = (page, selector, touch) => touch ? page.locator(selector).tap() : page.locator(selector).click();
async function start(page, touch) {
  await page.waitForFunction(() => !document.getElementById('room-goal-intro-modal')?.classList.contains('hidden')
    || (JSON.parse(window.render_game_to_text()).activeScene?.currentCollisionReady
      && JSON.parse(window.render_game_to_text()).activeScene?.goalRun?.result === 'active'),null,{timeout:120000});
  if (await page.locator('#room-goal-intro-modal').isVisible()) await click(page, '#btn-room-goal-intro-start', touch);
  if (await page.locator('#auth-panel').evaluate(node => node.classList.contains('menu-open'))) await click(page, '#menu-toggle', touch);
  await page.waitForFunction(() => {
    const s = JSON.parse(window.render_game_to_text()).activeScene;
    return s.mode === 'play' && s.currentCollisionReady && s.goalRun?.elapsedMs > 0;
  });
}
async function geometry(page, width, height, touch) {
  const values = await page.evaluate(() => {
    const bounds = element => { const r = element.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height }; };
    const controls = ['#mobile-move-zone','.mobile-play-actions','#btn-world-room-chat'].flatMap(selector => {
      const element = document.querySelector(selector); return element && element.getBoundingClientRect().height && getComputedStyle(element).display !== 'none' ? [bounds(element)] : [];
    });
    return { targets: ['btn-post-run-reminder','btn-post-run-reminder-dismiss'].map(id => {
      const element = document.getElementById(id), r = bounds(element);
      return { id,...r, reachable: element.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)) };
    }), controls };
  });
  for (const r of values.targets) {
    assert.ok(r.width >= 44 && r.height >= 44 && r.x >= 0 && r.y >= 0 && r.x+r.width <= width && r.y+r.height <= height, JSON.stringify(r));
    assert.ok(r.reachable, `Covered reminder target: ${JSON.stringify(r)}`);
    if (touch) for (const c of values.controls) assert.ok(r.x+r.width <= c.x || c.x+c.width <= r.x || r.y+r.height <= c.y || c.y+c.height <= r.y, `Reminder overlaps touch controls: ${JSON.stringify({r,c})}`);
  }
  return values;
}
async function clear(page, context, touch) {
  let release;
  if (!touch) { await page.keyboard.down('ArrowRight'); release = () => page.keyboard.up('ArrowRight'); }
  else {
    const box = await page.locator('#mobile-move-stick').boundingBox(); assert.ok(box);
    const cdp = await context.newCDPSession(page), x=box.x+box.width/2,y=box.y+box.height/2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+34,y,id:1}]});
    release = async () => { await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await cdp.detach(); };
  }
  try { await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene?.goalRun?.result === 'completed',null,{timeout:20000}); }
  finally { await release(); }
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene?.goalRun?.guestProgress?.status === 'saved',null,{timeout:20000});
  await page.locator('#reward-sting-layer').waitFor({state:'hidden'});
}
try {
  for (const [name,width,height,touch] of devices) {
    if (process.env.CASE && name !== process.env.CASE) continue;
    activeName=name;
    let auth;
    if (signed) {
      if (process.env.FIXTURE_SEED) execFileSync(process.execPath,[process.env.FIXTURE_SEED],{stdio:'pipe'});
      auth=JSON.parse(readFileSync(process.env.AUTH_FIXTURE,'utf8'))['f130-player']; assert.ok(auth?.cookie);
    }
    const context=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch});
    await context.addInitScript(() => {
      localStorage.setItem('wamp_welcome_modal_seen_v1','1'); localStorage.setItem('wamp_replay_opt_out','1');
      localStorage.setItem('wamp.devicePerformanceMode.v1',JSON.stringify({version:1,mode:'full-quality'}));
    });
    if (signed && local) await context.addCookies([{name:'ep_session',value:auth.cookie,domain:'127.0.0.1',path:'/',httpOnly:true,sameSite:'Lax'}]);
    const page=await context.newPage(); activePage=page;
    let navigationPhase=null;
    const cancelledChatRequests=[];
    const reload=async () => {
      navigationPhase='reload';
      try { await page.reload({waitUntil:'domcontentloaded'}); }
      finally { navigationPhase=null; }
    };
    page.on('requestfailed',request => {
      if (navigationPhase && new URL(request.url()).pathname === '/api/chat/messages'
        && request.failure()?.errorText === 'net::ERR_ABORTED') {
        cancelledChatRequests.push({at:Date.now(),phase:navigationPhase,url:request.url()});
      }
    });
    page.on('pageerror',error => report.errors.push({name,message:error.message}));
    page.on('console',message => {
      if (message.type() !== 'error') return;
      const entry={name,message:message.text(),url:message.location().url,at:Date.now(),phase:navigationPhase};
      if ((local||isolated) && entry.url.includes('/api/presence/identity-token')) report.expectedErrors.push(entry);
      else report.errors.push(entry);
    });
    if (isolated) await page.route('**/api/**',async route => {
      // Every API request, including ratings, goes to the explicit local fixture. No production write is forwarded.
      const request=route.request(),url=new URL(request.url()),headers={Cookie:`ep_session=${auth.cookie}`,'Content-Type':'application/json'};
      if (url.pathname.startsWith('/api/presence/')) return route.fulfill({status:403,contentType:'application/json',body:'{"error":"Presence is disabled for this fixture."}'});
      for (const name of ['x-guest-user-id','x-guest-recovery-token']) if (request.headers()[name]) headers[name]=request.headers()[name];
      const response=await fetch('http://127.0.0.1:8788'+url.pathname+url.search,{method:request.method(),headers,...(request.postData()?{body:request.postData()}:{})});
      return route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});
    });
    await page.goto(`${base}/r/-11/-6?welcome=0`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => document.body.dataset.appReady === 'true',null,{timeout:120000});
    const entry=await page.locator('script[type="module"]').first().getAttribute('src'); report.documents.push({name,entry});
    if (process.env.EXPECTED_ENTRY) assert.equal(entry,process.env.EXPECTED_ENTRY);
    await start(page,touch);
    console.log(JSON.stringify({name,checkpoint:'started',signed}));
    if (signed) {
      await page.waitForFunction(() => document.getElementById('btn-post-run-reminder')?.textContent === 'Rate 3 rooms');
      await page.locator('#post-run-reminder').waitFor({state:'visible'});
      assert.equal(await page.locator('#run-rating-modal').isVisible(),false);
      const bounds=await geometry(page,width,height,touch); await page.screenshot({path:`${output}/${name}-rate-reminder.png`});
      await click(page,'#btn-post-run-reminder-dismiss',touch); assert.equal(await page.locator('#post-run-reminder').isVisible(),false);
      await click(page,'#menu-toggle',touch); await click(page,'#btn-auth-rate-clears',touch);
      await page.locator('#explore-modal').waitFor({state:'visible'});
      assert.ok(await page.locator('[data-explore-sort="unrated"]').evaluate(node => node.classList.contains('active')));
      await page.locator('[data-explore-queue-mode="rate"]').waitFor({state:'visible'});
      await click(page,'[data-explore-queue-mode="rate"]',touch);
      const rated=[];
      for (let i=0;i<3;i++) {
        await page.locator('#run-rating-modal').waitFor({state:'visible'});
        await page.waitForFunction(() => !document.getElementById('run-rating-status')?.textContent?.startsWith('Loading'));
        const title=await page.locator('#run-rating-title').innerText(),meta=await page.locator('#run-rating-meta').innerText();
        assert.equal(await page.locator('#run-rating-result').isVisible(),false); assert.equal(await page.locator('#run-rating-share').isVisible(),false);
        for (const selector of ['#run-rating-modal [data-quality-stars="4"]','#run-rating-modal [data-progression-difficulty="easy"]']) {
          if (!touch) { await page.locator(selector).focus(); await page.keyboard.press('Space'); }
          else await click(page,selector,touch);
        }
        await page.locator('#btn-run-rating-submit').waitFor({state:'visible'});
        const saved=page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/ratings'));
        if (!touch) { await page.locator('#btn-run-rating-submit').focus(); await page.keyboard.press('Enter'); }
        else await click(page,'#btn-run-rating-submit',touch);
        const response=await saved;
        assert.equal(response.status(),200,response.ok()?'':await response.text());
        rated.push({title,meta});
        if (i<2) await page.waitForFunction(previous => document.getElementById('run-rating-title')?.textContent !== previous,title,{timeout:30000});
      }
      await page.locator('#run-rating-modal').waitFor({state:'hidden'});
      await page.waitForFunction(() => document.getElementById('btn-auth-rate-clears')?.classList.contains('hidden'));
      assert.ok(rated.some(value => value.meta.includes('Expanded Room')),'Native expanded clear was not rated');
      let reloaded=false;
      const freshRequests=new Set();
      const onReloaded=() => { reloaded=true; };
      const onRequest=request => { if (reloaded && request.url().includes('/rooms/discover?')
        && new URL(request.url()).searchParams.get('sort') === 'unrated') freshRequests.add(request); };
      page.on('domcontentloaded',onReloaded); page.on('request',onRequest);
      const recoveredCount=page.waitForResponse(response => freshRequests.has(response.request()) && response.ok()).then(response => response.json());
      await reload(); await page.waitForFunction(() => document.body.dataset.appReady === 'true',null,{timeout:120000});
      assert.equal((await recoveredCount).totalCount,0);
      page.off('domcontentloaded',onReloaded); page.off('request',onRequest);
      assert.equal(await page.locator('#post-run-reminder').isVisible(),false);
      report.scenarios.push({name,kind:'signed-recovery',bounds,rated,passed:true});
    } else {
      await clear(page,context,touch);
      console.log(JSON.stringify({name,checkpoint:'verified-guest-clear'}));
      await page.waitForFunction(() => document.getElementById('btn-post-run-reminder')?.textContent === 'Save 1 clear');
      await page.locator('#post-run-reminder').waitFor({state:'visible'});
      const run=await state(page),bounds=await geometry(page,width,height,touch);
      assert.equal(run.mode,'play'); assert.equal(await page.locator('#run-rating-modal').isVisible(),false);
      await page.screenshot({path:`${output}/${name}-save-reminder.png`});
      await click(page,'#btn-post-run-reminder-dismiss',touch); assert.equal(await page.locator('#post-run-reminder').isVisible(),false);
      await click(page,'#menu-toggle',touch); await click(page,'#btn-auth-guest-progress',touch);
      await page.locator('#guest-progress-modal').waitFor({state:'visible'});
      assert.ok((await page.locator('#guest-progress-list').innerText()).includes('within 14 days'));
      assert.equal((await state(page)).mode,'play'); await page.screenshot({path:`${output}/${name}-history-in-play.png`});
      await click(page,'#btn-guest-progress-close',touch); assert.equal(await page.locator('#post-run-reminder').isVisible(),false);
      await reload(); await page.waitForFunction(() => document.body.dataset.appReady === 'true',null,{timeout:120000});
      await start(page,touch); await page.locator('#post-run-reminder').waitFor({state:'visible'});
      assert.equal(await page.locator('#btn-post-run-reminder').innerText(),'Save 1 clear');
      assert.equal(await page.locator('#run-rating-modal').isVisible(),false); await geometry(page,width,height,touch);
      await page.screenshot({path:`${output}/${name}-reloaded-reminder.png`});
      if (!touch) { await page.locator('#btn-post-run-reminder').focus(); await page.keyboard.press('Space'); }
      else await click(page,'#btn-post-run-reminder',touch);
      await page.locator('#auth-panel.menu-open').waitFor({state:'visible'});
      assert.equal(await page.locator('#run-rating-modal').isVisible(),false);
      report.scenarios.push({name,kind:'actual-guest-clear-reload',version:run.goalRun.roomVersion,status:run.goalRun.guestProgress.status,bounds,passed:true});
    }
    navigationPhase='close'; await context.close(); navigationPhase=null;
    // Reproduced on unchanged main: an in-flight chat poll logs a fetch failure when reload cancels it.
    // Require the actual ERR_ABORTED request in the same navigation; all other browser errors remain fatal.
    report.errors=report.errors.filter(entry => {
      const aborted=entry.name === name && entry.phase
        && /^Failed to poll chat messages TypeError: Failed to fetch(?:\n|$)/.test(entry.message)
        && cancelledChatRequests.find(request => request.phase === entry.phase && Math.abs(request.at-entry.at)<1000);
      if (aborted) report.expectedErrors.push({...entry,reason:'Baseline chat poll cancelled by navigation',failedRequest:aborted.url});
      return !aborted;
    });
    writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));
  }
  assert.equal(report.errors.length,0,JSON.stringify(report.errors));
} catch (error) {
  report.failure={name:activeName,message:error.message};
  if (activePage) await activePage.screenshot({path:`${output}/failure.png`}).catch(() => {});
  throw error;
} finally { writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2)); await browser.close(); }
console.log(JSON.stringify({scenarios:report.scenarios.length,errors:report.errors.length,output}));
