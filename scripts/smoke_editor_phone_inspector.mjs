import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import './lib/mutedBrowsers.mjs';
import { chromium } from 'playwright';
const base=process.argv[2]||'http://127.0.0.1:3031';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Fixtures are local only.');
const output='output/web-game/phone-inspector';mkdirSync(output,{recursive:true});
const report={scenarios:[],errors:[]};
// The palette tab each placed object is listed under (platform objects sit under Utility).
const PALETTE_TABS={floor_trigger:'interactive',door_metal:'interactive',treasure_chest:'interactive',coin_gold:'collectible',swordsman_ai:'enemy',police_patrolman:'enemy',jimothy:'npc'};const browser=await chromium.launch();
try {
 for(const [device,viewport] of [['portrait',{width:390,height:844}],['landscape',{width:844,height:390}],['narrow',{width:320,height:568}]]) {
  if(process.env.INSPECTOR_DEVICES&&!process.env.INSPECTOR_DEVICES.split(',').includes(device))continue;
  for(const expanded of [false,true]) {
   if(process.env.INSPECTOR_MODES&&!process.env.INSPECTOR_MODES.split(',').includes(expanded?'expanded':'room'))continue;
   const context=await browser.newContext({viewport,hasTouch:true,isMobile:true});const page=await context.newPage();
   page.on('pageerror',e=>report.errors.push(e.message));
   await context.addInitScript(()=>{localStorage.setItem('wamp_welcome_modal_seen_v1','1');localStorage.setItem('wamp_replay_opt_out','1');});
   await page.route('**/api/**',r=>['GET','OPTIONS'].includes(r.request().method())||new URL(r.request().url()).pathname==='/api/rooms/snapshots/query'?r.continue():r.abort());
   await page.goto(`${base}/?previewSmoke=1&renderer=webgl`);
   await page.waitForFunction(()=>typeof window.run_preview_smoke_action==='function'&&document.body.dataset.appReady==='true',null,{timeout:120000});
   await page.evaluate(expanded=>{window.__wampEarlyWorldTiles?.release('phone-inspector');return window.run_preview_smoke_action(expanded?'openSyntheticCourseEditor':'openSyntheticEditor');},expanded);
   await page.waitForFunction(()=>document.body.dataset.editorPhoneDock==='true');
   await page.evaluate(expanded=>{
    const scene=window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys[expanded?'CourseEditorScene':'EditorScene'];const slice=expanded?scene.getSelectedSlice():null;
    const runtime=slice?.runtime??scene.editRuntime;if(!expanded)scene.roomSession.maybeAutoSave=()=>{};
    const snap=runtime.exportRoomSnapshot();snap.placedObjects=[];runtime.applyRoomSnapshot(snap);
    window.__inspectorFixture={scene,runtime,origin:slice?.origin??{x:0,y:0},expanded};
   },expanded);
   const passed=[];const prefix=`${output}/${device}-${expanded?'expanded':'room'}`;
   const tap=async selector=>{console.log('tap',device,expanded,selector);await page.locator(selector).scrollIntoViewIfNeeded();await page.locator(selector).tap();await page.waitForTimeout(150);};
   const snapshot=()=>page.evaluate(()=>window.__inspectorFixture.runtime.exportRoomSnapshot());
   const get=async id=>(await snapshot()).placedObjects.find(p=>p.id===id);
   const frame=async()=>{
    await page.evaluate(()=>{const f=window.__inspectorFixture,c=f.scene.cameras.main;c.setZoom(Math.min(c.width/640,c.height/352)*.85);if(f.expanded){f.scene.inspectZoom=c.zoom;f.scene.syncCameraBounds();}c.centerOn(f.origin.x+320,f.origin.y+176);});
    await page.waitForTimeout(180);
   };
   const canvasTap=async(x,y)=>{
    await frame();const p=await page.evaluate(({x,y})=>{const f=window.__inspectorFixture,c=f.scene.cameras.main,canvas=f.scene.game.canvas,r=canvas.getBoundingClientRect();return{x:r.x+((x-c.scrollX-c.width/2)*c.zoom+c.width/2)*r.width/canvas.width,y:r.y+((y-c.scrollY-c.height/2)*c.zoom+c.height/2)*r.height/canvas.height};},{x,y});
    assert.ok(p.x>0&&p.x<viewport.width&&p.y>48&&p.y<viewport.height-54,JSON.stringify(p));
    await page.touchscreen.tap(p.x,p.y);await page.waitForTimeout(180);
   };
   const objectTap=async id=>{const p=await get(id);assert.ok(p,id);await canvasTap(p.x,p.y-3);};
   const choose=async(id,panel='stuff')=>{
    await tap(`[data-editor-dock="${panel}"]`);await page.locator('#object-search-input').fill('');
    const category=PALETTE_TABS[id];assert.ok(category,`No palette tab listed for ${id}`);await tap(`.obj-cat-tab[data-category="${category}"]`);await tap(`#object-grid [data-object-id="${id}"]`);
    if(await page.locator('#sidebar').isVisible())await tap('#btn-mobile-editor-toggle');
   };
   const place=async(id,x,y,panel='stuff')=>{await choose(id,panel);const origin=await page.evaluate(()=>window.__inspectorFixture.origin);await canvasTap(origin.x+x,origin.y+y);if(!await get(id)){await page.screenshot({path:`${prefix}-placement-failure.png`});console.log(await page.evaluate(()=>{const f=window.__inspectorFixture;return{selected:document.querySelector('#object-grid .object-item[aria-pressed="true"]')?.dataset.objectId??null,mode:document.body.dataset.editorPaletteMode,tool:document.querySelector('.tool-btn.active[data-tool]')?.dataset.tool??null,body:document.body.dataset,objects:f.runtime.exportRoomSnapshot().placedObjects,pointer:{x:f.scene.input.activePointer.x,y:f.scene.input.activePointer.y,worldX:f.scene.input.activePointer.worldX,worldY:f.scene.input.activePointer.worldY},camera:{x:f.scene.cameras.main.scrollX,y:f.scene.cameras.main.scrollY,width:f.scene.cameras.main.width,height:f.scene.cameras.main.height,zoom:f.scene.cameras.main.zoom}};}));}assert.ok(await get(id),`native placement ${id}`);};
   const open=async()=>{assert.equal(await page.locator('#editor-inspector').isVisible(),true);assert.equal(await page.locator('#sidebar').isVisible(),false);const r=await page.locator('#editor-inspector').boundingBox();assert.ok(r.x>=-1&&r.y>=48&&r.x+r.width<=viewport.width+1&&r.y+r.height<=viewport.height-53,JSON.stringify(r));const done=await page.locator('#btn-editor-inspector-done').boundingBox();assert.ok(done.height>=44);const stage=await page.locator('#game-container').boundingBox();assert.ok(stage.y+stage.height<=r.y+1,`Inspector covers canvas: ${JSON.stringify({stage,r})}`);};
   const done=async()=>{await tap('#btn-editor-inspector-done');assert.equal(await page.locator('#editor-inspector').isVisible(),false);assert.equal(await page.evaluate(()=>document.body.dataset.editorPhoneLinking),'false');};
   // Plate before any target: the prompt remains cancellable after an empty tap.
   await place('floor_trigger',280,176);
   assert.equal(await page.locator('#editor-phone-link-prompt').isVisible(),true);
   await canvasTap((await get('floor_trigger')).x+100,(await get('floor_trigger')).y);
   assert.equal(await page.locator('#editor-phone-link-prompt').isVisible(),true);
   await page.screenshot({path:`${prefix}-no-target.png`});
   await tap('#btn-editor-link-cancel');await open();await done();
   await place('door_metal',440,240);if(await page.locator('#editor-phone-link-prompt').isVisible())await tap('#btn-editor-link-cancel');if(await page.locator('#editor-inspector').isVisible())await done();
   passed.push('native plate-before-target trap and touch Cancel');
   await objectTap('floor_trigger');await open();await tap('#btn-pressure-plate-connect');assert.equal(await page.locator('#editor-phone-link-prompt').isVisible(),true);await objectTap('door_metal');await open();
   const plate=await get('floor_trigger'),door=await get('door_metal');
   const courseLinks=await page.evaluate(()=>window.__inspectorFixture.expanded?window.__inspectorFixture.scene.getActiveCourseDraft().objectLinks:null);
   assert.ok(plate.triggerTargetInstanceId===door.instanceId||(courseLinks?.some(link=>link.triggerInstanceId===plate.instanceId&&link.targetInstanceId===door.instanceId)),JSON.stringify({plate,door,courseLinks}));
   const linked=await snapshot();await page.evaluate(snap=>window.__inspectorFixture.runtime.applyRoomSnapshot(JSON.parse(JSON.stringify(snap))),linked);assert.equal((await get('floor_trigger')).triggerTargetInstanceId,plate.triggerTargetInstanceId);await page.screenshot({path:`${prefix}-linked.png`});await tap('#btn-pressure-plate-clear');assert.equal((await get('floor_trigger')).triggerTargetInstanceId??null,null);if(expanded)assert.equal(await page.evaluate(id=>window.__inspectorFixture.scene.getActiveCourseDraft().objectLinks?.some(link=>link.triggerInstanceId===id)??false,plate.instanceId),false);await tap('#btn-pressure-plate-connect');await tap('#btn-editor-link-cancel');await open();await done();
   passed.push('existing plate link, clear, reconnect and cancel');
   await place('treasure_chest',168,176);await open();await done();await choose('coin_gold');await objectTap('treasure_chest');await open();assert.equal((await get('treasure_chest')).containedObjectId,'coin_gold');await tap('#btn-container-clear');assert.equal((await get('treasure_chest')).containedObjectId,null);await done();passed.push('native chest contents and Clear');
   await page.evaluate(async () => {
    const { registerCustomSprite } = await import('/src/customSprites/registry.ts');
    const { updateEditorState } = await import('/src/config.ts');
    registerCustomSprite({ id: 'inspector-guidance-gem', name: 'Guidance Gem', kind: 'collectible',
     size: 16, status: 'active', pixels: Array(256).fill('#00ff00'),
     createdAt: '2026-10-29T00:00:00Z', updatedAt: '2026-10-29T00:00:00Z' }, { persist: false });
    updateEditorState({ paletteMode: 'objects', activeTool: 'pencil', selectedObjectId: 'custom_sprite:inspector-guidance-gem' });
   });
   await objectTap('treasure_chest'); await open();
   assert.equal((await get('treasure_chest')).containedObjectId, null);
   assert.match(await page.locator('#editor-inspector').innerText(), /Custom sprites cannot go inside containers yet/);
   await page.screenshot({ path: `${prefix}-custom-contents-guidance.png` }); await done();
   passed.push('custom collectible selection explains built-in-only container contents');
   // F275: video-only guidance and replacement of a previous cross-cell target.
   const beforeVideo = await snapshot();
   await page.evaluate(async () => {
    const f = window.__inspectorFixture;
    const { rememberBuilderTrustTier } = await import('/src/roomVideo/access.ts');
    const { createDefaultRoomVideo } = await import('/src/roomVideo/model.ts');
    const { updateEditorState } = await import('/src/config.ts');
    rememberBuilderTrustTier('T1');
    const snap = f.runtime.exportRoomSnapshot();
    snap.placedObjects = snap.placedObjects.filter(p => p.id === 'floor_trigger');
    snap.video = { ...createDefaultRoomVideo('abcdefghijk', 16 / 9), x: 64, y: 224, width: 112, trigger: true };
    f.runtime.applyRoomSnapshot(snap);
    updateEditorState({ paletteMode: 'objects', activeTool: 'pencil', selectedObjectId: null });
   });
   await objectTap('floor_trigger'); await open(); await tap('#btn-pressure-plate-connect');
   assert.match(await page.locator('#editor-phone-link-prompt').innerText(), /(?:video anchor|anchor on the video)/i);
   const videoPoint = await page.evaluate(() => ({ x: window.__inspectorFixture.origin.x + 120,
    y: window.__inspectorFixture.origin.y + 255.5 }));
   await canvasTap(videoPoint.x, videoPoint.y); await open();
   assert.equal((await get('floor_trigger')).triggerTargetInstanceId, 'room-video');
   await page.screenshot({ path: `${prefix}-video-only.png` });
   await tap('#btn-pressure-plate-clear'); await done();
   passed.push('video-only target guidance and native link/clear');
   if (expanded) {
    await objectTap('floor_trigger'); await open(); await tap('#btn-pressure-plate-connect');
    // A document refresh can supply an old cross-cell target while connecting.
    await page.evaluate(() => {
     const f = window.__inspectorFixture;
     const source = f.scene.getSelectedSlice();
     const other = [...f.scene.roomSlices.values()].find(s => s.roomId !== source.roomId);
     window.__inspectorVideoOtherBackup = { roomId: other.roomId, snapshot: other.runtime.exportRoomSnapshot() };
     const snap = other.runtime.exportRoomSnapshot();
     snap.placedObjects = [{ id: 'door_metal', instanceId: 'video-old-target', x: 32, y: 32 }];
     other.runtime.applyRoomSnapshot(snap);
     const plate = f.runtime.exportRoomSnapshot().placedObjects.find(p => p.id === 'floor_trigger');
     const link = { triggerRoomId: source.roomId, triggerInstanceId: plate.instanceId,
      targetRoomId: other.roomId, targetInstanceId: 'video-old-target' };
     f.scene.setActiveCourseDraft({ ...f.scene.getActiveCourseDraft(), objectLinks: [link], pressurePlateLinks: [link] });
    });
    await canvasTap(videoPoint.x, videoPoint.y); await open();
    assert.equal((await get('floor_trigger')).triggerTargetInstanceId, 'room-video');
    const links = await page.evaluate(() => {
     const draft = window.__inspectorFixture.scene.getActiveCourseDraft();
     return { links: draft.objectLinks, mirror: draft.pressurePlateLinks };
    });
    assert.deepEqual(links, { links: [], mirror: [] });
    await done(); passed.push('source-cell video replaces old cross-cell link and mirror');
   }
   await page.evaluate(async snap => {
    const f = window.__inspectorFixture;
    f.runtime.applyRoomSnapshot(snap);
    if (window.__inspectorVideoOtherBackup) {
     const saved = window.__inspectorVideoOtherBackup;
     f.scene.roomSlices.get(saved.roomId).runtime.applyRoomSnapshot(saved.snapshot);
     delete window.__inspectorVideoOtherBackup;
    }
    (await import('/src/roomVideo/access.ts')).rememberBuilderTrustTier(null);
   }, beforeVideo);
   await place('swordsman_ai',376,128,'characters');await open();await page.locator('#swordsman-objective-mode-select').selectOption('collect');await page.locator('#swordsman-defeat-mode-select').selectOption('respawn');assert.equal((await get('swordsman_ai')).swordsmanObjectiveMode,'collect');assert.equal((await get('swordsman_ai')).swordsmanDefeatMode,'respawn');await done();await objectTap('swordsman_ai');await open();assert.equal(await page.locator('#swordsman-objective-mode-select').inputValue(),'collect');await page.screenshot({path:`${prefix}-swordsman.png`});await done();passed.push('Sword Hunter collect/defeat settings and reselection');
   await place('police_patrolman',488,128,'characters');await open();await page.locator('#police-behavior-mode-select').selectOption('patrol');await tap('#police-patrol-shoots-checkbox');assert.equal((await get('police_patrolman')).policeBehaviorMode,'patrol');assert.equal((await get('police_patrolman')).policePatrolShoots,true);await done();passed.push('Police patrol and shooting');
   await place('jimothy',96,128,'characters');await open();await page.locator('#npc-mode-select').selectOption('idle');await tap('#npc-pushable-checkbox');assert.equal((await get('jimothy')).npcPushable,true);await page.locator('#npc-mode-select').selectOption('wander');await tap('#npc-jump-fall-checkbox');assert.equal((await get('jimothy')).npcCanJumpFall,true);
   await tap('#npc-player-collision-checkbox');await tap('#npc-friendly-fire-checkbox');
   await page.locator('#npc-name-input').fill('Phone NPC');await page.locator('#npc-dialogue-input').fill('A puzzle awaits.');await page.locator('#npc-dialogue-input').blur();await page.locator('#npc-defeat-mode-select').selectOption('invincible');await page.locator('#npc-defeat-mode-select').blur();
   const npc=await get('jimothy');assert.equal(npc.npcName,'Phone NPC');assert.equal(npc.signText,'A puzzle awaits.');assert.equal(npc.npcDefeatMode,'invincible');assert.equal(npc.npcPlayerCollision,false);assert.equal(npc.npcFriendlyFire,false);await page.screenshot({path:`${prefix}-npc-scrolled.png`});await done();
   const saved=await snapshot();await page.evaluate(snap=>window.__inspectorFixture.runtime.applyRoomSnapshot(JSON.parse(JSON.stringify(snap))),saved);assert.deepEqual(JSON.parse(JSON.stringify((await snapshot()).placedObjects)),JSON.parse(JSON.stringify(saved.placedObjects)));await objectTap('jimothy');await open();assert.equal(await page.locator('#npc-name-input').inputValue(),'Phone NPC');await page.screenshot({path:`${prefix}-npc.png`});passed.push('NPC mode, flags, text and defeat persist in snapshot/reselection');
   await page.setViewportSize({width:1440,height:900});await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>document.body.dataset.editorPhoneInspector),'false');assert.equal(await page.locator('#editor-inspector').isVisible(),true);await page.setViewportSize(viewport);await page.waitForTimeout(300);await open();await done();await page.waitForTimeout(150);assert.equal(await page.locator('#editor-inspector').isVisible(),false);passed.push('desktop handoff and Done does not reopen from touch hover');
   if(expanded){
    await page.evaluate(()=>{const f=window.__inspectorFixture;window.__inspectorFirstRuntime=f.runtime;const second=[...f.scene.roomSlices.values()].find(s=>s.roomId!==f.scene.getSelectedSlice().roomId);f.scene.selectRoomById(second.roomId);f.runtime=second.runtime;f.origin=second.origin;const snap=f.runtime.exportRoomSnapshot();snap.placedObjects=[];f.runtime.applyRoomSnapshot(snap);});
    await place('jimothy',200,176,'characters');await open();await page.locator('#npc-name-input').fill('Second cell');await page.locator('#npc-name-input').blur();assert.equal((await get('jimothy')).npcName,'Second cell');
    assert.equal(await page.evaluate(()=>window.__inspectorFirstRuntime.exportRoomSnapshot().placedObjects.find(o=>o.id==='jimothy').npcName),'Phone NPC');
    await tap('#editor-shell-phone-bar [data-editor-history="undo"]');assert.notEqual((await get('jimothy')).npcName,'Second cell');await tap('#editor-shell-phone-bar [data-editor-history="redo"]');assert.equal((await get('jimothy')).npcName,'Second cell');await done();passed.push('second cell settings and native Undo/Redo preserve first cell');
   }else{
    await place('coin_gold',216,128);await tap('[data-editor-dock="markers"]');await tap('[data-editor-marker-action="goal"]');await tap('[data-goal-type-value="collect_race"]');assert.equal(await page.evaluate(()=>window.__inspectorFixture.runtime.getPublishValidationError()),null);passed.push('Collect Race passes publish validation with configured Sword Hunter');
   }
   report.scenarios.push({device,expanded,passed});await context.close();
  }
 }
 assert.deepEqual(report.errors,[]);report.ok=true;
} finally {writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();}
