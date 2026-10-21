// Real app controls with native-API-produced display data. All writes, RPC and counters isolated.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { chromium, webkit } from 'playwright';
import { createMobileInputRoomFixtures } from './lib/mobileInputRoomFixture.mjs';
import { installMobileSignedFixture } from './lib/mobileSignedFixture.mjs';
const base=process.argv[2]||'http://127.0.0.1:4197';
const output=process.argv[3]||'output/web-game/collections';
const data=JSON.parse(readFileSync(process.argv[4]||'output/web-game/collections-service/browser-data.json'));
const recorded=JSON.parse(gunzipSync(readFileSync('scripts/fixtures/mobile-smoke-api.json.gz')));
const recordedSummary=JSON.parse(recorded.entries.find(e=>e.path==='/api/rooms/0%2C0/summary').text);
mkdirSync(output,{recursive:true});const reports=[];
for(const [device,engine,width,height,touch] of [['desktop',chromium,1280,800,false],['narrow-phone',chromium,320,568,true],['safari-phone',webkit,390,844,true],['tablet',chromium,768,1024,true]]) {
  if(process.env.COLLECTION_PROFILES&&!process.env.COLLECTION_PROFILES.split(',').includes(device))continue;
  const browser=await engine.launch({args:engine===chromium?['--mute-audio']:[]});
  try { for(const gate of ['0','1']) {
    const name=`${device}-wallet-${gate}`, errors=[],consoleErrors=[],failed=[],writes=[],requests=[];
    const context=await browser.newContext({viewport:{width,height},isMobile:touch,hasTouch:touch});
    const api=createMobileInputRoomFixtures('scripts/fixtures/mobile-smoke-api.json.gz',`${output}/${name}-api.json.gz`);
    await api.install(context);await installMobileSignedFixture(context,{roomEditor:true});
    const cors=r=>({'access-control-allow-origin':r.request().headers().origin||new URL(base).origin,'access-control-allow-credentials':'true','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'});
    const reply=(r,json,status=200)=>r.fulfill({status,json,headers:cors(r)});
    let failNext=false;
    await context.route(u=>u.pathname==='/api/leaderboards/rooms/discover',r=>reply(r,data.discovery));
    await context.route(u=>u.pathname==='/api/collections/attribution',r=>{
      requests.push('attribution');const ids=new URL(r.request().url()).searchParams.getAll('target');
      return reply(r,{results:data.attribution.results.filter(a=>ids.includes(a.targetId))});
    });
    await context.route(u=>/^\/api\/profiles\/[^/]+\/summary$/.test(u.pathname),r=>reply(r,{...data.profile,userId:decodeURIComponent(new URL(r.request().url()).pathname.split('/')[3]),displayName:'Fixture builder',isSelf:false,canEdit:false,avatarChoices:[]}));
    await context.route(u=>/^\/api\/profiles\/(?:p1|builder)(?:\/summary)?$/.test(u.pathname),r=>{
      const builder=r.request().url().includes('/builder');return reply(r,{...data.profile,userId:builder?'builder':'p1',displayName:builder?'Original builder':'Collector One',collectionAvailable:true,isSelf:false,canEdit:false,avatarChoices:[],
        publishedRooms:builder?data.builderRooms.results:[],playlists:[]});
    });
    await context.route(u=>/^\/api\/profiles\/(?:p1|builder)\/collection$/.test(u.pathname),r=>{
      requests.push('shelf');if(failNext){failNext=false;return reply(r,{error:'Isolated retry fixture'},503);}
      const u=new URL(r.request().url());if(u.pathname.includes('/builder/'))return reply(r,{results:[]});
      return reply(r,u.searchParams.has('cursor')?{results:data.shelf.results.slice(2)}:{results:data.shelf.results.slice(0,2),nextCursor:'isolated-page-2'});
    });
    await context.route(u=>/^\/api\/rooms\/[^/]+\/summary$/.test(u.pathname)&&!u.pathname.includes('/0%2C0/'),r=>{
      const id=decodeURIComponent(new URL(r.request().url()).pathname.split('/')[3]);const [x,y]=id.split(',').map(Number);
      return reply(r,{...recordedSummary,id,coordinates:{x,y},claimerUserId:'builder',claimerDisplayName:'Original builder',permissions:{canSaveDraft:false,canPublish:false,canRevert:false,canMint:false}});
    });
    await context.route(u=>/^\/api\/rooms\/[^/]+\/comments$/.test(u.pathname),r=>reply(r,{comments:[],nextCursor:null}));
    await context.route(u=>u.pathname.startsWith('/api/'),r=>{
      const u=new URL(r.request().url()),method=r.request().method();
      if(u.hostname==='mann.cool'&&u.pathname==='/api/v1/plays')return reply(r,{success:true});
      if(method==='OPTIONS')return reply(r,{},204);
      if(u.pathname==='/api/settings/me'&&method==='PUT')return r.fallback();
      if(u.pathname==='/api/runs/start'&&method==='POST') { const b=r.request().postDataJSON();return reply(r,{attemptId:'isolated-collection-play',roomId:b.roomId,roomVersion:b.roomVersion,startedAt:b.startedAt,verificationSchemaVersion:1,verificationNonce:'isolated',snapshotHash:'a'.repeat(64)}); }
      if(!['GET','HEAD'].includes(method)&&u.pathname!=='/api/rooms/snapshots/query'){writes.push(u.pathname);return reply(r,{error:'Unexpected write'},503);}
      return r.fallback();
    });
    await context.route('https://cloudflareinsights.com/cdn-cgi/rum',r=>r.fulfill({status:204,headers:cors(r)}));
    await context.addInitScript(g=>{localStorage.setItem('crypto-override',g);localStorage.setItem('wamp_welcome_modal_seen_v1','1');localStorage.setItem('wamp_replay_opt_out','1');localStorage.setItem('wamp.settings.musicVolume','0');localStorage.setItem('wamp.settings.sfxVolume','0');},gate);
    const page=await context.newPage();page.setDefaultTimeout(30_000);
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
    page.on('response',r=>{if(r.status()>=400)failed.push({path:new URL(r.url()).pathname,status:r.status()});});
    const click=async selector=>{const el=typeof selector==='string'?page.locator(selector):selector;await el.scrollIntoViewIfNeeded();if(touch)await el.tap();else await el.click();};
    try {
      const renderer=engine===webkit&&process.platform==='linux'?'canvas':'webgl';
      await page.goto(`${base}/?welcome=0&renderer=${renderer}`);await page.waitForFunction(()=>document.body.dataset.appReady==='true',null,{timeout:120000});
      await click('#btn-world-explore');await page.locator('#explore-modal .explore-room-card').first().waitFor();
      assert.match(await page.locator('#explore-modal').textContent(),/Built by/);
      if(gate==='0') {
        await page.waitForTimeout(350);assert.deepEqual(requests,[]);assert.equal(await page.locator('[data-crypto]:visible').count(),0);
        await click(page.locator('#explore-modal .explore-room-builder-name').first());
        await page.locator('#profile-modal').waitFor();assert.equal(await page.locator('#btn-profile-tab-collection').isVisible(),false);
        assert.deepEqual(requests,[]);await page.screenshot({path:`${output}/${name}-profile.png`});
      } else {
        await page.locator('#explore-modal .explore-room-copy').first().scrollIntoViewIfNeeded();
        const collector=page.locator('#explore-modal .collection-person').first();await collector.waitFor();
        assert.match(await page.locator('#explore-modal .collection-attribution').allTextContents().then(t=>t.join(' ')),/Collected by Collector One/);
        await page.screenshot({path:`${output}/${name}-attribution.png`});await click(collector);
        await page.locator('#profile-collection-list article').first().waitFor();
        assert.equal(await page.locator('#btn-profile-tab-collection').getAttribute('aria-selected'),'true');
        assert.equal(await page.locator('#profile-collection-list article').count(),2);
        await click('#btn-profile-collection-more');await page.waitForFunction(()=>document.querySelectorAll('#profile-collection-list article').length===4);
        assert.equal(await page.locator('#btn-profile-collection-more').isVisible(),false);
        assert.match(await page.locator('#profile-collection-list').textContent(),/Built by Original builder/);
        assert.match(await page.locator('#profile-collection-list').textContent(),/Cell/);
        for(const link of await page.locator('#profile-collection-list .collection-viewer').all())assert.match(await link.getAttribute('href'),/^\/minted-room.html\?chainId=8453&contract=0x/);
        assert(await page.locator('#profile-collection-panel').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
        await page.screenshot({path:`${output}/${name}-shelf.png`});
        // Gate loss must clear data and stop requests; returning requires a deliberate selection.
        await page.evaluate(()=>{document.documentElement.dataset.wallet='no';window.dispatchEvent(new CustomEvent('wallet-gate'));});
        assert.equal(await page.locator('#profile-collection-list article').count(),0);
        const before=requests.length;await page.waitForTimeout(250);assert.equal(requests.length,before);
        await page.evaluate(()=>{document.documentElement.dataset.wallet='yes';window.dispatchEvent(new CustomEvent('wallet-gate'));});
        failNext=true;await click('#btn-profile-tab-collection');await page.getByText('Could not load collection.',{exact:true}).waitFor();
        await click('#btn-profile-collection-more');await page.locator('#profile-collection-list article').first().waitFor();
        // Builder credit opens the original builder; its empty collection has no fake entries.
        await click(page.locator('#profile-collection-list .collection-person').first());
        await page.locator('#profile-display-name').filter({hasText:'Original builder'}).waitFor();
        await click('#btn-profile-tab-collection');await page.getByText('No collected rooms yet.',{exact:true}).waitFor();
        await click('#btn-profile-close');
        await click(page.locator('#explore-modal .collection-person').first());
        await page.locator('#profile-collection-list article').first().waitFor();
        await click(page.locator('#profile-collection-list article .bar-btn').first());
        await page.waitForFunction(() => document.querySelector('#profile-modal')?.classList.contains('hidden'));
        await page.waitForFunction(() => { const state=JSON.parse(window.render_game_to_text()).activeScene; return state?.mode==='play' || !document.querySelector('#room-goal-intro-modal')?.classList.contains('hidden'); });
        await page.screenshot({path:`${output}/${name}-play.png`});
      }
      assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
      const expectedFailures=gate==='1'?1:0;assert.equal(failed.length,expectedFailures,JSON.stringify(failed));
      assert(failed.every(r=>r.path==='/api/profiles/p1/collection'&&r.status===503));
      assert.equal(consoleErrors.length,expectedFailures,JSON.stringify(consoleErrors));
      reports.push({name,accepted:true,requests:requests.length,errors,writes,expectedRetryFailures:failed});
    } catch(e){await page.screenshot({path:`${output}/${name}-FAILED.png`});writeFileSync(`${output}/failure.json`,JSON.stringify({name,error:String(e),errors,consoleErrors,failed,writes,requests},null,2));throw e;}
    finally{await context.close();}
  }}finally{await browser.close();}
}
writeFileSync(`${output}/report.json`,JSON.stringify({accepted:true,cases:reports,productionWrites:0,transactions:0},null,2));console.log(`Collections browser: ${reports.length} device/gate cases passed`);
