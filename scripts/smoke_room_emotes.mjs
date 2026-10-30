import { spawnSync } from "node:child_process";
import { createServer } from "vite";
import { chromium } from "playwright";
import "./lib/mutedBrowsers.mjs";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Miniflare } from "miniflare";
const output = "output/web-game/room-emotes";
mkdirSync(output, { recursive: true });
const bundled = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "deploy", "--dry-run", "--assets", "public", "--outdir", output + "/worker"], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
writeFileSync(output + "/bundle.log", (bundled.stdout ?? "") + (bundled.stderr ?? ""));
assert.equal(bundled.status, 0, "Fresh native Worker build");
const loader = await createServer({ configFile: false, server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [], entries: [] }, appType: "custom", logLevel: "error" });
const { fixture, NOW } = await loader.ssrLoadModule("/src/cloudflare/worker/activity/testDatabase.ts");
const { createPartykitIdentityToken } = await loader.ssrLoadModule("/src/presence/identityToken.ts");
const secret = "local-only-emotes-secret", f = fixture();
for (const id of ["a", "b"]) f.sqlite.prepare("INSERT INTO school_classrooms(id,slug,display_name,teacher_email,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(id, id, id, "teacher@example.test", NOW, NOW);
for (const [user, cls] of [["p1", "a"], ["p2", "a"], ["p3", "b"]]) f.sqlite.prepare("INSERT INTO school_students(id,classroom_id,user_id,username,password_hash,password_updated_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(user, cls, user, user, "unused", NOW, NOW, NOW);
for (const user of ["builder", "p1", "p2", "p3"]) f.sqlite.prepare("INSERT INTO sessions(id,user_id,token_hash,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?)").run(user, user, createHash("sha256").update(user).digest("hex"), "2099-01-01T00:00:00.000Z", NOW, NOW);
const mf = new Miniflare({ host: "127.0.0.1", port: 0, modules: [{ type: "ESModule", path: "worker.js", contents: readFileSync("output/web-game/room-emotes/worker/worker.js", "utf8") }, { type: "ESModule", path: "@react-email/render", contents: 'export const render=()=>{throw Error("Email disabled")};export const renderAsync=render;' }], compatibilityDate: "2026-03-08", durableObjects: { PRESENCE_ROOMS: { className: "PresenceDurableObject", useSQLite: true } }, d1Databases: { DB: "emote-local", JAM_DB: "emote-local" }, bindings: { PARTYKIT_IDENTITY_TOKEN_SECRET: secret, WORLDS_ENABLED: "1" }, outboundService: async () => {
  throw Error("External network disabled");
}, serviceBindings: { ASSETS: async (req) => {
  const p = "public" + decodeURIComponent(new URL(req.url).pathname);
  return existsSync(p) ? new Response(new Uint8Array(readFileSync(p))) : new Response(null, { status: 404 });
} } });
const peers = [];
let result = {}, vite, browser, page;
try {
  const db = await mf.getD1Database("DB");
  const schema = f.sqlite.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND type <> 'trigger' AND name NOT LIKE 'sqlite_%' ORDER BY type <> 'table',rowid").all();
  await db.batch(schema.map((r) => db.prepare(r.sql)));
  const tables = f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  for (const { name } of tables) for (const row of f.sqlite.prepare(`SELECT * FROM "${name}"`).all()) {
    const keys = Object.keys(row);
    await db.prepare(`INSERT INTO "${name}" (${keys.map((k) => '"' + k + '"').join(",")}) VALUES(${keys.map(() => "?").join(",")})`).bind(...keys.map((k) => row[k])).run();
  }
  const api = String(await mf.ready).replace(/\/$/, "");
  async function issue(user) {
    const r = await mf.dispatchFetch(api + "/api/presence/identity-token", { method: "POST", headers: { Origin: "http://127.0.0.1:3033", "Content-Type": "application/json", ...user ? { Cookie: `ep_session=${user}` } : {} }, body: JSON.stringify({ identity: { userId: "guest-abcd-0000-0000", displayName: "Guest abcd" }, classroomId: "b" }) });
    assert.equal(r.status, 200, await r.clone().text());
    return (await r.json()).token;
  }
  async function connect(token) {
    const r = await mf.dispatchFetch(api + "/parties/main/0%2C0?roomChat=1&identityToken=" + encodeURIComponent(token), { headers: { Upgrade: "websocket" } });
    assert.equal(r.status, 101);
    const ws = r.webSocket;
    const messages = [];
    ws.accept();
    ws.addEventListener("message", (e) => messages.push(JSON.parse(String(e.data))));
    ws.send(JSON.stringify({ type: "presence:update", presence: { roomCoordinates: { x: 0, y: 0 }, x: 50, y: 50, velocityX: 0, velocityY: 0, facing: 1, animationState: "idle", mode: "play", timestamp: Date.now() } }));
    const peer = { ws, messages };
    peers.push(peer);
    return peer;
  }
  const sleep = () => new Promise((r) => setTimeout(r, 100));
  const bubbles = (p) => p.messages.filter((m) => m.type === "room-chat:message");
  const a = await connect(await issue("p1")), same = await connect(await issue("p2")), other = await connect(await issue("p3")), pub = await connect(await issue("builder")), guest = await connect(await issue());
  await sleep();
  a.ws.send(JSON.stringify({ type: "room-chat:emote", emote: "heart", text: "injected", classroomId: "b" }));
  await sleep();
  assert.deepEqual(bubbles(same).map((m) => m.message.text), ["\u2665"]);
  assert.equal(bubbles(other).length, 0);
  assert.equal(bubbles(pub).length, 0);
  assert.equal(bubbles(guest).length, 0);
  guest.ws.send(JSON.stringify({ type: "room-chat:emote", emote: "wave" }));
  await sleep();
  assert.deepEqual(bubbles(pub).map((m) => m.message.text), ["\u{1F44B}"]);
  assert.equal(bubbles(same).length, 1);
  for (const p of [a, guest]) p.ws.send(JSON.stringify({ type: "room-chat:say", text: "forbidden" }));
  await sleep();
  assert.equal(bubbles(same).length, 1);
  assert.equal(bubbles(pub).length, 1);
  a.ws.close();
  await sleep();
  const reconnected = await connect(await issue('p1'));
  reconnected.ws.send(JSON.stringify({ type: 'room-chat:emote', emote: 'gg' }));
  await sleep();
  assert.deepEqual(bubbles(same).map(m => m.message.text), ['♥', 'GG']);
  assert.equal(bubbles(other).length, 0);
  assert.equal(bubbles(guest).length, 1);
  assert(!JSON.stringify(bubbles(same)).includes('classroomId'));
  const dated = await createPartykitIdentityToken({ userId: "builder", displayName: "Builder", avatarId: "default-player" }, "auth", secret, { roomChat: "ok", nowMs: Date.now() - 61e3 });
  const banned = await connect(dated.token);
  await sleep();
  await db.prepare("UPDATE users SET suspended_at=? WHERE id=?").bind(NOW, "builder").run();
  banned.ws.send(JSON.stringify({ type: "room-chat:emote", emote: "gg" }));
  await sleep();
  assert.equal(bubbles(guest).length, 1);
  assert.equal(bubbles(banned).length, 0);
  result = { nativeWorkerd: true, realSessionIssuance: true, classroomIsolation: true, packetSpoofIgnored: true, guestPublic: true, freeTextBlocked: true, liveSuspensionRecheck: true, reconnectScoped: true };
  console.log(result);
  writeFileSync(output + "/server.json", JSON.stringify(result, null, 2));
  process.env.VITE_ROOM_API_BASE_URL = api;
  process.env.VITE_PARTYKIT_HOST = api;
  process.env.VITE_ENABLE_TEST_RESET = "1";
  vite = await createServer({ cacheDir: output + "/vite-cache", server: { host: "127.0.0.1", port: 3038, strictPort: true } });
  await vite.listen();
  browser = await chromium.launch({ headless: true });
  const browserResults = [];
  for (const [profile, width, height, phone] of [["desktop", 1280, 900, false], ["phone", 390, 844, true], ["narrow-phone", 320, 568, true], ["landscape", 844, 390, true]]) for (const student of [false, true]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: phone, hasTouch: phone });
    if (student) await context.addCookies([{ name: "ep_session", value: "p1", domain: "127.0.0.1", path: "/" }]);
    await context.addInitScript(() => {
      localStorage.setItem("wamp_replay_opt_out", "1");
      localStorage.setItem("wamp_welcome_modal_seen_v1", "1");
      localStorage.setItem("crypto-override", "0");
    });
    await context.route("**/*", (route) => {
      const u = new URL(route.request().url());
      return ["127.0.0.1", "localhost"].includes(u.hostname) || ["data:", "blob:"].includes(u.protocol) ? route.continue() : route.abort();
    });
    page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:3038/r/0/0?welcome=0&renderer=webgl&previewSmoke=1");
    await page.waitForFunction(() => document.body.dataset.appReady === "true", null, { timeout: 6e4 });
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene?.runtimeContext?.mode === "play", null, { timeout: 6e4 });
    if (await page.locator("#room-goal-intro-modal").isVisible()) await page.locator("#btn-room-goal-intro-start").click();
    await page.waitForFunction(() => {
      const game = window.__EVERYBODYS_PLATFORMER_GAME__;
      const scene = game.scene.getScenes(true).find((s) => s.roomChatController);
      return scene?.roomChatController.getDebugSnapshot().snapshot?.status === "connected";
    }, null, { timeout: 6e4 });
    if (phone) {
      const b = await page.locator("#btn-world-room-chat").boundingBox();
      assert(b && b.height >= 44 && b.height <= 60 && b.width <= 180 && b.x >= 0 && b.x + b.width <= width);
      await page.locator("#btn-world-room-chat").tap();
    } else await page.keyboard.press("t");
    await page.locator("#room-chat-composer").waitFor({ state: "visible" });
    assert.equal(await page.locator("#room-chat-input").isVisible(), false);
    assert.equal(await page.locator("[data-emote]").count(), 3);
    await page.screenshot({ path: `output/web-game/room-emotes/${profile}-${student ? "student" : "guest"}-tray.png` });
    if (!phone) {
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#room-chat-composer").isVisible(), false);
      await page.keyboard.press("t");
    }
    const wave = page.getByRole("button", { name: "Wave", exact: true });
    assert.equal(await wave.isVisible(), true);
    const bounds = await wave.boundingBox();
    assert(bounds && bounds.width >= 44 && bounds.height >= 44);
    if (phone) await wave.tap();
    else {
      await wave.focus();
      await page.keyboard.press(student ? "Space" : "Enter");
    }
    await page.waitForFunction(() => {
      const s = window.__EVERYBODYS_PLATFORMER_GAME__.scene.getScenes(true).find((s2) => s2.roomChatController);
      const d = s?.roomChatController.getDebugSnapshot();
      return d?.latestMessage?.text === "\u{1F44B}" && d.activeBubbleCount > 0;
    });
    assert.equal(await page.locator("#room-chat-composer").isVisible(), false);
    await page.screenshot({ path: `output/web-game/room-emotes/${profile}-${student ? "student" : "guest"}.png` });
    assert.deepEqual(errors, []);
    browserResults.push({ profile, phone, student, tray: true, textHidden: true, realBubble: true, pageErrors: errors });
    await context.close();
  }
  console.log(browserResults);
  writeFileSync(output + "/browser.json", JSON.stringify(browserResults, null, 2));
} catch (error) {
  if (page) {
    await page.screenshot({ path: "output/web-game/room-emotes/failure.png" });
    writeFileSync("output/web-game/room-emotes/failure-state.json", await page.evaluate(() => window.render_game_to_text?.() ?? ""));
  }
  throw error;
} finally {
  await browser?.close();
  await vite?.close();
  for (const p of peers) if (p.ws.readyState === 1) p.ws.close();
  await mf.dispose();
  await loader.close();
  f.sqlite.close();
}
