import { getApiBaseUrl } from '../../api/baseUrl';
import { formatRoomEth } from '../../mint/roomWalletCost';
import { getRoomMintNetwork } from '../../mint/roomNetwork';

export interface OwnerCollectionContext { roomId: string; userId: string; expanded: boolean }
export interface CollectionPrice { priceWei: string; chainId: number; contractAddress: string; quotedAt: string }

export async function loadCollectionPrice(signal: AbortSignal): Promise<CollectionPrice> {
  const response = await fetch(`${getApiBaseUrl()}/api/collections/price`, { signal, credentials: 'omit' });
  if (!response.ok) throw new Error('Collection price unavailable.');
  const quote = await response.json() as CollectionPrice;
  if (!getRoomMintNetwork(quote.chainId) || !/^(0|[1-9][0-9]{0,77})$/.test(quote.priceWei)
    || BigInt(quote.priceWei) >= 2n ** 256n || !/^0x[0-9a-f]{40}$/i.test(quote.contractAddress)
    || !Number.isFinite(Date.parse(quote.quotedAt))) throw new Error('Invalid collection price.');
  return quote;
}

/** Selection-driven quote only. Opening the editor leaves prepare/consent to its existing explicit action. */
export class OwnerCollectionReminder {
  private context: OwnerCollectionContext | null = null;
  private key = '';
  private request: AbortController | null = null;
  private cached: { value: CollectionPrice; at: number } | null = null;
  private displayed: CollectionPrice | null = null;
  private destroyed = false;
  private readonly root: HTMLElement | null;
  private readonly text: HTMLElement | null;
  private readonly action: HTMLButtonElement | null;

  constructor(private readonly doc: Document, private readonly openEditor: () => void,
    private readonly load = loadCollectionPrice) {
    this.root = doc.getElementById('owner-collection-reminder');
    this.text = doc.getElementById('owner-collection-price');
    this.action = doc.getElementById('btn-owner-collection') as HTMLButtonElement | null;
    this.action?.addEventListener('click', this.open);
    doc.defaultView?.addEventListener('wallet-gate', this.refreshVisibility);
    doc.defaultView?.addEventListener('auth-state-changed', this.clear);
    doc.addEventListener('visibilitychange', this.refreshVisibility);
  }

  update(context: OwnerCollectionContext | null): void {
    const previous = this.context; this.context = context;
    const visible = this.root && context && !this.destroyed && !this.doc.hidden && this.doc.documentElement.dataset.wallet === 'yes';
    const key = visible ? `${context.userId}:${context.roomId}` : '';
    if (key === this.key) {
      if (key && previous?.expanded !== context?.expanded && this.displayed) this.renderPrice(this.displayed);
      return;
    }
    this.request?.abort(); this.request = null; this.key = key; this.displayed = null;
    this.root?.classList.toggle('hidden', !visible);
    if (!visible) { if (this.text) this.text.textContent = ''; return; }
    if (this.text) this.text.textContent = `Others can edit this ${context.expanded ? 'cell' : 'room'}. Loading collection price…`;
    if (this.cached && Date.now() - this.cached.at < 20_000) { this.renderPrice(this.cached.value); return; }
    const controller = new AbortController(); this.request = controller;
    const timeout = setTimeout(() => controller.abort(), 6_000);
    controller.signal.addEventListener('abort', () => clearTimeout(timeout), { once: true });
    void this.load(controller.signal).then(quote => {
      if (controller.signal.aborted || this.key !== key || this.destroyed) return;
      this.cached = { value: quote, at: Date.now() }; this.renderPrice(quote);
    }).catch(() => {
      if (this.key === key && !this.destroyed && this.text) this.text.textContent = `Others can edit this ${this.context?.expanded ? 'cell' : 'room'}. Collection price unavailable; check in the editor.`;
    }).finally(() => { clearTimeout(timeout); if (this.request === controller) this.request = null; });
  }

  destroy(): void {
    this.destroyed = true; this.clear();
    this.action?.removeEventListener('click', this.open);
    this.doc.defaultView?.removeEventListener('wallet-gate', this.refreshVisibility);
    this.doc.defaultView?.removeEventListener('auth-state-changed', this.clear);
    this.doc.removeEventListener('visibilitychange', this.refreshVisibility);
  }
  private readonly refreshVisibility = () => { this.update(this.context); };
  private readonly clear = () => { this.update(null); this.cached = null; };
  private readonly open = () => {
    if (this.key && this.context && !this.destroyed && !this.doc.hidden && this.doc.documentElement.dataset.wallet === 'yes') this.openEditor();
  };
  private renderPrice(quote: CollectionPrice): void {
    this.displayed = quote;
    const network = getRoomMintNetwork(quote.chainId);
    if (this.text && network && this.context) this.text.textContent = `Others can edit this ${this.context.expanded ? 'cell' : 'room'}. Collect & Lock: ${formatRoomEth(BigInt(quote.priceWei))} ETH on ${network.name} + network fees${this.context.expanded ? ' per cell' : ''}. Price confirmed in the editor.`;
  }
}
