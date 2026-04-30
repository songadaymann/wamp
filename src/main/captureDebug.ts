import Phaser from 'phaser';
import type { RendererQuery } from './query';

export interface CaptureDebugOptions {
  renderer: RendererQuery;
  preserveDrawingBuffer: boolean;
  captureDebug: boolean;
}

export function getCaptureDebugInfo(
  game: Phaser.Game,
  debugOptions: CaptureDebugOptions,
  getDebugState: () => Record<string, unknown>,
): Record<string, unknown> {
  const canvas = game.canvas;
  const webglRenderer =
    game.renderer.type === Phaser.WEBGL
      ? (game.renderer as Phaser.Renderer.WebGL.WebGLRenderer)
      : null;
  const gl = webglRenderer?.gl ?? null;
  const dataUrlResult = getCanvasDataUrl(canvas);

  return {
    debugOptions: { ...debugOptions },
    renderer: {
      requested: debugOptions.renderer,
      active: getRendererLabel(game.renderer.type),
      type: game.renderer.type,
    },
    canvas: {
      width: canvas.width,
      height: canvas.height,
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
      styleWidth: canvas.style.width || null,
      styleHeight: canvas.style.height || null,
      dataUrlOk: dataUrlResult.ok,
      dataUrlLength: dataUrlResult.value?.length ?? 0,
      dataUrlPrefix: dataUrlResult.value?.slice(0, 48) ?? null,
      dataUrlError: dataUrlResult.error,
      pixelProbe: sampleCanvasPixels(canvas),
    },
    webgl: gl ? getWebglDebugInfo(gl) : null,
    activeScene: getDebugState(),
  };
}

function getRendererLabel(rendererType: number): string {
  switch (rendererType) {
    case Phaser.CANVAS:
      return 'canvas';
    case Phaser.WEBGL:
      return 'webgl';
    case Phaser.HEADLESS:
      return 'headless';
    default:
      return 'unknown';
  }
}

function getCanvasDataUrl(canvas: HTMLCanvasElement): {
  ok: boolean;
  value: string | null;
  error: string | null;
} {
  try {
    return {
      ok: true,
      value: canvas.toDataURL('image/png'),
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      value: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function sampleCanvasPixels(canvas: HTMLCanvasElement): Record<string, unknown> {
  try {
    const probeCanvas = document.createElement('canvas');
    const probeSize = 8;
    probeCanvas.width = probeSize;
    probeCanvas.height = probeSize;

    const context = probeCanvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return { ok: false, error: '2d probe context unavailable' };
    }

    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, probeSize, probeSize);
    context.drawImage(canvas, 0, 0, probeSize, probeSize);

    const imageData = context.getImageData(0, 0, probeSize, probeSize).data;
    let opaquePixels = 0;
    let visiblePixels = 0;
    let maxChannel = 0;
    const sample: number[][] = [];

    for (let index = 0; index < imageData.length; index += 4) {
      const rgba = [
        imageData[index],
        imageData[index + 1],
        imageData[index + 2],
        imageData[index + 3],
      ];

      if (sample.length < 6) {
        sample.push(rgba);
      }

      if (rgba[3] > 0) {
        opaquePixels += 1;
      }

      if (rgba[0] > 0 || rgba[1] > 0 || rgba[2] > 0) {
        visiblePixels += 1;
      }

      maxChannel = Math.max(maxChannel, rgba[0], rgba[1], rgba[2], rgba[3]);
    }

    return {
      ok: true,
      probeSize,
      opaquePixels,
      visiblePixels,
      maxChannel,
      sample,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function getWebglDebugInfo(gl: WebGLRenderingContext | WebGL2RenderingContext): Record<string, unknown> {
  const debugExt = gl.getExtension('WEBGL_debug_renderer_info');
  const contextAttributes = gl.getContextAttributes();

  return {
    isContextLost: gl.isContextLost(),
    drawingBufferWidth: gl.drawingBufferWidth,
    drawingBufferHeight: gl.drawingBufferHeight,
    contextAttributes,
    version: safeGlString(gl, gl.VERSION),
    shadingLanguageVersion: safeGlString(gl, gl.SHADING_LANGUAGE_VERSION),
    vendor: debugExt
      ? safeGlString(gl, debugExt.UNMASKED_VENDOR_WEBGL)
      : safeGlString(gl, gl.VENDOR),
    renderer: debugExt
      ? safeGlString(gl, debugExt.UNMASKED_RENDERER_WEBGL)
      : safeGlString(gl, gl.RENDERER),
    pixelProbe: sampleWebglPixels(gl),
  };
}

function sampleWebglPixels(gl: WebGLRenderingContext | WebGL2RenderingContext): Record<string, unknown> {
  try {
    const positions = [
      { label: 'topLeft', x: 0, y: gl.drawingBufferHeight - 1 },
      {
        label: 'center',
        x: Math.max(0, Math.floor(gl.drawingBufferWidth / 2)),
        y: Math.max(0, Math.floor(gl.drawingBufferHeight / 2)),
      },
      {
        label: 'bottomRight',
        x: Math.max(0, gl.drawingBufferWidth - 1),
        y: 0,
      },
    ];

    const samples = positions.map((position) => {
      const bytes = new Uint8Array(4);
      gl.readPixels(position.x, position.y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);

      return {
        ...position,
        rgba: Array.from(bytes),
      };
    });

    return {
      ok: true,
      samples,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function safeGlString(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  key: number
): string | null {
  try {
    return gl.getParameter(key) as string | null;
  } catch {
    return null;
  }
}
