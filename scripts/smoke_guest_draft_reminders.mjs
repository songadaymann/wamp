import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:3037';
const output = process.argv[3] || 'output/web-game/guest-draft-reminders/native';
const fixture = process.env.RECOVERY_FIXTURE === '1';
const localApi = 'http://127.0.0.1:8788';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname) || fixture,
  'Live asset checks require an explicit local API fixture.');
const devices = [['desktop',1280,800,false],['phone',390,844,true],['narrow-phone',320,568,true],['landscape',844,390,true]];
const report = { at:new Date().toISOString(),base,mode:fixture?'live-assets-local-api':'local-assets-local-api',
  scenarios:[],documents:[],mutations:[],drafts:[],responses:[],errors:[],expectedErrors:[],abortedRequests:[] };
mkdirSync(output,{recursive:true});
const browser = await chromium.launch();
let activePage;
const pendingRoomRequests = new WeakMap();
const hash = text => createHash('sha256').update(text).digest('hex');
async function click(page,selector,touch) {
  if(touch && selector.startsWith('[data-editor-shell-action=') && !await page.locator(selector).isVisible()) {
    await page.locator('#btn-editor-phone-menu').tap();
  }
  return touch ? page.locator(selector).tap() : page.locator(selector).click();
}
async function ready(page) {
  await page.waitForFunction(()=>document.body.dataset.appReady==='true'
    &&!JSON.parse(window.render_game_to_text()).auth.loading,null,{timeout:120000});
}
async function snapshot(page) {
  const state = await page.evaluate(()=>{
    const s=JSON.parse(window.render_game_to_text());
    const raw=localStorage.getItem('everybodys-platformer:room:'+s.activeScene.roomId);
    const draft=raw?JSON.parse(raw).draft:null;
    return {scene:s.activeScene,authenticated:s.auth.authenticated,graphics:s.graphics.status,
      panelOpen:document.getElementById('auth-panel').classList.contains('menu-open'),focused:document.activeElement?.id,
      claimVisible:!document.getElementById('guest-builder-claim-modal').classList.contains('hidden'),
      status:document.getElementById('room-save-status')?.textContent,
      recoveryVisible:!document.getElementById('guest-room-recovery-modal').classList.contains('hidden'),
      pauseUntil:Number(localStorage.getItem('wamp_guest_draft_snooze_until_v1:guest')),
      proof:window.__recoveryProof,tileData:draft?JSON.stringify(draft.tileData):null};
  });
  if(state.tileData) {state.tileHash=hash(state.tileData);delete state.tileData;}
  return state;
}
function quiet(state) {
  assert.equal(state.authenticated,false); assert.equal(state.claimVisible,false);
  assert.equal(state.recoveryVisible,false,'Automatic draft reminder interrupted the player: '+JSON.stringify(state.proof));
  assert.equal(state.panelOpen,false); assert.equal(state.proof.opens.length,0);
  assert.equal(state.proof.emailFocus.length,0); assert.equal(state.graphics,'healthy');
}
async function menu(page,touch) {
  await click(page,'#menu-toggle',touch); await click(page,'#btn-auth-guest-drafts',touch);
  await page.locator('#guest-room-recovery-modal').waitFor({state:'visible'});
}
async function settleRoomRequests(page) {
  const started=Date.now(); let quietSince=started;
  while(Date.now()-started<15000) {
    if(pendingRoomRequests.get(page)?.size)quietSince=Date.now();
    else if(Date.now()-quietSince>=500)return;
    await page.waitForTimeout(50);
  }
  assert.fail('Room and guest-draft requests did not finish before navigation.');
}
async function home(page) {
  await settleRoomRequests(page);
  await page.goto(base+'/?welcome=0&renderer=canvas',{waitUntil:'domcontentloaded'}); await ready(page);
  await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).activeScene.mode==='browse');
  await page.waitForTimeout(4000);
}
async function fit(page,touch) {
  if(touch&&await page.locator('#btn-mobile-editor-toggle').isVisible()
    &&await page.evaluate(()=>document.body.dataset.mobileEditorCollapsed!=='true')) {
    await click(page,'#btn-mobile-editor-toggle',touch);
  }
  const control=touch?'#btn-mobile-editor-fit':'#btn-fit-screen';
  if(await page.locator(control).isVisible())await click(page,control,touch);
  // The phone dock refits on its native Hide/resize; its legacy Fit is hidden.
  await page.waitForTimeout(300);
}
async function paint(page,context,touch,row) {
  const points=await page.evaluate(row=>{
    const s=JSON.parse(window.render_game_to_text()).activeScene;
    const canvas=[...document.querySelectorAll('canvas')].filter(canvas=>{const r=canvas.getBoundingClientRect();return r.width>0&&r.height>0;}).sort((a,b)=>b.width*b.height-a.width*a.height)[0];
    const r=canvas.getBoundingClientRect();
    return Array.from({length:40},(_,column)=>{
      const x=r.x+((column*16+8-s.camera.scrollX-canvas.width/2)*s.zoom+canvas.width/2)*r.width/canvas.width;
      const y=r.y+((row*16+8-s.camera.scrollY-canvas.height/2)*s.zoom+canvas.height/2)*r.height/canvas.height;
      return {x,y,id:1,hit:document.elementFromPoint(x,y)===canvas};
    });
  },row);
  assert.ok(points.every(point=>point.hit),'Drawing must hit the actual canvas across the room: '+JSON.stringify(points));
  if(touch) {
    const cdp=await context.newCDPSession(page);
    const point=({x,y,id})=>({x,y,id});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(points[0])]});
    try {
      for(const p of points.slice(1)) {
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(p)]});
        await page.waitForTimeout(20);
      }
    } finally {await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
  } else {
    await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();
    try {for(const p of points.slice(1)){await page.mouse.move(p.x,p.y);await page.waitForTimeout(20);}}
    finally {await page.mouse.up();}
  }
}
async function autosaved(page,previousHash) {
  await page.waitForFunction(()=>{
    const s=JSON.parse(window.render_game_to_text()).activeScene;
    return s.scene==='editor'&&!s.roomDirty&&document.getElementById('room-save-status')?.textContent?.includes('Draft saved');
  },null,{timeout:30000});
  const state=await snapshot(page);
  assert.ok(state.tileHash&&state.tileHash!==previousHash,'A real stroke must change the saved draft');
  return state;
}
async function move(page,context,touch) {
  if(!touch){await page.keyboard.down('ArrowRight');await page.waitForTimeout(350);await page.keyboard.up('ArrowRight');return;}
  const box=await page.locator('#mobile-move-stick').boundingBox();assert.ok(box);
  const cdp=await context.newCDPSession(page),x=box.x+box.width/2,y=box.y+box.height/2;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
  try {await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+34,y,id:1}]});await page.waitForTimeout(350);}
  finally {await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
}
try {
  for(const [name,width,height,touch] of devices) {
    if(process.env.CASE&&process.env.CASE!==name)continue;
    const context=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch});
    await context.addInitScript(()=>{
      localStorage.setItem('wamp_replay_opt_out','1');
      localStorage.setItem('wamp.devicePerformanceMode.v1',JSON.stringify({version:1,mode:'full-quality'}));
      window.__recoveryProof={opens:[],emailFocus:[]};
      document.addEventListener('focusin',event=>{if(event.target.id==='auth-email-input')window.__recoveryProof.emailFocus.push(Date.now());});
      document.addEventListener('DOMContentLoaded',()=>{
        const modal=document.getElementById('guest-room-recovery-modal');
        new MutationObserver(records=>{
          records.forEach((record,i)=>{
            const next=records.slice(i+1).find(other=>other.target===record.target)?.oldValue??modal.className;
            if(record.oldValue?.split(' ').includes('hidden')&&!next.split(' ').includes('hidden')) {
              window.__recoveryProof.opens.push({mode:document.body.dataset.appMode,at:Date.now()});
            }
          });
        }).observe(modal,{attributes:true,attributeFilter:['class'],attributeOldValue:true});
      },{once:true});
    });
    const page=await context.newPage();activePage=page;
    const pending=new Set(); pendingRoomRequests.set(page,pending);
    page.on('request',request=>{
      const path=new URL(request.url()).pathname;
      if(path.startsWith('/api/rooms/')||path.startsWith('/api/world/')||path.startsWith('/api/guest-room-drafts'))pending.add(request);
    });
    page.on('requestfinished',request=>pending.delete(request));
    page.on('requestfailed',request=>pending.delete(request));
    page.on('pageerror',error=>report.errors.push({name,type:'pageerror',message:error.message}));
    page.on('console',message=>{if(message.type()==='error')report.errors.push({name,type:'console',message:message.text(),url:message.location().url});});
    page.on('requestfailed',request=>report.abortedRequests.push({name,path:new URL(request.url()).pathname,method:request.method(),reason:request.failure()?.errorText}));
    await page.route(url=>url.pathname.startsWith('/api/'),async route=>{
      const request=route.request(),url=new URL(request.url()),target=new URL(url.pathname+url.search,localApi);
      if(!['GET','OPTIONS'].includes(request.method()))report.mutations.push({name,path:url.pathname,method:request.method(),destination:localApi});
      const draft=request.method()==='PUT'&&url.pathname.startsWith('/api/guest-room-drafts/');
      const tileHash=draft?hash(JSON.stringify(JSON.parse(request.postData()).snapshot.tileData)):null;
      const headers=new Headers(request.headers());headers.delete('host');headers.delete('content-length');headers.set('connection','close');
      let response,body;
      try {response=await fetch(target,{method:request.method(),headers,body:request.postData()||undefined});body=Buffer.from(await response.arrayBuffer());}
      catch(error) {
        report.errors.push({name,type:'transport',path:url.pathname,method:request.method(),message:error.cause?.code||error.name});
        await route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:'Local fixture transport failed.'})});return;
      }
      report.responses.push({name,path:url.pathname,status:response.status});
      if(draft)report.drafts.push({name,path:url.pathname,status:response.status,tileHash});
      const responseHeaders=Object.fromEntries(response.headers);delete responseHeaders['content-encoding'];delete responseHeaders['content-length'];
      responseHeaders['access-control-allow-origin']=new URL(base).origin;responseHeaders['access-control-allow-credentials']='true';
      await route.fulfill({status:response.status,headers:responseHeaders,body});
    });
    page.on('response',async response=>{
      if(response.request().resourceType()==='document'&&response.ok()) {
        const html=await response.text().catch(()=>null);
        if(html)report.documents.push({name,url:response.url(),entry:html.match(/src="([^"]*\/main-[^"]+\.js)"/)?.[1]||null});
      }
    });
    await page.goto(base+'/?renderer=canvas',{waitUntil:'domcontentloaded'}); await ready(page);
    await page.locator('#welcome-modal').waitFor({state:'visible'});
    await click(page,'#btn-welcome-build',touch); await click(page,'[data-welcome-builder-mode="beginner"]',touch);
    await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).activeScene.scene==='editor',null,{timeout:60000});
    await fit(page,touch); await page.waitForFunction(()=>!JSON.parse(window.render_game_to_text()).activeScene.roomDirty);
    const initial=await snapshot(page); await paint(page,context,touch,8); const saved=await autosaved(page,initial.tileHash);
    quiet(saved); assert.match(saved.status,/Draft saved as guest/);
    assert.ok(report.drafts.some(d=>d.name===name&&d.status===200&&d.tileHash===saved.tileHash));
    console.log(JSON.stringify({name,phase:'draft-saved'}));
    await settleRoomRequests(page);
    await page.goto(base+'/r/-11/-6?welcome=0&renderer=canvas',{waitUntil:'domcontentloaded'}); await ready(page);
    await page.locator('#room-goal-intro-modal').waitFor({state:'visible'}); await page.waitForTimeout(4000);
    const intro=await snapshot(page); quiet(intro);
    await page.screenshot({path:`${output}/${name}-shared-intro.png`});
    await click(page,'#btn-room-goal-intro-start',touch);
    await page.waitForFunction(()=>{const s=JSON.parse(window.render_game_to_text()).activeScene;return s.currentCollisionReady&&s.goalRun?.elapsedMs>0;},null,{timeout:60000});
    const before=await snapshot(page); await move(page,context,touch); await page.waitForTimeout(4000);
    const playing=await snapshot(page); quiet(playing);
    assert.ok(playing.scene.player.x>before.scene.player.x+2,'Shared Play must accept native movement');
    await page.screenshot({path:`${output}/${name}-shared-play.png`});
    await click(page,touch?'#btn-mobile-world-stop':'#btn-world-play',touch);
    await page.locator('#guest-room-recovery-modal').waitFor({state:'visible',timeout:60000});
    const reminder=await snapshot(page); assert.equal(reminder.scene.mode,'browse');
    await page.screenshot({path:`${output}/${name}-browse-reminder.png`});
    await click(page,'#btn-guest-room-recovery-close',touch); const closed=await snapshot(page);
    await home(page); const reloaded=await snapshot(page); quiet(reloaded);
    await menu(page,touch); await click(page,'#btn-guest-room-recovery-go',touch);
    await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).activeScene.scene==='editor',null,{timeout:60000});
    const recovered=await snapshot(page); assert.equal(recovered.scene.roomId,saved.scene.roomId); assert.equal(recovered.tileHash,saved.tileHash);
    await fit(page,touch); await paint(page,context,touch,6); const newer=await autosaved(page,saved.tileHash);
    assert.equal(newer.recoveryVisible,false); assert.equal(newer.claimVisible,false);
    assert.ok(report.drafts.some(d=>d.name===name&&d.status===200&&d.tileHash===newer.tileHash));
    await page.screenshot({path:`${output}/${name}-continued-draft.png`});
    await home(page); const newerReload=await snapshot(page); quiet(newerReload);
    assert.ok(newerReload.pauseUntil>Date.now()&&newerReload.pauseUntil<=Date.now()+3*24*60*60*1000);
    await page.screenshot({path:`${output}/${name}-quiet-return.png`});
    await menu(page,touch); await page.screenshot({path:`${output}/${name}-manual-recovery.png`});
    await click(page,'#btn-guest-room-recovery-go',touch);
    await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).activeScene.scene==='editor',null,{timeout:60000});
    const latest=await snapshot(page); assert.equal(latest.tileHash,newer.tileHash); assert.equal(latest.scene.roomId,saved.scene.roomId);
    await home(page); quiet(await snapshot(page)); await menu(page,touch);
    await click(page,'#btn-guest-room-recovery-signin',touch);
    await page.waitForFunction(()=>document.getElementById('auth-panel').classList.contains('menu-open')&&document.activeElement?.id==='auth-email-input');
    const signIn=await snapshot(page); assert.equal(signIn.recoveryVisible,false);
    assert.match(await page.locator('#auth-status').textContent(),/save this guest draft to your account/);
    await page.screenshot({path:`${output}/${name}-chosen-signin.png`});
    report.scenarios.push({name,saved,intro,before,playing,reminder,closed,reloaded,recovered,newer,newerReload,latest,signIn});
    console.log(JSON.stringify({name,status:'passed',sharedMovement:playing.scene.player.x-before.scene.player.x,latestDraftRecovered:true}));
    await settleRoomRequests(page); await context.close(); activePage=null;
  }
  // Only separate failures with exact captured request/status evidence. The local
  // Worker has no PartyKit identity secret.
  report.errors=report.errors.filter(error=>{
    if(error.type!=='console')return true;
    const path=new URL(error.url||base,base).pathname;
    const unavailable=/Failed to load resource: the server responded with a status of 503/.test(error.message);
    const fixtureFailure=unavailable&&report.responses.some(r=>r.name===error.name&&r.path===path&&r.status===503)
      &&(path==='/api/presence/identity-token'||report.responses.some(r=>r.name===error.name&&r.path===path&&r.forced));
    const aborted=report.abortedRequests.some(r=>r.name===error.name&&r.method==='GET'&&r.reason==='net::ERR_ABORTED'
      &&((r.path==='/api/chat/messages'&&/Failed to poll chat messages TypeError: Failed to fetch/.test(error.message))
        ||(r.path.startsWith('/api/leaderboards/')&&/Failed to load leaderboards TypeError: Failed to fetch/.test(error.message))));
    if(fixtureFailure||aborted) {report.expectedErrors.push({...error,reason:fixtureFailure?'captured local fixture 503':'captured aborted navigation GET'});return false;}
    return true;
  });
  assert.ok(report.scenarios.length>0);
  assert.ok(report.drafts.every(draft=>draft.status===200||draft.forced),"Unexpected guest save failure: "+JSON.stringify(report.drafts));
  assert.equal(report.errors.length,0,JSON.stringify(report.errors));
  assert.ok(!report.mutations.some(m=>m.path.startsWith('/api/auth/')),'Do not send email or write accounts.');
  report.ok=true;
} catch(error) {
  report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;
  if(activePage){await activePage.screenshot({path:`${output}/failure.png`}).catch(()=>{});report.failureState=await snapshot(activePage).catch(()=>null);}
} finally {writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));await browser.close();}
