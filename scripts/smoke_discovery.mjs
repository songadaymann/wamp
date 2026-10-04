import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
const base=process.argv[2]||'http://127.0.0.1:3033';
const output=process.argv[3]||'output/web-game/discovery/native';mkdirSync(output,{recursive:true});
const devices=[['desktop',1280,800,false],['phone',390,844,true],['tablet',1024,768,true],['landscape',844,390,true],['narrow-phone',320,568,true]];
const report={at:new Date().toISOString(),base,scenarios:[],documents:[],errors:[]};
const browser=await chromium.launch();let activePage,activeName;
const click=(page,selector,touch)=>touch?page.locator(selector).tap():page.locator(selector).click();
const loaded=(page,sort)=>page.waitForFunction(sort=>{
 const button=document.querySelector(`[data-explore-sort="${sort}"]`);
 return button?.classList.contains('active')&&!button.disabled&&document.querySelectorAll('#explore-modal .explore-room-card').length>0;
},sort);
const discovery=page=>page.waitForResponse(r=>r.url().includes('/api/leaderboards/rooms/discover')&&r.request().method()==='GET');
try{
 for(const [name,width,height,touch]of devices){if(process.env.CASE&&!name.includes(process.env.CASE))continue;activeName=name;
 const context=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch});
 await context.addInitScript(()=>{localStorage.setItem('wamp_replay_opt_out','1');localStorage.setItem('wamp.devicePerformanceMode.v1',JSON.stringify({version:1,mode:'full-quality'}));});
 const page=await context.newPage();activePage=page;
 page.on('pageerror',error=>report.errors.push({name,message:error.message}));
 page.on('console',message=>{if(message.type()==='error'&&!(base.includes('127.0.0.1')&&message.location().url.includes('/api/presence/identity-token')))report.errors.push({name,message:message.text(),url:message.location().url});});
 // The optional boundary case removes only Featured flags from the real local API reply.
 if(process.env.FEWER_FEATURED==='1')await page.route('**/api/leaderboards/rooms/discover?**',async route=>{
  if(new URL(route.request().url()).searchParams.get('sort')!=='featured')return route.continue();
  const response=await route.fetch();const body=await response.json();body.results=body.results.slice(0,7);
  await route.fulfill({response,json:body});
 });
 await page.goto(base+'/?welcome=1',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.body.dataset.appReady==='true',null,{timeout:120000});
 const entry=await page.locator('script[type="module"]').first().getAttribute('src');report.documents.push({name,entry});
 if(process.env.EXPECTED_ENTRY)assert.equal(entry,process.env.EXPECTED_ENTRY);
 await page.locator('#welcome-modal').waitFor({state:'visible'});
 const request=discovery(page);await click(page,'#btn-welcome-explore',touch);const initialResponse=await request;const first=await initialResponse.json();
 const serverDiscovery=async(sort,difficulty=null)=>{const url=new URL(initialResponse.url());url.searchParams.set('sort',sort);url.searchParams.delete('difficulty');url.searchParams.delete('includeGoalLessRooms');if(difficulty)url.searchParams.set('difficulty',difficulty);if(sort==='newest'&&!difficulty)url.searchParams.set('includeGoalLessRooms','1');const response=await fetch(url);assert.equal(response.status,200);const body=await response.json();if(process.env.FEWER_FEATURED==='1'&&sort==='featured')body.results=body.results.slice(0,7);return body;};
 await page.locator('#explore-modal').waitFor({state:'visible'});
 await page.waitForTimeout(500);
 const defaultSort=process.env.FEWER_FEATURED==='1'||first.results.filter(row=>row.featured).length<8?'popular':'featured';await loaded(page,defaultSort);
 if(defaultSort==='featured'){assert.ok(first.results.every(row=>row.featured));assert.ok(first.results.length>=8);}
 await page.screenshot({path:`${output}/${name}-default.png`});
 for(const sort of ['popular','quality','newest','featured']){
  await click(page,`[data-explore-sort="${sort}"]`,touch);await loaded(page,sort);const body=await serverDiscovery(sort);
  assert.equal(await page.locator('#explore-modal .explore-room-card').count(),body.results.length);
  const titles=await page.locator('#explore-modal .explore-room-title').allTextContents();
  assert.deepEqual(titles,body.results.map(row=>row.roomTitle?.trim()||(row.goalType?'Untitled Level':'Untitled Room')));
  if(sort==='featured')assert.ok(body.results.every(row=>row.featured));
  if(sort==='popular')for(let i=1;i<body.results.length;i++)assert.ok(body.results[i-1].recentPlayers>=body.results[i].recentPlayers);
  if(body.results.some(row=>row.quality.voteCount>0))assert.ok((await page.locator('.explore-room-quality-label').allTextContents()).some(text=>text.includes('rating')));
  const estimated=body.results.filter(row=>row.difficultySource==='measured');
  assert.equal(await page.locator('.explore-room-difficulty[data-source="measured"]').count(),estimated.length);
  for(const row of estimated)assert.ok(row.measuredPlayerCount>=3);
  await page.screenshot({path:`${output}/${name}-${sort}.png`});
 }
 await click(page,'[data-explore-difficulty="easy"]',touch);await loaded(page,'featured');const filtered=await serverDiscovery('featured','easy');
 assert.ok(filtered.results.length>0&&filtered.results.every(row=>row.consensusDifficulty==='easy'&&row.featured));
 await page.screenshot({path:`${output}/${name}-easy.png`});
 await click(page,'[data-explore-difficulty=""]',touch);await loaded(page,'featured');
 const overflow=await page.evaluate(()=>{const panel=document.querySelector('#explore-modal .history-modal-panel');return {width:document.documentElement.clientWidth,scroll:panel.scrollWidth,client:panel.clientWidth,panel:panel.getBoundingClientRect().toJSON()};});
 assert.ok(overflow.panel.left>=0&&overflow.panel.right<=overflow.width+1&&overflow.scroll<=overflow.client+1,JSON.stringify(overflow));
 const playAll=page.locator('#explore-queue-actions .explore-queue-start-btn').first();await playAll.scrollIntoViewIfNeeded();
 await click(page,'#explore-queue-actions .explore-queue-start-btn',touch);await page.locator('#room-goal-intro-modal').waitFor({state:'visible'});
 const sequence=await page.evaluate(()=>window.get_room_sequence_state());assert.equal(sequence.kind,'explore');assert.ok(sequence.count>=(process.env.FEWER_FEATURED==='1'?7:8));
 await click(page,'#btn-room-goal-intro-start',touch);await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).activeScene?.mode==='play');
 await page.screenshot({path:`${output}/${name}-queue-playing.png`});
 const next=touch?'#btn-mobile-room-sequence-next':'#btn-room-sequence-next';await click(page,next,touch);
 await page.waitForFunction(()=>window.get_room_sequence_state()?.index===1);
 const queued=await page.evaluate(()=>window.get_room_sequence_state());
 await page.waitForFunction(id=>{const state=JSON.parse(window.render_game_to_text()).activeScene;const [x,y]=id.split(',').map(Number);return state.currentRoom?.x===x&&state.currentRoom?.y===y&&state.currentCollisionReady&&(state.mode==='play'||!document.getElementById('room-goal-intro-modal').classList.contains('hidden'));},queued.currentRoomId);
 if(await page.locator('#room-goal-intro-modal').isVisible())await click(page,'#btn-room-goal-intro-start',touch);
 await page.screenshot({path:`${output}/${name}-queue-next.png`});
 report.scenarios.push({name,defaultSort,filtered:filtered.results.length,queueCount:sequence.count,passed:true});writeFileSync(output+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({name,passed:true}));await context.close();
 }
 assert.equal(report.errors.length,0,JSON.stringify(report.errors));
}catch(error){report.failure={name:activeName,message:error.message};if(activePage)await activePage.screenshot({path:output+'/failure.png'}).catch(()=>{});throw error;}
finally{writeFileSync(output+'/report.json',JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({scenarios:report.scenarios.length,errors:report.errors.length,output}));
