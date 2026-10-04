import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://127.0.0.1:3034';
const output = process.argv[3] || 'output/web-game/welcome-destinations/native';
const devices = [['desktop',1280,800,false],['phone',390,844,true],['tablet',1024,768,true],['landscape',844,390,true],['narrow-phone',320,568,true]];
mkdirSync(output,{recursive:true});
const report={at:new Date().toISOString(),base,scenarios:[],documents:[],errors:[]};
const browser=await chromium.launch();let activePage,activeName;
const state=page=>page.evaluate(()=>JSON.parse(window.render_game_to_text()).activeScene);
const click=async(page,selector,touch)=>touch?page.locator(selector).tap():page.locator(selector).click();
async function startGoal(page,touch,allowPlaying=false) {
 if(allowPlaying) {
  await page.waitForFunction(()=>!document.getElementById('room-goal-intro-modal').classList.contains('hidden')||JSON.parse(window.render_game_to_text()).activeScene?.mode==='play');
  await page.waitForTimeout(300);
 } else await page.locator('#room-goal-intro-modal').waitFor({state:'visible'});
 if(await page.locator('#room-goal-intro-modal').isVisible())await click(page,'#btn-room-goal-intro-start',touch);
 await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).activeScene?.mode==='play');
 await page.waitForTimeout(300);
}
async function holdRight(page,context,touch,ms) {
 const wait=()=>ms===null?page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).activeScene?.goalRun?.result==='completed',null,{timeout:20000}):page.waitForTimeout(ms);
 if(!touch) {await page.keyboard.down('ArrowRight');try {await wait();}finally {await page.keyboard.up('ArrowRight');}return;}
 const box=await page.locator('#mobile-move-stick').boundingBox();assert.ok(box);
 const cdp=await context.newCDPSession(page),x=box.x+box.width/2,y=box.y+box.height/2;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+34,y,id:1}]});
 try {await wait();}finally {await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
}
try {
 for(const [name,width,height,touch] of devices) for(const lane of ['explore','play','build']) {
  const scenario=`${name}-${lane}`;if(process.env.CASE&&!scenario.includes(process.env.CASE))continue;
  activeName=scenario;const context=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch});
  await context.addInitScript(()=>{localStorage.setItem('wamp_replay_opt_out','1');localStorage.setItem('wamp.devicePerformanceMode.v1',JSON.stringify({version:1,mode:'full-quality'}));});
  const page=await context.newPage();activePage=page;
  page.on('pageerror',error=>report.errors.push({scenario,message:error.message}));
  page.on('console',message=>{if(message.type()==='error'&&!(base.includes('127.0.0.1')&&message.location().url.includes('/api/presence/identity-token')))report.errors.push({scenario,message:message.text(),url:message.location().url});});
  await page.goto(`${base}/?welcome=1${process.env.RENDERER?'&renderer='+process.env.RENDERER:''}`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.body.dataset.appReady==='true',null,{timeout:120000});
  const entry=await page.locator('script[type="module"]').first().getAttribute('src');report.documents.push({scenario,url:page.url(),entry});
  if(process.env.EXPECTED_ENTRY)assert.equal(entry,process.env.EXPECTED_ENTRY);
  await page.locator('#welcome-modal').waitFor({state:'visible'});
  await page.screenshot({path:`${output}/${scenario}-welcome.png`});
  await click(page,`#btn-welcome-${lane}`,touch);
  if(lane==='explore') {
   await page.locator('#explore-modal').waitFor({state:'visible'});
   await page.waitForFunction(()=>document.querySelectorAll('#explore-modal .explore-room-card').length>0);
   const playAll=page.locator('#explore-queue-actions .explore-queue-start-btn').first();await playAll.waitFor({state:'visible'});
   await page.screenshot({path:`${output}/${scenario}-rooms.png`});
   await click(page,'#explore-queue-actions .explore-queue-start-btn',touch);
   await page.locator('#room-goal-intro-modal').waitFor({state:'visible'});
   assert.equal((await page.evaluate(()=>window.get_room_sequence_state())).kind,'explore');
  } else if(lane==='play') {
   await page.locator('#playlist-intro-modal').waitFor({state:'visible'});
   await page.screenshot({path:`${output}/${scenario}-guide.png`});
   await click(page,'#btn-playlist-intro-start',touch);await startGoal(page,touch);
   assert.equal((await page.evaluate(()=>window.get_room_sequence_state())).count,6);
   assert.equal((await page.evaluate(()=>window.get_room_sequence_state())).currentRoomId,'-11,-6');
   const nextSelector=touch?'#btn-mobile-room-sequence-next':'#btn-room-sequence-next';
   const next=await page.locator(nextSelector).boundingBox();assert.ok(next&&next.y>=0&&next.y+next.height<=height);
   if(touch)assert.ok(next.height>=44,`Next is too small: ${JSON.stringify(next)}`);
   await page.screenshot({path:`${output}/${scenario}-run.png`});
   if(name==='desktop'||name==='phone') {
    await holdRight(page,context,touch,null);
    await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).activeScene?.goalRun?.result==='completed',{},{timeout:20000});
    await page.waitForTimeout(1200);
   }
   for(let index=1;index<6;index++) {
    await click(page,nextSelector,touch);
    await startGoal(page,touch);
    const queue=await page.evaluate(()=>window.get_room_sequence_state());assert.equal(queue.index,index);assert.equal(queue.currentRoomId,`${-11+index},-6`);
    assert.ok((await page.locator('#room-sequence-meta').textContent()).includes(`Room ${index+1} of 6`));
    if(touch)assert.ok((await page.locator(nextSelector).innerText()).includes(`${index+1}/6`));
   }
   await click(page,nextSelector,touch);
   await page.locator('#first-steps-summary-modal').waitFor({state:'visible'});
   const summary=await page.locator('#first-steps-summary-count').innerText();
   assert.equal(summary,`${name==='desktop'||name==='phone'?1:0} of 6 rooms cleared.`);
   assert.equal((await page.evaluate(()=>window.get_room_sequence_state())).active,false);
   await page.screenshot({path:`${output}/${scenario}-summary.png`});
   await click(page,'#btn-first-steps-explore',touch);await page.locator('#explore-modal').waitFor({state:'visible'});
  } else {
   await page.locator('#welcome-builder-choice').waitFor({state:'visible'});
   await click(page,'[data-welcome-builder-mode="beginner"]',touch);
   await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).activeScene?.scene==='editor',null,{timeout:45000});
   await page.waitForTimeout(2000);
   await page.screenshot({path:`${output}/${scenario}-starter.png`});
   const before=await state(page);writeFileSync(`${output}/${scenario}-starter.json`,JSON.stringify(before,null,2));
   assert.equal(await page.locator('#room-title-input').inputValue(),'My First Room');
   assert.equal(before.goal?.type,'reach_exit');
   assert.ok(before.spawnPoint);
   await page.waitForFunction(roomId=>JSON.parse(localStorage.getItem('everybodys-platformer:room:'+roomId)||'null')?.draft?.title==='My First Room',before.roomId,{timeout:30000});
   await click(page,'[data-editor-shell-action="test"]',touch);
   await startGoal(page,touch,true);
   await holdRight(page,context,touch,null);
   await page.screenshot({path:`${output}/${scenario}-test.png`});
   const tested=await state(page);writeFileSync(`${output}/${scenario}-test.json`,JSON.stringify(tested,null,2));
   assert.equal(tested.goalRun?.result,'completed');
  }
  report.scenarios.push({scenario,passed:true});writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));await context.close();
 }
 assert.equal(report.errors.length,0,JSON.stringify(report.errors));
} catch(error) {
 report.failure={scenario:activeName,message:error.message};
 if(activePage)await activePage.screenshot({path:`${output}/failure.png`}).catch(()=>{});
 throw error;
} finally {writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({scenarios:report.scenarios.length,errors:report.errors.length,output}));
