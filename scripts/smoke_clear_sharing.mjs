import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:3037';
const output = process.argv[3] || 'output/web-game/clear-sharing/native';
const localApi = 'http://127.0.0.1:8788';
const fixture = process.env.SHARING_FIXTURE === '1';
const signed = process.env.SHARING_ACTOR === 'signed';
const localActor = signed ? JSON.parse(readFileSync('output/web-game/clear-sharing/local-auth.json','utf8')) : null;
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname) || fixture, 'Live asset probes require the explicit isolated API fixture.');
const devices = [['desktop',1280,800,false],['phone',390,844,true],['narrow-phone',320,568,true],['landscape',844,390,true]];
const report = { at:new Date().toISOString(),base,actor:signed?'signed-local-fixture':'guest',scenarios:[],checkpoints:[],documents:[],mutations:[],responses:[],errors:[],expectedErrors:[],abortedRequests:[] };
mkdirSync(output,{recursive:true});
const browser = await chromium.launch();
let activePage, activeName;
const pending = new WeakMap();
const click = (page,selector,touch) => touch ? page.locator(selector).tap() : page.locator(selector).click();
const snapshot = page => page.evaluate(()=>JSON.parse(window.render_game_to_text()));
async function settle(page) {
  const start=Date.now();let quietSince=start;
  while(Date.now()-start<15000) {
    if(pending.get(page)?.size)quietSince=Date.now();
    else if(Date.now()-quietSince>500)return;
    await page.waitForTimeout(50);
  }
  assert.fail('Content requests did not settle before navigation.');
}
async function goto(page,path) {
  await settle(page);await page.goto(new URL(path,base).toString(),{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.body.dataset.appReady==='true'&&!JSON.parse(window.render_game_to_text()).auth.loading,null,{timeout:120000});
}
async function showHud(page,touch) {
  if(await page.locator('#btn-mobile-world-share').isVisible())return '#btn-mobile-world-share';
  if(!await page.locator('#btn-world-share').isVisible()&&await page.locator('#btn-world-hud-toggle').isVisible())await click(page,'#btn-world-hud-toggle',touch);
  await page.locator('#btn-world-share').waitFor({state:'visible'});
  return '#btn-world-share';
}
async function hideHud(page,touch) {
  if(touch&&await page.locator('#btn-mobile-world-hud-minimize').isVisible())await click(page,'#btn-mobile-world-hud-minimize',touch);
}
async function start(page,touch,kind) {
  if(kind==='room') {
    await page.locator('#room-goal-intro-modal').waitFor({state:'visible',timeout:60000});
    await click(page,'#btn-room-goal-intro-start',touch);
  } else if(await page.locator('#room-goal-intro-modal').isVisible())await click(page,'#btn-room-goal-intro-start',touch);
  await page.waitForFunction(kind=>{
    const s=JSON.parse(window.render_game_to_text()).activeScene;
    return s.mode==='play'&&s.currentCollisionReady&&(kind==='room'?s.goalRun?.elapsedMs>0:!s.goalRun&&document.getElementById('world-goal-panel-room')?.textContent?.includes('SHARING ADVENTURE'));
  },kind,{timeout:60000});
}
async function move(page,context,touch,kind) {
  let release;
  if(!touch){await page.keyboard.down('ArrowRight');release=()=>page.keyboard.up('ArrowRight');}
  else {
    const box=await page.locator('#mobile-move-stick').boundingBox();assert.ok(box);
    const cdp=await context.newCDPSession(page),x=box.x+box.width/2,y=box.y+box.height/2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+34,y,id:1}]});
    release=async()=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();};
  }
  try {await page.waitForFunction(kind=>{
    const s=JSON.parse(window.render_game_to_text()).activeScene;
    return kind==='room'?s.goalRun?.result==='completed':window.__sharingProof.clears.some(clear=>clear.contentType!=='room');
  },kind,{timeout:25000});} finally {await release();}
}
function observe(page,name) {
  const requests=new Set();pending.set(page,requests);
  page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))requests.add(request);});
  page.on('requestfinished',request=>requests.delete(request));page.on('requestfailed',request=>{requests.delete(request);report.abortedRequests.push({name,path:new URL(request.url()).pathname,method:request.method(),reason:request.failure()?.errorText});});
  page.on('pageerror',error=>report.errors.push({name,type:'pageerror',message:error.message}));
  page.on('console',message=>{if(message.type()==='error')report.errors.push({name,type:'console',message:message.text(),url:message.location().url});});
  page.on('response',async response=>{
    if(response.request().resourceType()==='document'&&response.ok()) {
      const html=await response.text().catch(()=>null);
      if(html)report.documents.push({name,url:response.url(),entry:html.match(/src="([^"]*\/main-[^"]+\.js)"/)?.[1]||null});
    }
  });
  return page.route(url=>url.pathname.startsWith('/api/'),async route=>{
    const request=route.request(),url=new URL(request.url()),target=new URL(url.pathname+url.search,localApi);
    if(!['GET','OPTIONS'].includes(request.method()))report.mutations.push({name,path:url.pathname,method:request.method(),destination:localApi});
    const headers=new Headers(request.headers());headers.delete('host');headers.delete('content-length');headers.set('connection','close');
    if(localActor)headers.set('cookie','ep_session='+localActor.cookie);
    let response,body;
    try {response=await fetch(target,{method:request.method(),headers,body:request.postData()||undefined});body=Buffer.from(await response.arrayBuffer());}
    catch(error){report.errors.push({name,type:'transport',path:url.pathname,message:error.cause?.code||error.name});await route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:'Local fixture forwarding failed.'})});return;}
    const targetId=url.pathname.startsWith('/api/expanded-rooms/by-coordinate/')&&response.ok()?JSON.parse(body.toString()).expandedRoomId:undefined;
    report.responses.push({name,path:url.pathname,method:request.method(),status:response.status,targetId});
    const responseHeaders=Object.fromEntries(response.headers);delete responseHeaders['content-encoding'];delete responseHeaders['content-length'];
    responseHeaders['access-control-allow-origin']=new URL(base).origin;responseHeaders['access-control-allow-credentials']='true';
    await route.fulfill({status:response.status,headers:responseHeaders,body});
  });
}
async function exerciseSharing(page,touch,kind,expectedUrl,outputPrefix) {
  assert.equal(await page.locator('#run-rating-share').isVisible(),true,'Completed clear sharing is hidden');
  assert.equal(await page.locator('#run-guest-claim').isVisible(),!signed);
  if(kind==='room')await page.waitForFunction(()=>!document.getElementById('btn-run-share-download').disabled);
  else {
    assert.equal(await page.locator('#run-share-preview').isVisible(),false,'Expanded clear reused a single-cell image');
    assert.equal(await page.locator('#btn-run-share-download').isVisible(),false);
  }
  await page.locator('#btn-run-share-copy').scrollIntoViewIfNeeded();await click(page,'#btn-run-share-copy',touch);
  await page.waitForFunction(()=>document.getElementById('run-share-status').textContent==='Link copied.');
  assert.equal(await page.evaluate(()=>window.__sharingProof.clipboard.at(-1)),expectedUrl);
  await page.evaluate(()=>{window.__sharingProof.filesSupported=true;});await click(page,'#btn-run-share-native',touch);
  await page.waitForFunction(()=>document.getElementById('run-share-status').textContent==='Shared.');
  const native=await page.evaluate(()=>window.__sharingProof.native.at(-1));
  assert.equal(native.url,expectedUrl);assert.match(native.text,/I beat .* in WAMP in \d.*Can you do better\?/);
  assert.equal(native.files.length,kind==='room'?1:0);if(kind==='room')assert.ok(native.files[0].size>0);
  const before=await page.evaluate(()=>({copy:window.__sharingProof.clipboard.length,x:window.__sharingProof.x.length}));
  await page.evaluate(()=>window.__setSharingMode('cancel'));await click(page,'#btn-run-share-native',touch);
  await page.waitForFunction(()=>document.getElementById('run-share-status').textContent==='Share canceled.');
  assert.deepEqual(await page.evaluate(()=>({copy:window.__sharingProof.clipboard.length,x:window.__sharingProof.x.length})),before);
  await page.evaluate(()=>window.__setSharingMode('reject'));await click(page,'#btn-run-share-native',touch);
  await page.waitForFunction(()=>document.getElementById('run-share-status').textContent==='Link copied.');
  assert.equal(await page.evaluate(()=>window.__sharingProof.clipboard.at(-1)),expectedUrl);
  await page.evaluate(()=>{window.__sharingProof.copyFails=true;});await click(page,'#btn-run-share-copy',touch);
  await page.waitForFunction(url=>document.getElementById('run-share-status').textContent===`Copy this link: ${url}`,expectedUrl);
  await page.screenshot({path:outputPrefix+'-copy-failure.png'});
  await page.evaluate(()=>{window.__sharingProof.copyFails=false;window.__setSharingMode('missing');});await click(page,'#btn-run-share-native',touch);
  await page.waitForFunction(()=>document.getElementById('run-share-status').textContent==='Link copied.');
  await click(page,'#btn-run-share-twitter',touch);
  const intent=new URL(await page.evaluate(()=>window.__sharingProof.x.at(-1)));assert.equal(intent.searchParams.get('url'),expectedUrl);assert.equal(intent.searchParams.get('text'),native.text);
  if(kind==='room') {await click(page,'#btn-run-share-download',touch);assert.match(await page.evaluate(()=>window.__sharingProof.downloads.at(-1)),/wamp-room-neg11-neg6-v\d+-clear\.png/);}
  await page.locator('#btn-run-share-copy').scrollIntoViewIfNeeded();
  const bounds=await page.locator('#btn-run-share-copy').boundingBox(),viewport=page.viewportSize();
  assert.ok(bounds&&bounds.x>=0&&bounds.x+bounds.width<=viewport.width&&bounds.y>=0&&bounds.y+bounds.height<=viewport.height);
  await page.evaluate(()=>window.getSelection()?.removeAllRanges());
  await page.screenshot({path:outputPrefix+'-sharing.png'});
  await page.evaluate(()=>window.__setSharingMode('shared'));
  return {native,bounds,proof:await page.evaluate(()=>window.__sharingProof)};
}

