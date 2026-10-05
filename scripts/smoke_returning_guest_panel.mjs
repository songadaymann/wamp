import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:3036';
const output = process.argv[3] || 'output/web-game/returning-guest-panel/native';
const devices = [['desktop',1280,800,false],['phone',390,844,true],['narrow-phone',320,568,true],['landscape',844,390,true]];
const report = { at:new Date().toISOString(),base,scenarios:[],documents:[],errors:[],expectedErrors:[],abortedRequests:[],mutations:[] };
mkdirSync(output,{recursive:true});
const browser = await chromium.launch();
let activePage;
const click = (page,selector,touch) => touch ? page.locator(selector).tap() : page.locator(selector).click();

async function contextFor(width,height,touch,returning) {
  const context = await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch});
  await context.addInitScript(returning => {
    if(returning)localStorage.setItem('wamp_welcome_modal_seen_v1','1');
    localStorage.setItem('wamp_replay_opt_out','1');
    localStorage.setItem('wamp.devicePerformanceMode.v1',JSON.stringify({version:1,mode:'full-quality'}));
    window.__guestPanelFocus = [];
    document.addEventListener('focusin',event => {
      if(event.target.id==='auth-email-input')window.__guestPanelFocus.push({at:Date.now(),ready:document.body?.dataset.appReady});
    });
  },returning);
  return context;
}
function observe(page,name) {
  let navigating=false,abortedChats=0,abortedLeaderboards=0;
  page.on('pageerror',error=>report.errors.push({name,message:error.message}));
  page.on('request',request=>{
    const path=new URL(request.url()).pathname;
    if(path.startsWith('/api/')&&!['GET','OPTIONS'].includes(request.method()))report.mutations.push({name,path,method:request.method()});
  });
  page.on('requestfailed',request=>{
    if(!navigating||request.failure()?.errorText!=='net::ERR_ABORTED')return;
    const path=new URL(request.url()).pathname;
    report.abortedRequests.push({name,path,method:request.method(),reason:'net::ERR_ABORTED'});
    if(path==='/api/chat/messages')abortedChats++;
    if(request.method()==='GET'&&path.startsWith('/api/leaderboards/'))abortedLeaderboards++;
  });
  page.on('console',message=>{
    if(message.type()!=='error')return;
    const entry={name,message:message.text(),url:message.location().url};
    if(/Failed to poll chat messages TypeError: Failed to fetch/.test(entry.message)&&abortedChats>0){abortedChats--;report.expectedErrors.push(entry);}
    else if(/Failed to load leaderboards TypeError: Failed to fetch/.test(entry.message)&&abortedLeaderboards>0){abortedLeaderboards--;report.expectedErrors.push(entry);}
    else report.errors.push(entry);
  });
  page.on('response',async response=>{
    if(response.request().resourceType()!=='document'||!response.ok())return;
    const html=await response.text().catch(()=>null);
    if(html)report.documents.push({name,url:response.url(),entry:html.match(/src="([^"]*\/main-[^"]+\.js)"/)?.[1]||null});
  });
  return async (path,reload=false) => {
    navigating=true;
    try {
      if(reload)await page.reload({waitUntil:'domcontentloaded'});
      else await page.goto(base+path,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.body.dataset.appReady==='true'&&!JSON.parse(window.render_game_to_text()).auth.loading,null,{timeout:120000});
      await page.waitForTimeout(350);
    } finally { navigating=false; }
  };
}
async function snapshot(page) {
  return page.evaluate(()=>{
    const s=JSON.parse(window.render_game_to_text());
    return {panelOpen:document.getElementById('auth-panel').classList.contains('menu-open'),focused:document.activeElement?.id,
      startupEmailFocus:window.__guestPanelFocus.length,authenticated:s.auth.authenticated,graphics:s.graphics.status,
      mode:s.activeScene.mode,room:s.activeScene.currentRoom,player:s.activeScene.player,
      modals:[...document.querySelectorAll('.history-modal:not(.hidden)')].map(el=>el.id)};
  });
}
function assertGuestBoot(state) {
  assert.equal(state.authenticated,false,JSON.stringify(state));
  assert.equal(state.panelOpen,false,'Guest menu opened itself: '+JSON.stringify(state));
  assert.notEqual(state.focused,'auth-email-input');
  assert.equal(state.startupEmailFocus,0,'Startup stole email focus: '+JSON.stringify(state));
  assert.equal(state.graphics,'healthy');
}
async function drive(page,context,touch,untilClear=false) {
  let release;
  if(!touch){await page.keyboard.down('ArrowRight');release=()=>page.keyboard.up('ArrowRight');}
  else {
    const box=await page.locator('#mobile-move-stick').boundingBox();assert.ok(box);
    const cdp=await context.newCDPSession(page),x=box.x+box.width/2,y=box.y+box.height/2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+34,y,id:1}]});
    release=async()=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();};
  }
  try {
    if(untilClear)await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).activeScene.goalRun?.result==='completed',null,{timeout:20000});
    else await page.waitForTimeout(350);
  } finally {await release();}
}
try {
  for(const [name,width,height,touch] of devices) {
    if(process.env.CASE&&process.env.CASE!==name)continue;
    const context=await contextFor(width,height,touch,true),page=await context.newPage();activePage=page;
    const navigate=observe(page,name);
    await navigate('/?renderer=canvas');
    const home=await snapshot(page);await page.screenshot({path:`${output}/${name}-home.png`});assertGuestBoot(home);
    assert.equal(await page.locator('#welcome-modal').isVisible(),false);
    await click(page,'#menu-toggle',touch);assert.equal((await snapshot(page)).panelOpen,true);
    await page.locator('#auth-email-input').fill('guest@example.test');assert.equal((await snapshot(page)).focused,'auth-email-input');
    await page.screenshot({path:`${output}/${name}-explicit-menu.png`});
    if(!touch)await page.mouse.click(20,height/2);
    else await click(page,'#menu-toggle',touch);
    assert.equal((await snapshot(page)).panelOpen,false);
    await navigate('',true);const reloaded=await snapshot(page);assertGuestBoot(reloaded);
    await navigate('/r/-11/-6?welcome=0&renderer=canvas');
    await page.locator('#room-goal-intro-modal').waitFor({state:'visible',timeout:60000});
    const shared=await snapshot(page);assertGuestBoot(shared);assert.deepEqual(shared.modals,['room-goal-intro-modal']);
    await page.screenshot({path:`${output}/${name}-shared-intro.png`});
    await click(page,'#btn-room-goal-intro-start',touch);
    await page.waitForFunction(()=>{const s=JSON.parse(window.render_game_to_text()).activeScene;return s.mode==='play'&&s.currentCollisionReady&&s.goalRun?.elapsedMs>0;},null,{timeout:120000});
    const before=await snapshot(page);assertGuestBoot(before);assert.deepEqual(before.modals,[]);
    await drive(page,context,touch);const playing=await snapshot(page);
    assert.ok(playing.player.x>before.player.x+2,JSON.stringify({before:before.player,after:playing.player}));
    assert.equal(playing.panelOpen,false);await page.screenshot({path:`${output}/${name}-playing.png`});
    let savePrompt;
    if(name==='desktop') {
      await drive(page,context,false,true);
      await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).activeScene.goalRun?.guestProgress?.status==='saved',null,{timeout:20000});
      await page.locator('#reward-sting-layer').waitFor({state:'hidden',timeout:20000});
      await page.locator('#btn-post-run-reminder').waitFor({state:'visible'});
      assert.equal(await page.locator('#btn-post-run-reminder').textContent(),'Save 1 clear');
      await click(page,'#btn-post-run-reminder',false);
      await page.waitForFunction(()=>document.getElementById('auth-panel').classList.contains('menu-open')&&document.activeElement?.id==='auth-email-input');
      savePrompt={...await snapshot(page),status:await page.locator('#auth-status').textContent()};
      assert.match(savePrompt.status,/Sign in within 14 days/);await page.screenshot({path:`${output}/${name}-save-signin.png`});
    }
    await context.close();activePage=null;
    const freshContext=await contextFor(width,height,touch,false),freshPage=await freshContext.newPage();activePage=freshPage;
    const freshNavigate=observe(freshPage,name+'-fresh');await freshNavigate('/?renderer=canvas');
    await freshPage.locator('#welcome-modal').waitFor({state:'visible',timeout:15000});
    const fresh=await snapshot(freshPage);assertGuestBoot(fresh);assert.deepEqual(fresh.modals,['welcome-modal']);
    await freshPage.screenshot({path:`${output}/${name}-fresh-welcome.png`});
    await click(freshPage,'#btn-welcome-close',touch);assert.equal(await freshPage.locator('#welcome-modal').isVisible(),false);
    assert.equal((await snapshot(freshPage)).panelOpen,false);
    report.scenarios.push({name,home,reloaded,shared,before,playing,savePrompt,fresh});
    console.log(JSON.stringify({name,status:'passed',movement:playing.player.x-before.player.x,contextualSignIn:Boolean(savePrompt)}));
    await freshContext.close();activePage=null;
  }
  assert.equal(report.errors.length,0,JSON.stringify(report.errors));
  assert.ok(!report.mutations.some(m=>m.path.startsWith('/api/auth/')),'Sign-in verification must not send email or account writes');
  report.ok=true;
} catch(error) {
  report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;
  if(activePage){await activePage.screenshot({path:`${output}/failure.png`}).catch(()=>{});report.failureState=await snapshot(activePage).catch(()=>null);}
} finally {writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));await browser.close();}
