import assert from 'node:assert/strict';
import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const base=process.argv[2]||'http://127.0.0.1:3033', output=process.argv[3]||'output/web-game/room-insights/native';
const local=new URL(base).hostname==='127.0.0.1', isolated=process.env.INSIGHTS_FIXTURE==='1';
assert.ok(local||isolated,'Owned editor fixtures require a local backend or explicit isolated live-assets mode');
const auth=JSON.parse(readFileSync('output/web-game/room-insights/local-auth.json','utf8'));
const report={at:new Date().toISOString(),base,mode:isolated?'live-assets-local-api-fixture':'real-local-api',scenarios:[],documents:[],errors:[],expectedErrors:[],blockedWrites:[]};
const devices=[['desktop',1280,800,false],['phone',390,844,true],['narrow-phone',320,568,true],['landscape',844,390,true]];
mkdirSync(output,{recursive:true});const browser=await chromium.launch();let activePage;
const click=async(page,selector,touch)=>{
 if(touch&&selector.startsWith('[data-editor-shell-action=')&&!await page.locator(selector).isVisible())await page.locator('#btn-editor-phone-menu').tap();
 return touch?page.locator(selector).tap():page.locator(selector).click();
};
try {
 for(const [name,width,height,touch] of devices) {
  if(process.env.CASE&&!name.includes(process.env.CASE))continue;
  const context=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch});
  await context.addInitScript(()=>{localStorage.setItem('wamp_welcome_modal_seen_v1','1');localStorage.setItem('wamp_replay_opt_out','1');localStorage.setItem('wamp.devicePerformanceMode.v1',JSON.stringify({version:1,mode:'full-quality'}));});
  if(local)await context.addCookies([{name:'ep_session',value:auth.cookie,domain:'127.0.0.1',path:'/',httpOnly:true,sameSite:'Lax'}]);
  const page=await context.newPage();activePage=page;let deliberateFailure=false,delayStats=false,releaseStats,statsWaiting=false;
  const pending=new Set();page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/leaderboards/'))pending.add(r);});
  for(const event of ['requestfinished','requestfailed'])page.on(event,r=>pending.delete(r));
  page.on('pageerror',error=>report.errors.push({name,message:error.message}));
  page.on('console',message=>{
   if(message.type()!=='error')return;const entry={name,message:message.text(),url:message.location().url};
   if(entry.url.includes('/api/presence/identity-token')||(local||isolated)&&entry.url.includes('/construction-preview-token')||deliberateFailure&&entry.url.includes('/stats'))report.expectedErrors.push(entry);else report.errors.push(entry);
  });
  await page.route('**/api/**',async route=>{
   const r=route.request(),url=new URL(r.url());
   if(url.pathname.includes('/stats')&&delayStats) {statsWaiting=true;await new Promise(resolve=>{releaseStats=resolve;});}
   if(url.pathname.includes('/stats')&&deliberateFailure)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Statistics are temporarily unavailable.'})});
   if(isolated) {
    if(url.pathname.startsWith('/api/presence/'))return route.fulfill({status:403,contentType:'application/json',body:'{"error":"Presence is disabled for this fixture."}'});
    if(r.method()==='POST'&&url.pathname==='/api/runs/start')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({attemptId:'insight-fixture',roomId:'-11,-6',roomVersion:10,goalType:'reach_exit',startedAt:new Date().toISOString(),userId:auth.userId,userDisplayName:'Insights Builder',verificationSchemaVersion:1,verificationNonce:'fixture',snapshotHash:'fixture'})});
    if(!['GET','OPTIONS'].includes(r.method())&&url.pathname!=='/api/rooms/snapshots/query') {report.blockedWrites.push(url.pathname);return route.fulfill({status:200,contentType:'application/json',body:'{}'});}
    const response=await fetch('http://127.0.0.1:8788'+url.pathname+url.search,{method:r.method(),headers:{Cookie:`ep_session=${auth.cookie}`,'Content-Type':'application/json'},...(r.postData()?{body:r.postData()}:{})});
    return route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});
   }
   return route.continue();
  });
  await page.goto(`${base}/?welcome=0`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.body.dataset.appReady==='true',null,{timeout:120000});
  await page.evaluate(()=>window.__wampEarlyWorldTiles?.release('insights-smoke'));
  const entry=await page.locator('script[type="module"]').first().getAttribute('src');report.documents.push({name,entry});if(process.env.EXPECTED_ENTRY)assert.equal(entry,process.env.EXPECTED_ENTRY);
  await page.evaluate(()=>{document.getElementById('btn-room-goal-intro-close')?.click();document.querySelector('#auth-panel.menu-open')&&document.getElementById('menu-toggle')?.click();});
  for(const expanded of [false,true]) {
   if(expanded) {
    await click(page,'[data-editor-shell-action="back"]',touch);
    await page.evaluate(()=>{const scene=window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.OverworldPlayScene;scene.scene.run('CourseComposerScene',{courseId:'f124-expanded',selectedCoordinates:{x:99,y:99},centerCoordinates:{x:99,y:99}});scene.scene.sleep();});
    await page.waitForFunction(()=>window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.CourseComposerScene.record?.draft.id==='f124-expanded');
    await click(page,'#btn-course-workbench-edit-course',touch);
   } else {
    const current=await fetch('http://127.0.0.1:8788/api/rooms/98%2C99/current',{headers:{Cookie:`ep_session=${auth.cookie}`}}).then(r=>r.json());
    await page.evaluate(async snapshot=>{const scene=window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.OverworldPlayScene;scene.returnToWorld();await scene.openGuestDraftRoom(snapshot,()=>true,false);},current.published);
   }
   const key=expanded?'CourseEditorScene':'EditorScene';
   await page.waitForFunction(key=>{const s=window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys[key];return s?.scene.isActive()&&s.getRoomInsightsTarget()?.version===1;},key,{timeout:30000});
   await page.waitForTimeout(500);
   await click(page,'[data-editor-shell-action="room"]',touch);await click(page,'#editor-drawer-room-tabs [data-room-insights-open]',touch);
   await page.locator('#room-insights-metrics dd').first().waitFor();
   assert.equal(await page.locator('#room-insights-metrics dd').nth(0).textContent(),'12');
   assert.equal(await page.locator('#room-insights-metrics dd').nth(2).textContent(),'5');
   assert.equal(await page.locator('#room-insights-metrics dd').nth(3).textContent(),'42%');
   assert.equal(await page.locator('#room-insights-metrics dd').nth(5).textContent(),expanded?'2.0':'1.5');
   assert.match(await page.locator('#room-insights-status').textContent(),/published v1/);
   const panel=await page.locator('.room-insights-panel').boundingBox();assert.ok(panel.x>=0&&panel.x+panel.width<=width&&panel.y>=0&&panel.y+panel.height<=height,JSON.stringify(panel));
   assert.equal(await page.locator('.room-insights-panel').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
   await page.screenshot({path:`${output}/${name}-${expanded?'expanded':'room'}-insights.png`});
   await click(page,'#room-insights-map',touch);assert.equal(await page.locator('#room-insights-map').isChecked(),true);
   await click(page,'#btn-room-insights-close',touch);await page.waitForTimeout(100);
   const map=await page.evaluate(key=>{const s=window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys[key];const graphics=key==='EditorScene'?s.overlayController.deathMapGraphics:s.roomDeathMap;return {commands:graphics.commandBuffer.length,visible:graphics.visible};},key);
   assert.ok(map.commands>0&&map.visible,'Death map must draw in the actual editor graphics');
   await page.screenshot({path:`${output}/${name}-${expanded?'expanded':'room'}-map.png`});
   await click(page,'#btn-editor-death-map-clear',touch);const cleared=await page.evaluate(key=>{const s=window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys[key];return (key==='EditorScene'?s.overlayController.deathMapGraphics:s.roomDeathMap).commandBuffer.length;},key);assert.equal(cleared,0);
   if(!expanded) {
    await click(page,'[data-editor-shell-action="share"]',touch);await click(page,'#editor-share-popover [data-room-insights-open]',touch);await page.locator('#room-insights-metrics dd').first().waitFor();await page.keyboard.press('Escape');assert.equal(await page.locator('#room-insights-modal').isVisible(),false);
   }
   console.log(name+' '+(expanded?'expanded':'room')+': metrics and editor map pass.');
   report.scenarios.push({name,expanded,checks:['real versioned API metrics','viewport fit','native Room Insights','drawn map','Hide Map','Close',...(!expanded?['Share Insights','Escape']:[])]});
  }
  deliberateFailure=true;await click(page,'#editor-drawer-room-tabs [data-room-insights-open]',touch);await page.locator('#btn-room-insights-retry').waitFor({state:'visible'});assert.match(await page.locator('#room-insights-status').textContent(),/unavailable/);
  deliberateFailure=false;await click(page,'#btn-room-insights-retry',touch);await page.locator('#room-insights-metrics dd').first().waitFor();await click(page,'#btn-room-insights-close',touch);
  report.scenarios.push({name,checks:['explicit offline error','retry']});
  await click(page,'#editor-drawer-room-tabs [data-room-insights-open]',touch);await page.locator('#room-insights-metrics dd').first().waitFor();await click(page,'#room-insights-map',touch);await click(page,'#btn-room-insights-close',touch);
  await click(page,'[data-editor-shell-action="back"]',touch);
  await page.waitForFunction(()=>window.__EVERYBODYS_PLATFORMER_GAME__.scene.isActive('CourseComposerScene'));
  assert.equal(await page.locator('#editor-death-map-key').isVisible(),false);
  assert.equal(await page.evaluate(()=>window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.CourseEditorScene.roomDeathMap?.commandBuffer.length??0),0);
  await page.evaluate(()=>window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.CourseComposerScene.returnToWorld());
  await page.waitForFunction(()=>document.body.dataset.appMode==='world');
  const empty=await fetch('http://127.0.0.1:8788/api/rooms/101%2C99/current',{headers:{Cookie:`ep_session=${auth.cookie}`}}).then(r=>r.json());
  await page.evaluate(async snapshot=>{await window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.OverworldPlayScene.openGuestDraftRoom(snapshot,()=>true,false);},empty.published);
  await page.waitForFunction(()=>document.body.dataset.appMode==='editor');
  await click(page,'[data-editor-shell-action="room"]',touch);await click(page,'#editor-drawer-room-tabs [data-room-insights-open]',touch);await page.locator('#room-insights-metrics dd').first().waitFor();
  assert.equal(await page.locator('#room-insights-metrics dd').first().textContent(),'0');assert.equal(await page.locator('#room-insights-metrics dd').nth(3).textContent(),'—');assert.equal(await page.locator('#room-insights-map').isDisabled(),true);
  await page.screenshot({path:`${output}/${name}-empty.png`});await click(page,'#btn-room-insights-close',touch);
  delayStats=true;await click(page,'#editor-drawer-room-tabs [data-room-insights-open]',touch);
  const waitDeadline=Date.now()+5000;while(!statsWaiting&&Date.now()<waitDeadline)await page.waitForTimeout(50);assert.ok(statsWaiting);
  await click(page,'#btn-room-insights-close',touch);const late=page.waitForResponse(r=>r.url().includes('/101%2C99/stats'));delayStats=false;releaseStats();await late;await page.waitForTimeout(100);
  assert.equal(await page.locator('#room-insights-modal').isVisible(),false);assert.equal(await page.locator('#room-insights-metrics dd').count(),0);
  await click(page,'[data-editor-shell-action="back"]',touch);
  await page.waitForFunction(()=>document.body.dataset.appMode==='world');
  report.scenarios.push({name,checks:['leaving editor clears map','empty statistics','closed panel ignores late response']});
  await click(page,'#menu-toggle',touch);await click(page,'#auth-identity',touch);await click(page,'#btn-profile-tab-rooms',touch);
  const profileRoom=page.locator('.profile-room-playlist-row').filter({has:page.locator('.profile-room-card-title',{hasText:'Insights Gauntlet'})}).first();
  await profileRoom.locator('.room-insight-summary').waitFor();assert.match(await profileRoom.locator('.room-insight-summary').textContent(),/12 attempts.*5 clears.*42% clear/);
  await page.screenshot({path:`${output}/${name}-profile.png`});
  if(touch)await profileRoom.locator('.profile-room-actions button:has-text("Insights")').tap();else await profileRoom.locator('.profile-room-actions button:has-text("Insights")').click();await page.locator('#room-insights-metrics dd').first().waitFor();assert.equal(await page.locator('#profile-modal').isVisible(),false);assert.equal(await page.locator('#room-insights-map').isDisabled(),true);await click(page,'#btn-room-insights-close',touch);
  if(await page.locator('#auth-panel').evaluate(el=>el.classList.contains('menu-open')))await click(page,'#menu-toggle',touch);
  if(await page.locator('#btn-world-explore').isVisible())await click(page,'#btn-world-explore',touch);
  else {await page.goto(`${base}/?welcome=1`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.body.dataset.appReady==='true',null,{timeout:120000});await click(page,'#btn-welcome-explore',touch);}
  await click(page,'[data-explore-sort="newest"]',touch);await page.locator('.explore-room-card').first().waitFor();
  await page.waitForFunction(()=>document.getElementById('explore-list')?.textContent.includes('Played by 1'));
  await page.screenshot({path:`${output}/${name}-explore.png`});await click(page,'#btn-explore-close',touch);
  report.scenarios.push({name,checks:['profile statistics','native profile Insights','Explore player count']});
  const deadline=Date.now()+15000;while(pending.size&&Date.now()<deadline)await page.waitForTimeout(100);assert.equal(pending.size,0);await page.waitForTimeout(500);await context.close();
 }
 assert.equal(report.errors.length,0,JSON.stringify(report.errors));
} catch(error) {report.failure=error.stack||String(error);if(activePage)await activePage.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error;}
finally {writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();}
