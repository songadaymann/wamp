import type { StoredScreenshot } from './storage';
import {
  AUTO_CAPTURE_CRON,
  MAX_MANUAL_SHOTS_PER_DAY,
  MAX_ZOOM_DELTA_PER_DAY,
  PADDING_ROOMS,
  SCREENSHOT_HEIGHT,
  SCREENSHOT_WIDTH,
} from './config';
import { displayMonthLabel, shiftMonthKey } from './naming';
import {
  DEFAULT_VIDEO_FPS,
  earliestAndLatestDates,
  easternDateToHtmlDate,
  MAX_VIDEO_FPS,
  MIN_VIDEO_FPS,
} from './video';

export function buildGalleryHtml(input: {
  screenshots: StoredScreenshot[];
  allFileNames: string[];
  publicBasePath: string;
  monthKey: string;
  hasPrevMonth: boolean;
  hasNextMonth: boolean;
}): string {
  const prevMonth = shiftMonthKey(input.monthKey, -1);
  const nextMonth = shiftMonthKey(input.monthKey, 1);
  const monthLabel = displayMonthLabel(input.monthKey);
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

  const prevHref = `${input.publicBasePath}/?month=${encodeURIComponent(prevMonth)}`;
  const nextHref = `${input.publicBasePath}/?month=${encodeURIComponent(nextMonth)}`;
  const monthZipHref = `${input.publicBasePath}/archive.zip?month=${encodeURIComponent(input.monthKey)}`;
  const allZipHref = `${input.publicBasePath}/archive.zip`;
  const { earliest, latest } = earliestAndLatestDates(input.allFileNames);
  const defaultStartHtml = earliest ? easternDateToHtmlDate(earliest) : '';
  const defaultEndHtml = latest ? easternDateToHtmlDate(latest) : '';
  const fileNamesJson = JSON.stringify(input.allFileNames);

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
    .button.is-disabled {
      opacity: 0.35;
      pointer-events: none;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
    }
    .month-nav {
      justify-content: space-between;
      margin-bottom: 16px;
    }
    .month-nav h2 {
      margin: 0;
      font-size: 1.15rem;
      font-weight: 600;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 140px;
    }
    .field label {
      font-size: 0.85rem;
      color: var(--muted);
    }
    .field input {
      font: inherit;
      color: var(--ink);
      background: #14110e;
      border: 1px solid var(--line);
      padding: 8px 10px;
    }
    #status, #video-status { margin-top: 12px; min-height: 1.5em; color: var(--muted); }
    #video-duration {
      margin-top: 12px;
      color: var(--ink);
      font-variant-numeric: tabular-nums;
    }
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
    <p>Daily automatic captures (<code>yyyy_mm_dd_0.png</code>) plus manual test shots (<code>_1</code>…<code>_${MAX_MANUAL_SHOTS_PER_DAY}</code>). Files are stored in R2 and can be downloaded individually or as a ZIP.</p>

    <section class="panel">
      <h2 style="margin:0 0 12px; font-size:1.15rem;">Manual capture</h2>
      <p style="margin-top:0;">Takes a screenshot now as <code>yyyy_mm_dd_x.png</code> (x = 1…${MAX_MANUAL_SHOTS_PER_DAY}). Each capture (daily or manual) advances zoom by at most <code>${MAX_ZOOM_DELTA_PER_DAY}</code> toward the ideal fit, so several manuals can catch up after a growth spurt. If _${MAX_MANUAL_SHOTS_PER_DAY} already exists for today, the button does nothing.</p>
      <button id="capture" type="button">Take screenshot</button>
      <div id="status"></div>
    </section>

    <section class="panel">
      <h2 style="margin:0 0 12px; font-size:1.15rem;">Export 4K MPEG</h2>
      <p style="margin-top:0;">Builds a ${SCREENSHOT_WIDTH}×${SCREENSHOT_HEIGHT} H.264 MP4 (MPEG-4) in your browser from screenshots in the date range. The start day contributes from its first image; the end day contributes through its last image; every screenshot in between is included. Keep this tab open while encoding.</p>
      <div class="row">
        <div class="field">
          <label for="video-start">Start date</label>
          <input id="video-start" type="date" value="${defaultStartHtml}"${earliest ? ` min="${defaultStartHtml}"` : ''}${latest ? ` max="${defaultEndHtml}"` : ''} />
        </div>
        <div class="field">
          <label for="video-end">End date</label>
          <input id="video-end" type="date" value="${defaultEndHtml}"${earliest ? ` min="${defaultStartHtml}"` : ''}${latest ? ` max="${defaultEndHtml}"` : ''} />
        </div>
        <div class="field">
          <label for="video-fps">Frame rate (fps)</label>
          <input id="video-fps" type="number" min="${MIN_VIDEO_FPS}" max="${MAX_VIDEO_FPS}" step="1" value="${DEFAULT_VIDEO_FPS}" />
        </div>
      </div>
      <div id="video-duration">Select dates to see export length.</div>
      <div class="row" style="margin-top:14px;">
        <button id="video-export" type="button"${earliest ? '' : ' disabled'}>Generate 4K MPEG</button>
      </div>
      <div id="video-status"></div>
    </section>

    <section class="panel">
      <div class="row month-nav">
        <a class="button${input.hasPrevMonth ? '' : ' is-disabled'}" href="${prevHref}"${input.hasPrevMonth ? '' : ' aria-disabled="true"'}>← Prev</a>
        <h2>${escapeHtml(monthLabel)}</h2>
        <a class="button${input.hasNextMonth ? '' : ' is-disabled'}" href="${nextHref}"${input.hasNextMonth ? '' : ' aria-disabled="true"'}>Next →</a>
      </div>
      <div class="row" style="margin-bottom:8px;">
        <a class="button" href="${monthZipHref}">Download this month (ZIP)</a>
        <a class="button" href="${allZipHref}">Download all (ZIP)</a>
      </div>
      <table>
        <thead>
          <tr><th>File</th><th>Bytes</th><th>Uploaded</th><th></th></tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="4">No screenshots for this month.</td></tr>'}
        </tbody>
      </table>
    </section>

    <p class="meta">
      Tunables: padding=${PADDING_ROOMS} rooms,
      max zoom delta/capture=${MAX_ZOOM_DELTA_PER_DAY},
      size=${SCREENSHOT_WIDTH}×${SCREENSHOT_HEIGHT},
      cron=<code>${AUTO_CAPTURE_CRON}</code> (04:00 UTC ≈ midnight Eastern EDT).
    </p>
  </main>
  <script type="module">
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
          status.textContent = (() => {
            const zoom = Number(body.zoom);
            const previous = body.previousZoom == null ? null : Number(body.previousZoom);
            const ideal = Number(body.idealZoom);
            const delta = Number(body.zoomDelta);
            const capped = body.clamped ? ' capped' : '';
            if (previous == null || !Number.isFinite(previous)) {
              return 'Saved ' + body.fileName + '. zoom ' + zoom.toFixed(4)
                + ' (first capture → ideal ' + ideal.toFixed(4) + '). Reloading…';
            }
            return 'Saved ' + body.fileName + '. zoom ' + zoom.toFixed(4)
              + ' (was ' + previous.toFixed(4)
              + ' → ideal ' + ideal.toFixed(4)
              + ', Δ ' + (delta >= 0 ? '+' : '') + delta.toFixed(4)
              + capped + '). Reloading…';
          })();
          setTimeout(() => location.reload(), 1200);
          return;
        }
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : String(error);
      }
      button.disabled = false;
    });

    const allFileNames = ${fileNamesJson};
    const startInput = document.getElementById('video-start');
    const endInput = document.getElementById('video-end');
    const fpsInput = document.getElementById('video-fps');
    const durationEl = document.getElementById('video-duration');
    const videoButton = document.getElementById('video-export');
    const videoStatus = document.getElementById('video-status');
    const publicBasePath = '${input.publicBasePath}';
    let ffmpegInstance = null;
    let ffmpegLoading = null;

    function toEasternKey(htmlDate) {
      return String(htmlDate || '').replace(/-/g, '_');
    }

    function dateKeyFromFileName(fileName) {
      const match = /^(\\d{4}_\\d{2}_\\d{2})_\\d\\.png$/.exec(fileName);
      return match ? match[1] : null;
    }

    function framesInRange(startKey, endKey) {
      if (!startKey || !endKey || startKey > endKey) return [];
      return allFileNames.filter((name) => {
        const key = dateKeyFromFileName(name);
        return key && key >= startKey && key <= endKey;
      }).sort((a, b) => a.localeCompare(b));
    }

    function formatDuration(seconds) {
      if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
      if (seconds < 60) return seconds.toFixed(seconds < 10 ? 2 : 1) + 's';
      const minutes = Math.floor(seconds / 60);
      const rem = seconds - minutes * 60;
      return minutes + 'm ' + rem.toFixed(1) + 's';
    }

    function updateDuration() {
      const startKey = toEasternKey(startInput.value);
      const endKey = toEasternKey(endInput.value);
      const fps = Number(fpsInput.value);
      const frames = framesInRange(startKey, endKey);
      const validFps = Number.isInteger(fps) && fps >= ${MIN_VIDEO_FPS} && fps <= ${MAX_VIDEO_FPS};
      if (!startKey || !endKey) {
        durationEl.textContent = 'Select dates to see export length.';
        videoButton.disabled = true;
        return;
      }
      if (startKey > endKey) {
        durationEl.textContent = 'Start date must be on or before end date.';
        videoButton.disabled = true;
        return;
      }
      if (!validFps) {
        durationEl.textContent = 'Frame rate must be an integer from ${MIN_VIDEO_FPS} to ${MAX_VIDEO_FPS}.';
        videoButton.disabled = true;
        return;
      }
      if (frames.length === 0) {
        durationEl.textContent = 'No screenshots in that date range.';
        videoButton.disabled = true;
        return;
      }
      const seconds = frames.length / fps;
      durationEl.textContent = frames.length + ' screenshot'
        + (frames.length === 1 ? '' : 's')
        + ' → ' + formatDuration(seconds)
        + ' at ' + fps + ' fps'
        + ' (${SCREENSHOT_WIDTH}×${SCREENSHOT_HEIGHT} H.264 MP4).';
      videoButton.disabled = false;
    }

    startInput.addEventListener('input', updateDuration);
    endInput.addEventListener('input', updateDuration);
    fpsInput.addEventListener('input', updateDuration);
    updateDuration();

    async function getFfmpeg() {
      if (ffmpegInstance) return ffmpegInstance;
      if (ffmpegLoading) return ffmpegLoading;
      ffmpegLoading = (async () => {
        videoStatus.textContent = 'Loading MPEG encoder…';
        const { FFmpeg } = await import('https://esm.sh/@ffmpeg/ffmpeg@0.12.15');
        const { toBlobURL } = await import('https://esm.sh/@ffmpeg/util@0.12.2');
        const ffmpeg = new FFmpeg();
        ffmpeg.on('log', ({ message }) => {
          if (message) console.log('[ffmpeg]', message);
        });
        ffmpeg.on('progress', ({ progress }) => {
          if (!Number.isFinite(progress)) return;
          videoStatus.textContent = 'Encoding… ' + Math.round(progress * 100) + '%';
        });
        const base = 'https://esm.sh/@ffmpeg/core@0.12.10/dist/esm';
        await ffmpeg.load({
          coreURL: await toBlobURL(base + '/ffmpeg-core.js', 'text/javascript'),
          wasmURL: await toBlobURL(base + '/ffmpeg-core.wasm', 'application/wasm'),
        });
        ffmpegInstance = ffmpeg;
        return ffmpeg;
      })();
      try {
        return await ffmpegLoading;
      } finally {
        ffmpegLoading = null;
      }
    }

    videoButton.addEventListener('click', async () => {
      const startDate = toEasternKey(startInput.value);
      const endDate = toEasternKey(endInput.value);
      const fps = Number(fpsInput.value);
      const frames = framesInRange(startDate, endDate);
      videoButton.disabled = true;
      videoStatus.textContent = 'Fetching ' + frames.length + ' screenshots…';
      try {
        const ffmpeg = await getFfmpeg();
        const { fetchFile } = await import('https://esm.sh/@ffmpeg/util@0.12.2');
        for (let index = 0; index < frames.length; index += 1) {
          const fileName = frames[index];
          videoStatus.textContent = 'Fetching frame ' + (index + 1) + ' / ' + frames.length + '…';
          const response = await fetch(publicBasePath + '/files/' + encodeURIComponent(fileName));
          if (!response.ok) {
            throw new Error('Failed to fetch ' + fileName + ' (HTTP ' + response.status + ').');
          }
          const framePath = 'frame_' + String(index).padStart(5, '0') + '.png';
          await ffmpeg.writeFile(framePath, await fetchFile(response));
        }
        videoStatus.textContent = 'Encoding 4K MPEG…';
        await ffmpeg.exec([
          '-framerate', String(fps),
          '-i', 'frame_%05d.png',
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-crf', '18',
          '-preset', 'ultrafast',
          '-movflags', '+faststart',
          'output.mp4',
        ]);
        const data = await ffmpeg.readFile('output.mp4');
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        const blob = new Blob([bytes], { type: 'video/mp4' });
        const fileName = 'wamp-map_' + startDate + '_to_' + endDate + '_' + fps + 'fps.mp4';
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(objectUrl);
        for (let index = 0; index < frames.length; index += 1) {
          await ffmpeg.deleteFile('frame_' + String(index).padStart(5, '0') + '.png').catch(() => {});
        }
        await ffmpeg.deleteFile('output.mp4').catch(() => {});
        videoStatus.textContent = 'Download started: ' + fileName;
      } catch (error) {
        videoStatus.textContent = error instanceof Error ? error.message : String(error);
      }
      updateDuration();
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
