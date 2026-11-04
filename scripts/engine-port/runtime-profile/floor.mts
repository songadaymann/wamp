// Platform floor: a bare WebGL canvas the same size as WAMP's, drawing N full-canvas blended quads
// per frame for 10 s in the same headless phone context as measure.mts. It shows what frame rate
// the browser and its GL backend give with almost no JavaScript.
//
//   node scripts/engine-port/runtime-profile/floor.mts [DPR=2] [THROTTLE=1] [QUADS=8] [upload]
//
// "upload" also re-uploads a 640x352 canvas texture every 5th frame. Prints one JSON line.
import { launchChromium, procDelta, procTimes } from '../lib.mts';

const dpr = Number(process.argv[2] ?? 2); const throttle = Number(process.argv[3] ?? 1); const quads = Number(process.argv[4] ?? 8);
const upload = process.argv[5] === 'upload';
const browser = await launchChromium();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await cdp.send('Performance.enable');
  await page.setContent('<html><body style="margin:0;background:#000"><canvas id=c width=390 height=540 style="width:390px;height:540px"></canvas></body></html>');
  const p0 = procTimes();
  const r = await page.evaluate(async ({ quads, upload }) => {
    const gl = document.getElementById('c').getContext('webgl', { antialias: false });
    const vs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs, 'attribute vec2 p;void main(){gl_Position=vec4(p,0,1);}'); gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(fs, 'precision mediump float;uniform sampler2D t;void main(){gl_FragColor=texture2D(t,vec2(.5))+vec4(.1);}'); gl.compileShader(fs);
    const pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr); gl.useProgram(pr);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    const data = new Float32Array(quads * 12);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    const cv = document.createElement('canvas'); cv.width = 640; cv.height = 352;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const ft = []; let prev = performance.now(); const end = prev + 10000; let f = 0;
    await new Promise((res) => {
      const tick = (now) => {
        ft.push(now - prev); prev = now; f++;
        for (let q = 0; q < quads; q++) { const x = Math.sin(f * 0.01 + q) * 0.5, s = 0.9; data.set([x - s, -s, x + s, -s, x - s, s, x - s, s, x + s, -s, x + s, s], q * 12); }
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
        if (upload && f % 5 === 0) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
        gl.clearColor(0.2, 0.3, 0.4, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        for (let q = 0; q < quads; q++) gl.drawArrays(gl.TRIANGLES, q * 6, 6);
        if (now < end) requestAnimationFrame(tick); else res();
      };
      requestAnimationFrame(tick);
    });
    ft.sort((a, b) => a - b);
    const p = (x) => ft[Math.min(ft.length - 1, Math.ceil(ft.length * x) - 1)];
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return { frames: ft.length, fps: ft.length / 10, p50: p(0.5), p95: p(0.95), p99: p(0.99), renderer: gl.getParameter(gl.RENDERER), vendor: gl.getParameter(gl.VENDOR), ext: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null };
  }, { quads, upload });
  const procMs = procDelta(p0, procTimes());
  const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  console.log(JSON.stringify({ dpr, throttle, quads, upload, ...r, TaskDuration: m.TaskDuration, ThreadTime: m.ThreadTime, ScriptDuration: m.ScriptDuration, gpuMs: procMs['gpu-process'], rendererMs: procMs.renderer }));
} finally {
  await browser.close();
}
