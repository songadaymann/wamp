import type { StoredScreenshot } from './storage';
import {
  AUTO_CAPTURE_CRON,
  MAX_MANUAL_SHOTS_PER_DAY,
  MAX_ZOOM_DELTA_PER_DAY,
  PADDING_ROOMS,
  SCREENSHOT_HEIGHT,
  SCREENSHOT_WIDTH,
} from './config';

export function buildGalleryHtml(input: {
  screenshots: StoredScreenshot[];
  publicBasePath: string;
}): string {
  const rows = input.screenshots.map((shot) => {
    const href = `${input.publicBasePath}/files/${encodeURIComponent(shot.fileName)}`;
    const uploaded = shot.uploaded ? shot.uploaded.toISOString() : '';
    return `<tr>
  <td><a href="${href}">${escapeHtml(shot.fileName)}</a></td>
  <td>${shot.size}</td>
  <td>${escapeHtml(uploaded)}</td>
  <td><a href="${href}" download="${escapeHtml(shot.fileName)}">Download</a></td>
</tr>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>WAMP map screenshots</title>
  <style>
    :root {
      --bg: #0c0b0a;
      --ink: #f3eee2;
      --muted: #9a9286;
      --line: #2a2620;
      --accent: #e8c56a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      background: radial-gradient(1200px 600px at 20% -10%, #1a1713, var(--bg));
      color: var(--ink);
      min-height: 100vh;
    }
    main {
      max-width: 960px;
      margin: 0 auto;
      padding: 48px 24px 80px;
    }
    h1 {
      font-family: "IBM Plex Serif", Georgia, serif;
      font-weight: 600;
      font-size: clamp(2rem, 4vw, 3rem);
      margin: 0 0 8px;
    }
    p { color: var(--muted); line-height: 1.5; }
    .panel {
      margin-top: 28px;
      padding: 20px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.02);
    }
    button, .button {
      appearance: none;
      border: 1px solid var(--accent);
      background: transparent;
      color: var(--ink);
      padding: 10px 16px;
      font: inherit;
      cursor: pointer;
      text-decoration: none;
      display: inline-block;
    }
    button:hover, .button:hover { background: rgba(232,197,106,0.12); }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    #status { margin-top: 12px; min-height: 1.5em; color: var(--muted); }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--line); font-size: 0.95rem; }
    th { color: var(--muted); font-weight: 500; }
    a { color: var(--accent); }
    .meta { font-size: 0.85rem; color: var(--muted); margin-top: 24px; }
    code { color: var(--ink); }
  </style>
</head>
<body>
  <main>
    <h1>WAMP map screenshots</h1>
    <p>Daily automatic captures plus manual test shots. Files are stored online in R2 and can be downloaded individually or as a ZIP.</p>

    <section class="panel">
      <h2 style="margin:0 0 12px; font-size:1.15rem;">Manual capture</h2>
      <p style="margin-top:0;">Takes a screenshot now as <code>yyyy_mm_dd_x.png</code> (x = 1…${MAX_MANUAL_SHOTS_PER_DAY}). If _${MAX_MANUAL_SHOTS_PER_DAY} already exists for today, the button does nothing.</p>
      <button id="capture" type="button">Take screenshot</button>
      <div id="status"></div>
    </section>

    <section class="panel">
      <h2 style="margin:0 0 12px; font-size:1.15rem;">Archive</h2>
      <p style="margin-top:0;">
        <a class="button" href="${input.publicBasePath}/archive.zip">Download all as ZIP</a>
      </p>
      <table>
        <thead>
          <tr><th>File</th><th>Bytes</th><th>Uploaded</th><th></th></tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="4">No screenshots yet.</td></tr>'}
        </tbody>
      </table>
    </section>

    <p class="meta">
      Tunables: padding=${PADDING_ROOMS} rooms,
      max zoom delta/day=${MAX_ZOOM_DELTA_PER_DAY},
      size=${SCREENSHOT_WIDTH}×${SCREENSHOT_HEIGHT},
      cron=<code>${AUTO_CAPTURE_CRON}</code> (10:00 UTC ≈ 6am Eastern EDT).
    </p>
  </main>
  <script>
    const button = document.getElementById('capture');
    const status = document.getElementById('status');
    button.addEventListener('click', async () => {
      button.disabled = true;
      status.textContent = 'Capturing… this can take a minute.';
      try {
        const response = await fetch('${input.publicBasePath}/api/capture', { method: 'POST' });
        const body = await response.json();
        if (!response.ok || !body.ok) {
          status.textContent = body.reason || body.error || 'Capture failed.';
        } else if (body.skipped) {
          status.textContent = body.reason || 'Skipped.';
        } else {
          status.textContent = 'Saved ' + body.fileName + ' (zoom ' + Number(body.zoom).toFixed(4) + '). Reloading…';
          setTimeout(() => location.reload(), 800);
          return;
        }
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : String(error);
      }
      button.disabled = false;
    });
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
