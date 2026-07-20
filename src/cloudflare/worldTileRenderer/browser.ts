import puppeteer, { type BrowserWorker } from '@cloudflare/puppeteer';
import type { RoomSnapshot } from '../../persistence/roomModel';
import { normalizeImmutablePagesDeploymentOrigin } from '../../worldTiles/rendererOrigin';
import {
  WORLD_TILE_RENDER_HEIGHT,
  WORLD_TILE_RENDER_OVERLAP,
  WORLD_TILE_RENDER_WIDTH,
  type ParentChildSlot,
  type WorldTileRendererVersionRow,
} from './contracts';

export interface BrowserRenderOutput {
  pngDataUrl: string;
}

interface PageLike {
  evaluate<TResult, TArgument>(
    callback: (argument: TArgument) => TResult | Promise<TResult>,
    argument: TArgument
  ): Promise<TResult>;
  goto(url: string, options?: { timeout?: number; waitUntil?: 'networkidle0' | 'networkidle2' }): Promise<unknown>;
  waitForFunction(callback: () => boolean, options?: { timeout?: number }): Promise<unknown>;
}

interface BrowserLike {
  close(): Promise<void>;
  newPage(): Promise<PageLike>;
}

interface BrowserPageResult {
  contract: string;
  height: number;
  overlap: number;
  pngDataUrl: string;
  width: number;
}

type BrowserPageRequest =
  | { kind: 'leaf'; snapshot: RoomSnapshot }
  | {
      kind: 'parent';
      children: Record<ParentChildSlot, string | null>;
    };

export class WorldTileBrowserSession {
  private page: PageLike | null = null;
  private loadedVersion: string | null = null;

  private constructor(private readonly browser: BrowserLike) {}

  static async launch(binding: BrowserWorker): Promise<WorldTileBrowserSession> {
    const browser = await puppeteer.launch(binding) as BrowserLike;
    return new WorldTileBrowserSession(browser);
  }

  async close(): Promise<void> {
    await this.browser.close();
  }

  async renderLeaf(
    renderer: WorldTileRendererVersionRow,
    snapshot: RoomSnapshot
  ): Promise<BrowserRenderOutput> {
    const result = await this.evaluate(renderer, { kind: 'leaf', snapshot });
    return { pngDataUrl: result.pngDataUrl };
  }

  async renderParent(
    renderer: WorldTileRendererVersionRow,
    children: Record<ParentChildSlot, string | null>
  ): Promise<BrowserRenderOutput> {
    const result = await this.evaluate(renderer, { kind: 'parent', children });
    return { pngDataUrl: result.pngDataUrl };
  }

  private async evaluate(
    renderer: WorldTileRendererVersionRow,
    request: BrowserPageRequest
  ): Promise<BrowserPageResult> {
    const page = await this.loadPage(renderer);
    const result = await page.evaluate(async (input): Promise<BrowserPageResult> => {
      const worldTileWindow = window as Window & {
        __WORLD_TILE_RENDERER__?: {
          contract: string;
          renderLeaf(snapshot: RoomSnapshot): Promise<BrowserPageResult>;
          renderParent(children: Record<ParentChildSlot, string | null>): Promise<BrowserPageResult>;
        };
      };
      const contract = worldTileWindow.__WORLD_TILE_RENDERER__;
      if (!contract) {
        throw new Error('World tile render page contract was not installed.');
      }
      return input.kind === 'leaf'
        ? contract.renderLeaf(input.snapshot)
        : contract.renderParent(input.children);
    }, request);
    assertBrowserResult(result, renderer.renderer_contract_hash);
    return result;
  }

  private async loadPage(renderer: WorldTileRendererVersionRow): Promise<PageLike> {
    if (!this.page) {
      this.page = await this.browser.newPage();
    }
    if (this.loadedVersion === renderer.version) {
      return this.page;
    }

    const renderUrl = buildImmutableRendererUrl(renderer.render_origin);
    await this.page.goto(renderUrl, { timeout: 30_000, waitUntil: 'networkidle0' });
    await this.page.waitForFunction(
      () => (window as Window & { __WORLD_TILE_RENDERER_READY__?: boolean }).__WORLD_TILE_RENDERER_READY__ === true,
      { timeout: 30_000 }
    );
    this.loadedVersion = renderer.version;
    return this.page;
  }
}

export function buildImmutableRendererUrl(origin: string): string {
  const normalizedOrigin = normalizeImmutablePagesDeploymentOrigin(origin);
  if (!normalizedOrigin) {
    throw new Error('Renderer origin must use an immutable Pages deployment hostname.');
  }
  const url = new URL(normalizedOrigin);
  url.pathname = `${url.pathname.replace(/\/?$/, '/') }world-tile-render.html`;
  return url.toString();
}

function assertBrowserResult(result: BrowserPageResult, expectedContract: string): void {
  if (!result || typeof result !== 'object') {
    throw new Error('Browser renderer returned no result.');
  }
  if (result.contract !== expectedContract) {
    throw new Error(
      `Renderer contract mismatch: expected ${expectedContract}, received ${String(result.contract)}.`
    );
  }
  if (
    result.width !== WORLD_TILE_RENDER_WIDTH
    || result.height !== WORLD_TILE_RENDER_HEIGHT
    || result.overlap !== WORLD_TILE_RENDER_OVERLAP
  ) {
    throw new Error(
      `Renderer returned ${result.width}x${result.height}+${result.overlap}; expected `
      + `${WORLD_TILE_RENDER_WIDTH}x${WORLD_TILE_RENDER_HEIGHT}+${WORLD_TILE_RENDER_OVERLAP}.`
    );
  }
  if (!result.pngDataUrl.startsWith('data:image/png;base64,')) {
    throw new Error('Browser renderer did not return a base64 PNG.');
  }
}
