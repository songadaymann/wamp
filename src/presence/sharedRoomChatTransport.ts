interface SharedRoomChatListener {
  onMessage(message: string): void;
  onChanged(): void;
}

/** Chat leases the presence connection; the owner controls reconnects and hidden-tab pause. */
export class SharedRoomChatTransport {
  private readonly capabilities = new Map<string, boolean>();
  private readonly listeners = new Set<SharedRoomChatListener>();
  private lastSignature = '';

  constructor(private readonly options: {
    getSubscribedShards(): string[];
    isConnected(shardId: string): boolean;
    send(shardId: string, message: string): boolean;
  }) {}

  status(shardId: string): 'pending' | 'shared' | 'legacy' {
    if (!this.options.isConnected(shardId)) return 'pending';
    const capable = this.capabilities.get(shardId);
    return capable === undefined ? 'pending' : capable ? 'shared' : 'legacy';
  }

  negotiate(shardId: string, capable: boolean): void {
    this.capabilities.set(shardId, capable);
    this.notify();
  }

  forget(shardId: string): void {
    this.capabilities.delete(shardId);
  }

  subscribe(listener: SharedRoomChatListener): () => void {
    this.listeners.add(listener);
    listener.onChanged();
    return () => this.listeners.delete(listener);
  }

  receive(message: string): void {
    for (const listener of this.listeners) listener.onMessage(message);
  }

  send(shardId: string, message: string): boolean {
    return this.status(shardId) === 'shared' && this.options.send(shardId, message);
  }

  notify(): void {
    const signature = this.options.getSubscribedShards().sort()
      .map((id) => `${id}:${this.status(id)}`).join('|');
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    for (const listener of this.listeners) listener.onChanged();
  }
}