try {
  for(const [name,width,height,touch] of devices) {
    if(process.env.CASE&&name!==process.env.CASE)continue;activeName=name;
    const context=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch});
    await context.addInitScript(()=>{
      localStorage.setItem('wamp_welcome_modal_seen_v1','1');localStorage.setItem('wamp_replay_opt_out','1');
      localStorage.setItem('wamp.devicePerformanceMode.v1',JSON.stringify({version:1,mode:'full-quality'}));
      window.__sharingProof={native:[],clipboard:[],x:[],downloads:[],clears:[],mode:'shared',filesSupported:false,copyFails:false};
      const share=async payload=>{
        window.__sharingProof.native.push({...payload,files:(payload.files||[]).map(file=>({name:file.name,size:file.size,type:file.type}))});
        if(window.__sharingProof.mode==='cancel')throw new DOMException('Canceled','AbortError');
        if(window.__sharingProof.mode==='reject')throw new Error('Share unavailable');
      };
      window.__setSharingMode=mode=>{window.__sharingProof.mode=mode;Object.defineProperty(navigator,'share',{configurable:true,value:mode==='missing'?undefined:share});};window.__setSharingMode('shared');
      Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>window.__sharingProof.filesSupported});
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{if(window.__sharingProof.copyFails)throw new Error('Clipboard blocked');window.__sharingProof.clipboard.push(text);}}});
      const originalExec=document.execCommand?.bind(document);document.execCommand=(command,...args)=>window.__sharingProof.copyFails&&command==='copy'?false:originalExec?.(command,...args)||false;
      window.open=url=>{const parsed=new URL(url);if(parsed.origin==='https://twitter.com'&&parsed.pathname==='/intent/tweet'){window.__sharingProof.x.push(String(url));return null;}throw new Error('Unexpected external share destination');};
      const originalClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.__sharingProof.downloads.push(this.download);return;}originalClick.call(this);};
      for(const event of ['post-run-guest-claim-request','post-run-rating-request'])addEventListener(event,e=>window.__sharingProof.clears.push(e.detail));
    });
    const page=await context.newPage();activePage=page;await observe(page,name);
    const flows=[];
    for(const [kind,path,coordinates,title] of [['room','/r/-11/-6?welcome=0&renderer=canvas',{x:-11,y:-6},'de ja vu'],['expanded','/r/-11/-5?welcome=0&renderer=canvas',{x:-11,y:-5},'Sharing Adventure']]) {
      await goto(page,path);assert.equal((await snapshot(page)).auth.authenticated,signed);
      const expectedUrl=new URL(`/r/${coordinates.x}/${coordinates.y}?from=share`,base).toString();
      await start(page,touch,kind);
      let hud;
      if(process.env.SHARING_BASELINE!=='1') {
      const control=await showHud(page,touch);await click(page,control,touch);await page.locator('#world-share-status').waitFor({state:'visible'});
      hud=await page.evaluate(()=>window.__sharingProof.native.at(-1));assert.equal(hud.url,expectedUrl);assert.ok(hud.text.toLowerCase().includes(title.toLowerCase()));
      await page.screenshot({path:`${output}/${name}-${kind}-play-share.png`});await hideHud(page,touch);
      }
      await move(page,context,touch,kind);
      const completed=(await snapshot(page)).activeScene,run=kind==='room'?completed.goalRun:await page.evaluate(()=>({...window.__sharingProof.clears.at(-1),result:'completed'}));
      assert.equal(run.result,'completed');assert.equal(await page.locator('#run-rating-modal').isVisible(),false,'Result sharing interrupted Play');
      await page.waitForFunction(({kind,signed})=>{
        const s=JSON.parse(window.render_game_to_text()).activeScene;
        if(kind==='room')return signed?s.goalRun?.submissionState==='submitted':s.goalRun?.guestProgress?.status==='saved';
        const clear=window.__sharingProof.clears.at(-1);
        return signed?Boolean(clear):(JSON.parse(localStorage.getItem('wamp_guest_run_progress_v1')||'{}').records||[]).some(record=>record.contentId===clear?.contentId&&record.guestProgress?.status==='saved');
      },{kind,signed},{timeout:30000});
      await page.locator('#reward-sting-layer').waitFor({state:'hidden',timeout:30000});
      await click(page,touch?'#btn-mobile-world-stop':'#btn-world-play',touch);
      await page.locator('#run-rating-modal').waitFor({state:'visible',timeout:60000});
      report.checkpoints.push({name,kind,result:run.result,elapsedMs:run.elapsedMs,shareVisible:await page.locator('#run-rating-share').isVisible(),claimVisible:await page.locator('#run-guest-claim').isVisible()});
      const sharing=await exerciseSharing(page,touch,kind,expectedUrl,`${output}/${name}-${kind}`);
      const clear=sharing.proof.clears.at(-1);assert.equal(clear.elapsedMs,run.elapsedMs);
      assert.deepEqual(clear.contentType==='room'?clear.roomCoordinates:clear.shareCoordinates,coordinates);
      if(kind==='expanded')assert.equal(clear.expandedRoomId,'course:f131-sharing-near');
      await click(page,signed?'#btn-run-rating-skip':'#btn-run-guest-claim-continue',touch);
      await page.locator('#run-rating-modal').waitFor({state:'hidden'});await showHud(page,touch);
      await page.evaluate(()=>window.__setSharingMode('missing'));await click(page,'#btn-world-share',touch);
      await page.waitForFunction(()=>document.getElementById('world-share-status').textContent==='Room link copied.');
      assert.equal(await page.evaluate(()=>window.__sharingProof.clipboard.at(-1)),expectedUrl);
      assert.equal(await page.locator('#auth-panel').evaluate(node=>node.classList.contains('menu-open')),false);
      await page.screenshot({path:`${output}/${name}-${kind}-browse-share.png`});
      flows.push({kind,frame:{player:completed.player,camera:completed.camera},url:expectedUrl,clear:{contentType:clear.contentType,contentId:clear.contentId,elapsedMs:clear.elapsedMs,shareCoordinates:clear.shareCoordinates,status:clear.guestProgress?.status},hud,sharing});
      console.log(JSON.stringify({name,kind,phase:'native-sharing-passed'}));
    }
    await goto(page,flows[1].url);
    await start(page,touch,'expanded');assert.deepEqual((await snapshot(page)).activeScene.selected,{x:-11,y:-5});
    assert.match(await page.locator('#world-goal-panel-room').innerText(),/SHARING ADVENTURE/);
    assert.ok(report.responses.some(response=>response.name===name&&response.path==='/api/courses/f131-sharing-near'&&response.status===200));
    await page.screenshot({path:`${output}/${name}-expanded-link-roundtrip.png`});
    await hideHud(page,touch);
    if(!signed) {
      const records=await page.evaluate(()=>JSON.parse(localStorage.getItem('wamp_guest_run_progress_v1')||'{}').records||[]);
      assert.ok(records.length>=2&&records.every(record=>record.guestProgress?.status==='saved'));
    }
    assert.equal((await snapshot(page)).graphics.status,'healthy');
    report.scenarios.push({name,passed:true,flows,expandedLinkRoundtrip:true});await settle(page);await context.close();
    writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));
  }
  const unexpected=[];
  for(const error of report.errors) {
    const exactIdentity=error.type==='console'&&error.url&&new URL(error.url).pathname==='/api/presence/identity-token'
      &&report.responses.some(response=>response.name===error.name&&response.path==='/api/presence/identity-token'&&response.status===503);
    if(exactIdentity)report.expectedErrors.push(error);else unexpected.push(error);
  }
  report.errors=unexpected;assert.equal(report.errors.length,0,JSON.stringify(report.errors));
  if(process.env.EXPECTED_ENTRY)assert.ok(report.documents.length>0&&report.documents.every(doc=>doc.entry===process.env.EXPECTED_ENTRY));
} catch(error) {
  report.failure={name:activeName,message:error.message};
  if(activePage) {
    report.failureProof=await activePage.evaluate(()=>window.__sharingProof).catch(()=>null);
    report.failureState=await activePage.evaluate(()=>{const s=JSON.parse(window.render_game_to_text());return {graphics:s.graphics.status,mode:s.activeScene.mode,currentRoom:s.activeScene.currentRoom,zoom:s.activeScene.zoom,player:s.activeScene.player,goal:s.activeScene.goalRun};}).catch(()=>null);
    await activePage.screenshot({path:`${output}/failure.png`}).catch(()=>{});
  }
  throw error;
} finally {
  writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));await browser.close();
}
console.log(JSON.stringify({scenarios:report.scenarios.length,errors:report.errors.length,expected:report.expectedErrors.length,output}));
