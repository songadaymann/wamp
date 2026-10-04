import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:3033';
const output = process.argv[3] || 'output/web-game/first-publish/native';
const isolated = process.env.PUBLISH_FIXTURE === '1';
assert.ok(new URL(base).hostname === '127.0.0.1' || isolated, 'Signed publication requires an explicit local API fixture');
const accounts = JSON.parse(readFileSync('output/web-game/first-publish/local-auth.json', 'utf8'));
const report = { at: new Date().toISOString(), base, mode: isolated ? 'live-assets-local-api-fixture' : 'local-assets-local-api', scenarios: [], errors: [], expectedErrors: [], baselineErrors: [], documents: [], mutations: [], profiles: [], entryLimitations: [], abortedRequests: [] };
const devices = [['landscape',844,390,true], ['desktop',1280,800,false], ['phone',390,844,true], ['narrow-phone',320,568,true]];
const baselineThumbnail404Paths = new Set(['aurora/1.png','aurora/3.png','cave/layer1_far.png','cave/layer3_near.png','dark_forest/1.png','dark_forest/7.png','desert/far.png','desert/near.png','forest/1.png','forest/8.png','grassland/1.png','grassland/4.png','jungle_vines/layer_0.png','jungle_vines/layer_5.png','meadow/1.png','meadow/5.png','mountains/1.png','mountains/4.png','spooky_moon/moon.png','spooky_moon/sky.png','spooky_mountain/mountain_near.png','spooky_mountain/sky.png'].map(path=>'/assets/cache-v2/assets/backgrounds/'+path));
mkdirSync(output, { recursive: true });
const browser = await chromium.launch(); let activePage;
const click = async (page, selector, touch) => {
  if (touch && selector.startsWith('[data-editor-shell-action=') && !await page.locator(selector).isVisible()) await page.locator('#btn-editor-phone-menu').tap();
  return touch ? page.locator(selector).tap() : page.locator(selector).click();
};
async function readyWorld(page, touch, stayPlaying = false) {
  await page.waitForFunction(() => document.body.dataset.appReady === 'true', null, { timeout:120000 });
  if (await page.locator('#room-goal-intro-modal').isVisible()) await click(page, '#btn-room-goal-intro-start', touch);
  if (await page.locator('#auth-panel').evaluate(el=>el.classList.contains('menu-open'))) await click(page, '#menu-toggle', touch);
  if (await page.evaluate(() => JSON.parse(window.render_game_to_text()).activeScene?.mode === 'play')) {
    // Collision can be ready before the deep-link window and follow camera have arrived.
    // Stopping during that transition leaves Browse at the previous camera position.
    await page.waitForFunction(() => {
      const s=JSON.parse(window.render_game_to_text()).activeScene,b=s?.chunkWindow?.roomBounds,v=s?.camera?.worldView,p=s?.player,c=s?.currentRoom;
      return s?.currentCollisionReady&&b&&v&&p&&c&&c.x>=b.minX&&c.x<=b.maxX&&c.y>=b.minY&&c.y<=b.maxY
        &&p.x>=v.x&&p.x<=v.x+v.width&&p.y>=v.y&&p.y<=v.y+v.height;
    }, null, { timeout:120000 });
    if(!stayPlaying)await click(page, touch ? '#btn-mobile-world-stop' : '#btn-world-play', touch);
  }
  if (await page.locator('#run-rating-modal').isVisible()) await click(page, '#btn-run-rating-close', touch);
}
async function geometry(page, width, height) {
  const value = await page.evaluate(() => {
    const panel = document.querySelector('.first-publish-panel').getBoundingClientRect();
    const content = document.querySelector('.first-publish-scroll');
    const preview = document.getElementById('first-publish-preview');
    const targets = [...document.querySelectorAll('#first-publish-modal button, #first-publish-modal input')].filter(el => el.getClientRects().length).map(el => ({ id:el.id, height:el.getBoundingClientRect().height, width:el.getBoundingClientRect().width, radius:getComputedStyle(el).borderRadius }));
    return { panel:{x:panel.x,y:panel.y,width:panel.width,height:panel.height}, content:{client:content.clientHeight,scroll:content.scrollHeight,width:content.clientWidth,scrollWidth:content.scrollWidth}, preview:{client:preview.clientHeight,scroll:preview.scrollHeight}, modalWidth:document.getElementById('first-publish-modal').scrollWidth, documentWidth:document.documentElement.scrollWidth, targets };
  });
  assert.ok(value.panel.x >= 0 && value.panel.y >= 0 && value.panel.x+value.panel.width <= width+1 && value.panel.y+value.panel.height <= height+1, JSON.stringify(value));
  assert.ok(value.modalWidth <= width+1 && value.content.scrollWidth <= value.content.width+1,JSON.stringify(value));
  assert.ok(value.preview.scroll <= value.preview.client+1, 'Every published cell must fit in the preview');
  for (const target of value.targets) { assert.ok(target.height >= 44 && target.width >= 44, JSON.stringify(target)); assert.equal(target.radius,'0px'); }
  return value;
}
try {
  for (const [name,width,height,touch] of devices) {
    if (process.env.CASE && name !== process.env.CASE) continue;
    const account = accounts[name];
    const context = await browser.newContext({ viewport:{width,height}, hasTouch:touch, isMobile:touch });
    await context.addInitScript(() => {
      localStorage.setItem('wamp_welcome_modal_seen_v1','1'); localStorage.setItem('wamp_replay_opt_out','1');
      localStorage.setItem('wamp.devicePerformanceMode.v1',JSON.stringify({version:1,mode:'full-quality'}));
      window.__publishProof = { receipts:[], copied:[], shares:[] };
      window.addEventListener('xp-receipts', event=>window.__publishProof.receipts.push(...event.detail.receipts));
      Object.defineProperty(navigator,'clipboard',{ configurable:true,value:{writeText:async text=>window.__publishProof.copied.push(text)} });
    });
    const page = await context.newPage(); activePage = page; let deliberatePublishFailure = false, navigating = false, abortedChatFetches = 0, abortedLeaderboards = 0;
    page.on('requestfailed',request=>{if(request.failure()?.errorText!=='net::ERR_ABORTED')return;const path=new URL(request.url()).pathname;
      report.abortedRequests.push({name,path,method:request.method(),reason:'net::ERR_ABORTED'});
      if(path==='/api/chat/messages')abortedChatFetches++;if(request.method()==='GET'&&path.startsWith('/api/leaderboards/'))abortedLeaderboards++;});
    page.on('pageerror', error => report.errors.push({name,message:error.message}));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const entry = { name,message:message.text(),url:message.location().url };
      const path = new URL(entry.url || base,base).pathname;
      if (baselineThumbnail404Paths.has(path) && /404/.test(entry.message)) report.baselineErrors.push(entry);
      else if (/Failed to poll chat messages TypeError: Failed to fetch/.test(entry.message)&&abortedChatFetches>0){abortedChatFetches--;report.expectedErrors.push(entry);}
      else if (/Failed to load leaderboards TypeError: Failed to fetch/.test(entry.message)&&abortedLeaderboards>0){abortedLeaderboards--;report.expectedErrors.push(entry);}
      else if (path.includes('/presence/identity-token') || path.includes('/construction-preview-token') || deliberatePublishFailure && (path.endsWith('/publish') || /Failed to publish room.*Publish fixture retry required/.test(entry.message)) || navigating && path==='/api/chat/messages' && /net::ERR_ABORTED/.test(entry.message)) report.expectedErrors.push(entry);
      else report.errors.push(entry);
    });
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
      const localUrl = 'http://127.0.0.1:8788'+url.pathname+url.search;
      if (deliberatePublishFailure && url.pathname.endsWith('/publish')) {
        await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Publish fixture retry required.'})}); return;
      }
      if (request.method() !== 'GET' && request.method() !== 'OPTIONS') report.mutations.push({name,path:url.pathname,method:request.method(),destination:'127.0.0.1:8788'});
      const headers = new Headers(request.headers()); headers.set('Cookie','ep_session='+account.cookie); headers.delete('host'); headers.delete('content-length');
      const startedAt=Date.now();
      const response = await fetch(localUrl,{method:request.method(),headers,body:request.postData()||undefined});
      const body=Buffer.from(await response.arrayBuffer());
      if(url.pathname===`/api/profiles/${account.userId}`){
        const data=JSON.parse(body.toString());
        report.profiles.push({name,at:new Date(startedAt).toISOString(),elapsedMs:Date.now()-startedAt,status:response.status,
          xp:Object.fromEntries(['player','builder','curator'].map(lane=>[lane,data.progression?.[lane]?.xp]))});
      }
      const responseHeaders = Object.fromEntries(response.headers); delete responseHeaders['content-encoding']; delete responseHeaders['content-length'];
      responseHeaders['access-control-allow-origin'] = new URL(base).origin; responseHeaders['access-control-allow-credentials'] = 'true';
      await route.fulfill({status:response.status,headers:responseHeaders,body});
    });
    page.on('response', async response => {
      if (response.request().resourceType()==='document' && response.ok()) {
        const html = await response.text().catch(()=>null); if (html) report.documents.push({name,url:response.url(),entry:html.match(/src="([^"]*\/main-[^"]+\.js)"/)?.[1]||null});
      }
    });
    await page.goto(`${base}/r/${account.x}/${account.y}?welcome=0&renderer=canvas`,{waitUntil:'domcontentloaded'});
    console.log(JSON.stringify({name,phase:'loaded'}));
    await readyWorld(page,touch);
    console.log(JSON.stringify({name,phase:'world-ready'}));
    await page.locator('#btn-world-edit:not(:disabled)').waitFor({state:'visible',timeout:120000});
    await click(page,'#btn-world-edit',touch);
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene?.scene==='editor');
    await click(page,'[data-editor-shell-action="publish"]',touch);
    await page.locator('#first-publish-name-form').waitFor({state:'visible'});
    assert.equal(await page.locator('#first-publish-heading').textContent(),'Name your room');
    assert.ok((await page.locator('#first-publish-name').inputValue()).length > 0);
    const nameGeometry = await geometry(page,width,height);
    await page.screenshot({path:`${output}/${name}-name.png`});
    await page.keyboard.press('Escape'); await page.locator('#first-publish-modal').waitFor({state:'hidden'});
    assert.equal(report.mutations.filter(m=>m.name===name&&m.path.endsWith('/publish')).length,0);
    await click(page,'[data-editor-shell-action="publish"]',touch);
    await page.locator('#first-publish-name-form').waitFor({state:'visible'});
    await page.locator('#first-publish-name').fill(`My ${name} Adventure`);
    deliberatePublishFailure = true;
    const failedPublish=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/publish')&&response.status()===409);
    await click(page,'#btn-first-publish-confirm',touch); await failedPublish;
    await page.locator('#busy-overlay').waitFor({state:'hidden'});
    assert.equal(await page.locator('#first-publish-modal').isVisible(),false); deliberatePublishFailure = false;
    // The chosen name is retained as a draft; retry uses it rather than prompting again.
    await click(page,'[data-editor-shell-action="publish"]',touch);
    await page.locator('#first-publish-live').waitFor({state:'visible',timeout:60000});
    await page.waitForFunction(() => document.querySelector('#first-publish-preview img')?.naturalWidth>0,null,{timeout:60000});
    assert.equal(await page.locator('#first-publish-title').textContent(),`My ${name} Adventure`);
    const expectedUrl = new URL(`/r/${account.x}/${account.y}`,base).toString();
    assert.equal(await page.locator('#first-publish-link').inputValue(),expectedUrl);
    const liveGeometry = await geometry(page,width,height);
    await page.waitForFunction(() => window.__publishProof.receipts.some(r=>r.reason.startsWith('Published ')),null,{timeout:30000});
    const receipts = await page.evaluate(()=>window.__publishProof.receipts);
    assert.ok(receipts.some(r=>r.lane==='builder'&&r.amount===25&&r.reason===`Published My ${name} Adventure`));
    console.log(JSON.stringify({name,phase:'ordinary-published',builderXp:25}));
    await click(page,'#btn-first-publish-copy',touch);
    assert.equal(await page.evaluate(()=>window.__publishProof.copied.at(-1)),expectedUrl);
    await page.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:async data=>window.__publishProof.shares.push(data)}));
    await click(page,'#btn-first-publish-share',touch);
    assert.equal(await page.evaluate(()=>window.__publishProof.shares.at(-1).url),expectedUrl);
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('denied');}}}));
    await click(page,'#btn-first-publish-copy',touch);
    assert.equal(await page.locator('#first-publish-status').textContent(),'Copy the selected link.');
    await page.locator('#xp-receipt-layer').waitFor({state:'hidden',timeout:20000});
    await page.locator('#reward-sting-layer').waitFor({state:'hidden',timeout:20000});
    await page.screenshot({path:`${output}/${name}-live.png`});
    const xPopup = page.waitForEvent('popup'); await click(page,'#btn-first-publish-x',touch); const popup = await xPopup;
    assert.equal(new URL(popup.url()).searchParams.get('url'),expectedUrl); await popup.close();
    await click(page,'#btn-first-publish-wampogram',touch);
    await page.locator('#wamp-o-gram-modal').waitFor({state:'visible'}); await click(page,'#btn-wamp-o-gram-close',touch);
    // A second version stays a quick status update with no repeated first-publish dialog.
    await click(page,'[data-editor-shell-action="publish"]',touch);
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene?.publishedVersion>=8);
    await page.locator('#busy-overlay').waitFor({state:'hidden'});
    assert.equal(await page.locator('#first-publish-modal').isVisible(),false);
    navigating=true; await page.reload({waitUntil:'domcontentloaded'}); await readyWorld(page,touch); navigating=false;
    assert.equal(await page.locator('#first-publish-modal').isVisible(),false);
    await page.waitForTimeout(1500);
    assert.equal(await page.evaluate(()=>window.__publishProof.receipts.some(r=>r.lane==='builder')),false);

    // Use the existing entry action for fixture setup; F098 camera return and phone HUD overlap remain separate.
    // Publication and every new modal control still use actual pointer/touch input and real local mutations.
    navigating=true; await page.goto(`${base}/r/${account.x+2}/${account.y}?welcome=0&renderer=canvas`,{waitUntil:'domcontentloaded'}); await readyWorld(page,touch,true); navigating=false;
    report.entryLimitations.push({name,control:'World expanded-room entry',reason:'Existing scene entry action used for fixture setup because F098 camera return and phone account-card overlap remain open. Publish and new modal actions use pointer/touch.'});
    await page.evaluate(()=>window.__EVERYBODYS_PLATFORMER_GAME__.scene.getScene('OverworldPlayScene').openCourseComposer());
    await page.waitForFunction(id=>JSON.parse(window.render_game_to_text()).activeScene?.courseId===id,account.courseId);
    let expandedEditor='setup';
    if(name==='desktop'){
      await page.locator('#btn-course-workbench-edit-course:not(:disabled)').waitFor({state:'visible'});await click(page,'#btn-course-workbench-edit-course',touch);
      await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).activeScene?.scene==='course-editor');
      if(!await page.locator('#btn-course-editor-publish-course').isVisible()){
        await click(page,'[data-editor-dock="markers"]',touch);
        await click(page,'[data-editor-marker-action="goal"]',touch);
      }
      await click(page,'#btn-course-editor-publish-course',touch);expandedEditor='full-editor';
    }else{
      await page.locator('#btn-course-workbench-publish:not(:disabled)').waitFor({state:'visible'});
      await click(page,'#btn-course-workbench-publish',touch);
    }
    await page.locator('#first-publish-live').waitFor({state:'visible',timeout:60000});
    await page.waitForFunction(()=>document.querySelectorAll('#first-publish-preview img').length===2&&[...document.querySelectorAll('#first-publish-preview img')].every(img=>img.naturalWidth>0),null,{timeout:60000});
    assert.equal(await page.locator('#first-publish-title').textContent(),'My Expanded Adventure');
    assert.equal(await page.locator('#btn-first-publish-wampogram').isVisible(),false);
    assert.equal(await page.locator('#first-publish-link').inputValue(),new URL(`/r/${account.x+2}/${account.y}`,base).toString());
    const expandedGeometry = await geometry(page,width,height);
    await page.waitForFunction(()=>window.__publishProof.receipts.some(r=>r.lane==='builder'&&r.amount===40&&r.reason==='Published My Expanded Adventure'),null,{timeout:30000});
    await page.locator('#xp-receipt-layer').waitFor({state:'hidden',timeout:20000});
    await page.locator('#reward-sting-layer').waitFor({state:'hidden',timeout:20000});
    await page.screenshot({path:`${output}/${name}-expanded.png`});
    console.log(JSON.stringify({name,phase:'expanded-published',builderXp:40}));
    const expandedStarted=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname.startsWith('/api/expanded-rooms/')&&new URL(response.url()).pathname.endsWith('/runs/start')&&response.ok(),{timeout:30000});
    await click(page,'#btn-first-publish-play',touch);
    await page.locator('#first-publish-modal').waitFor({state:'hidden'});
    await page.waitForFunction(()=>{const s=JSON.parse(window.render_game_to_text()).activeScene;return s?.scene==='overworld-play'&&s.mode==='play'&&s.currentCollisionReady;},null,{timeout:120000});
    await expandedStarted;
    const state = await page.evaluate(()=>JSON.parse(window.render_game_to_text()));
    await page.screenshot({path:`${output}/${name}-play.png`});
    // A separately titled first publication exercises the ordinary live Play action without reopening a synthetic modal.
    navigating=true; await page.goto(`${base}/r/${account.x+5}/${account.y}?welcome=0&renderer=canvas`,{waitUntil:'domcontentloaded'}); await readyWorld(page,touch); navigating=false;
    await page.locator('#btn-world-edit:not(:disabled)').waitFor({state:'visible'}); await click(page,'#btn-world-edit',touch);
    await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).activeScene?.scene==='editor');
    await click(page,'[data-editor-shell-action="publish"]',touch); await page.locator('#first-publish-live').waitFor({state:'visible',timeout:60000});
    assert.equal(await page.locator('#first-publish-title').textContent(),'My Ready Adventure');
    assert.equal(await page.locator('#first-publish-name-form').isVisible(),false);
    await page.waitForFunction(()=>window.__publishProof.receipts.some(r=>r.lane==='builder'&&r.amount===25&&r.reason==='Published My Ready Adventure'),null,{timeout:30000});
    await click(page,'#btn-first-publish-play',touch);
    await page.waitForFunction(x=>{const s=JSON.parse(window.render_game_to_text()).activeScene;return s?.scene==='overworld-play'&&s.mode==='play'&&s.currentCollisionReady&&s.currentRoom?.x===x&&s.currentRoom?.y===133;},account.x+5,{timeout:120000});
    const ordinaryPlayState=await page.evaluate(()=>JSON.parse(window.render_game_to_text()));
    assert.ok(!ordinaryPlayState.activeScene.draftRoomsInWindow.includes(`${account.x+5},${account.y}`),'Play It Now must use the published room');
    await page.screenshot({path:`${output}/${name}-ordinary-play.png`});
    report.scenarios.push({name,nameGeometry,liveGeometry,expandedGeometry,expandedEditor,receipts,state,ordinaryPlayState,firstVersion:7,repeatVersion:8});
    console.log(JSON.stringify({name,status:'passed',mutations:report.mutations.filter(m=>m.name===name).length}));
    await context.close(); activePage=null;
  }
  assert.equal(report.errors.length,0,JSON.stringify(report.errors)); report.ok=true;
} catch(error) {
  report.ok=false; report.failure=error.stack; console.error(error);
  if(activePage){await activePage.screenshot({path:`${output}/failure.png`}).catch(()=>{});writeFileSync(`${output}/failure-state.json`,await activePage.evaluate(()=>window.render_game_to_text?.()||'{}').catch(()=> '{}'));
    report.feedback=await activePage.evaluate(()=>({receipts:window.__publishProof?.receipts,
      seen:JSON.parse(localStorage.getItem('everybodys-platformer:reward-stings:seen-progression:v1')||'{}')})).catch(()=>null);}
  process.exitCode=1;
} finally { writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2)); await browser.close(); }
