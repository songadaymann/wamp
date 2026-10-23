// Isolated API fixtures intercept every write; supplied backgrounds remain local test media.
// BASE points to a production build preview; PROFILE optionally selects one browser.
import assert from "node:assert/strict";
import sharp from "sharp";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import './lib/mutedBrowsers.mjs';
import { chromium, webkit } from "playwright";
import { createApiFixtures } from "./lib/apiFixtures.mjs";
import { installMobileSignedFixture } from "./lib/mobileSignedFixture.mjs";
const base = process.env.BASE ?? "http://127.0.0.1:4173",
  out = process.env.OUTPUT_DIR ?? "output/web-game/custom-backgrounds";
await fs.mkdir(out, { recursive: true });
const chosen = "59f7f031-fba7-4447-550d-4f8b96bf4000",
  selected = await fs.readFile(
    "docs/review/assets/wamp-background-choice-240px-32colors-2026-10-13.webp",
  );
const results = [];
for (const [name, engine, phone] of [
  ["chrome-desktop", chromium, false],
  ["chrome-phone", chromium, true],
  ["webkit-phone", webkit, true],
].filter(([n]) => !process.env.PROFILE || n === process.env.PROFILE)) {
  const browser = await engine.launch({
    headless: true,
    ...(engine === chromium
      ? {
          executablePath:
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          args: ["--use-angle=metal", "--mute-audio"],
        }
      : {}),
  });
  const context = await browser.newContext({
    viewport: phone
      ? { width: 390, height: 844 }
      : { width: 1440, height: 960 },
    hasTouch: phone,
    isMobile: phone,
  });
  const fixtures = createApiFixtures({
    mode: "replay",
    file: "scripts/fixtures/mobile-smoke-api.json.gz",
  });
  await fixtures.install(context);
  if (base.includes(":4194"))
    await context.routeWebSocket(/127\.0\.0\.1:4194/, (socket) =>
      socket.connectToServer(),
    );
  await installMobileSignedFixture(context, { roomEditor: true });
  await context.addInitScript(() => {
    for (const [key, value] of Object.entries({
      wamp_welcome_modal_seen_v1: "1",
      wamp_install_help_dismissed_v1: "1",
      wamp_replay_opt_out: "1",
      "wamp.settings.builderMode": "advanced",
      "wamp.settings.musicVolume": "0",
      "wamp.settings.sfxVolume": "0",
      "wamp.settings.reduceMotion": "off",
    }))
      localStorage.setItem(key, value);
  });
  const image = (id) => ({
    id,
    backgroundValue: "custom:" + id,
    filename:
      id === chosen ? "Selected animation.webp" : "Uploaded animation.webp",
    mimeType: "image/webp",
    sizeBytes: 917468,
    status: "approved",
    moderationStatus: "passed",
    moderationLabels: [],
    usageCount: 0,
    imageUrl: `${base}/api/background-images/${id}/image`,
    thumbnailUrl: `${base}/api/background-images/${id}/image?variant=thumbnail`,
    createdAt: "2026-10-16T00:00:00Z",
  });
  let uploaded = false,
    prepared,
    uploadBytes;
  await context.route(
    (url) => url.pathname === "/api/background-images",
    (route) =>
      route.fulfill({
        headers: {
          "access-control-allow-origin": base,
          "access-control-allow-credentials": "true",
        },
        json: {
          items: [
            image(chosen),
            ...(uploaded ? [image("uploaded-background")] : []),
          ],
          myUploads: [],
          uploadPolicy: {
            authenticated: true,
            configured: true,
            canUpload: true,
            trustTier: "T4",
            minTrustTier: "T2",
            autoApproveEligible: true,
            maxBytes: 8388608,
            allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
            reason: null,
          },
        },
      }),
  );
  await context.route(
    (url) => /^\/api\/background-images\/[^/]+\/image$/.test(url.pathname),
    (route) =>
      route.fulfill({
        contentType: "image/webp",
        body:
          uploadBytes && urlId(route) === "uploaded-background"
            ? uploadBytes
            : selected,
      }),
  );
  await context.route(
    (url) => url.pathname === "/api/background-images/uploads",
    (route) => {
      prepared = route.request().postDataJSON();
      return route.fulfill({
        headers: {
          "access-control-allow-origin": base,
          "access-control-allow-credentials": "true",
        },
        json: {
          id: "uploaded-background",
          uploadUrl: base + "/f094-upload",
          maxBytes: 8388608,
          allowedMimeTypes: ["image/webp"],
        },
      });
    },
  );
  await context.exposeBinding(
    "recordBackgroundUpload",
    async (_source, dataUrl) => {
      uploadBytes = Buffer.from(dataUrl.split(",")[1], "base64");
    },
  );
  await context.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      if (String(input).endsWith("/f094-upload")) {
        const file = init.body.get("file");
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        await window.recordBackgroundUpload(dataUrl);
      }
      return originalFetch(input, init);
    };
  });
  await context.route("**/f094-upload", async (route) => {
    // WebKit's protocol omits multipart file bytes. Observe the browser's actual
    // File above, and additionally verify Chromium's complete wire payload.
    if (engine === chromium) {
      const b = route.request().postDataBuffer();
      const wireFile = b.subarray(
        b.indexOf("\r\n\r\n") + 4,
        b.lastIndexOf("\r\n--"),
      );
      assert.deepEqual(wireFile, uploadBytes);
    }
    await route.fulfill({
      headers: {
        "access-control-allow-origin": base,
        "access-control-allow-credentials": "true",
      },
      json: { success: true },
    });
  });
  await context.route(
    "**/api/background-images/uploaded-background/finalize",
    (route) => {
      uploaded = true;
      return route.fulfill({
        headers: {
          "access-control-allow-origin": base,
          "access-control-allow-credentials": "true",
        },
        json: {
          item: image("uploaded-background"),
          selectedBackgroundValue: "custom:uploaded-background",
          message: "Photo ready.",
        },
      });
    },
  );
  const page = await context.newPage(),
    errors = [],
    directory = out + "/" + name;
  await fs.mkdir(directory, { recursive: true });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const click = (s) =>
    phone ? page.locator(s).tap() : page.locator(s).click();
  const show = async () => {
    if (
      phone &&
      (await page.evaluate(
        () => document.body.dataset.mobileEditorCollapsed === "true",
      ))
    )
      await click("#btn-mobile-editor-toggle");
    if (
      !(await page
        .locator('button[data-editor-room-section="background"]')
        .isVisible())
    )
      await click('[data-editor-shell-action="room"]');
    await click('button[data-editor-room-section="background"]');
  };
  const enterEditor = async () => {
    await page.waitForFunction(
      () => document.body.dataset.appReady === "true",
      null,
      { timeout: 120000 },
    );
    await click("#btn-room-goal-intro-start");
    await page.locator("#room-goal-intro-modal").waitFor({ state: "hidden" });
    await click(
      (await page.locator("#btn-world-play").isVisible())
        ? "#btn-world-play"
        : "#btn-mobile-world-stop",
    );
    await page.waitForFunction(() => document.body.dataset.appMode === "world");
    await click("#btn-world-edit");
    await page.waitForFunction(
      () => document.body.dataset.appMode === "editor",
    );
  };
  let captureCount = 0;
  const moving = async (id) => {
    const hashes = [],
      diffs = [];
    let previous;
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(180);
      const png = await page
        .locator("#game-container canvas:visible")
        .screenshot();
      if (i < 2)
        await fs.writeFile(`${directory}/motion-${captureCount}-${i}.png`, png);
      const pixels = await sharp(png).removeAlpha().raw().toBuffer();
      hashes.push(createHash("sha256").update(pixels).digest("hex"));
      if (previous && previous.length === pixels.length) {
        let changed = 0;
        for (let at = 0; at < pixels.length; at += 3)
          if (
            Math.abs(previous[at] - pixels[at]) +
              Math.abs(previous[at + 1] - pixels[at + 1]) +
              Math.abs(previous[at + 2] - pixels[at + 2]) >
            20
          )
            changed++;
        diffs.push(changed / (pixels.length / 3));
      }
      previous = pixels;
    }
    const background = JSON.parse(
      await page.evaluate(() => window.render_game_to_text()),
    ).activeScene.background;
    const min = phone && background?.includes("fit=center") ? 0.005 : 0.08;
    await fs.writeFile(
      `${directory}/motion-${captureCount}.json`,
      JSON.stringify({ hashes, diffs, background, min }, null, 2),
    );
    captureCount++;
    assert.ok(new Set(hashes).size >= 3, "Background pixels must animate");
    assert.ok(
      Math.max(...diffs) > min,
      "A substantial background area must animate",
    );
    return { id, hashes, diffs };
  };

  try {
    await page.goto(
      base + "/?x=0&y=0&renderer=" + (engine === webkit ? "canvas" : "webgl"),
      { waitUntil: "domcontentloaded" },
    );
    await enterEditor();
    await show();
    await click('[data-background-id="photo"]');
    await click(".background-photo-choice");
    await page.waitForTimeout(800);
    const editorHashes = await moving(chosen);
    await page.screenshot({ path: directory + "/editor-tiled.png" });
    const fits = [];
    for (const fit of ["stretch", "center", "tile"]) {
      await show();
      const fitButton = page.locator(`[data-background-photo-fit="${fit}"]`);
      await fitButton.scrollIntoViewIfNeeded();
      assert.ok((await fitButton.boundingBox()).height >= 44);
      const response = page.waitForResponse(
        (r) =>
          r.request().method() === "PUT" &&
          new URL(r.url()).pathname === "/api/rooms/0%2C0/draft" &&
          r
            .request()
            .postDataJSON()
            .background.includes(
              fit === "tile" ? "custom:" + chosen : "fit=" + fit,
            ),
      );
      await click(`[data-background-photo-fit="${fit}"]`);
      await response;
      assert.deepEqual(await fitButton.evaluate(button => {
        const style = getComputedStyle(button);
        return [style.color, style.backgroundColor, style.borderRadius];
      }), ['rgb(33, 28, 35)', 'rgb(255, 236, 120)', '0px']);
      fits.push(fit);
      await moving(chosen);
    }
    await show();
    await page.locator("#background-upload-input").setInputFiles({
      name: "disguised.png",
      mimeType: "image/png",
      buffer: selected,
    });
    await page
      .locator("#btn-background-upload-modal-close")
      .waitFor({ state: "visible", timeout: 90000 });
    assert.equal(prepared.contentType, "image/webp");
    assert.equal(prepared.sizeBytes, uploadBytes.length);
    assert.match(prepared.filename, /\.webp$/);
    assert.ok(uploadBytes.length < 2 * 1024 * 1024);
    assert.equal(uploadBytes.subarray(0, 4).toString(), "RIFF");
    await click("#btn-background-upload-modal-close");
    await page.waitForTimeout(500);
    const uploadedHashes = await moving("uploaded-background");
    await page.screenshot({ path: directory + "/uploaded-editor.png" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await enterEditor();
    await moving("uploaded-background");
    await click('[data-editor-shell-action="test"]');
    await page.waitForFunction(
      () => document.body.dataset.appMode === "play-world",
      null,
      { timeout: 60000 },
    );
    if (await page.locator("#btn-room-goal-intro-start").isVisible())
      await click("#btn-room-goal-intro-start");
    const playHashes = await moving("uploaded-background");
    await page.keyboard.press("Space");
    await page.screenshot({ path: directory + "/play-animation.png" });
    assert.deepEqual(errors, []);
    assert.equal(Object.keys(fixtures.report().misses).length, 0);
    const result = {
      name,
      editorHashes,
      fits,
      prepared,
      uploadSize: uploadBytes.length,
      uploadedHashes,
      playHashes,
      errors,
      fixtures: fixtures.report(),
    };
    results.push(result);
    await fs.writeFile(
      directory + "/result.json",
      JSON.stringify(result, null, 2),
    );
    console.log("PASS", name);
  } catch (error) {
    await page.screenshot({ path: directory + "/failure.png" }).catch(() => {});
    await fs.writeFile(
      directory + "/failure.json",
      JSON.stringify(
        {
          error: String(error),
          errors,
          fixtures: fixtures.report(),
          state: await page
            .evaluate(() => window.render_game_to_text?.())
            .catch(() => null),
        },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    await browser.close();
  }
}
await fs.writeFile(out + "/summary.json", JSON.stringify(results, null, 2));
function urlId(route) {
  return new URL(route.request().url()).pathname.split("/")[3];
}
