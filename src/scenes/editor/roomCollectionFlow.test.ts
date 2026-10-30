import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultRoomRecord } from '../../persistence/roomModel';
import { RoomCollectionFlow, type RoomCollectionFlowHost } from './roomCollectionFlow';

function fixture() {
  const minted = { ...createDefaultRoomRecord('0,1', { x: 0, y: 1 }), mintedTokenId: '42' };
  const artwork = { ...minted, mintedMetadataRoomVersion: 5 };
  const events = new EventEmitter();
  const state = { generation: 0, active: true, userId: 'buyer', wallet: '0xabc', signer: null as string | null, submitted: false, mintPending: false, canAdd: true };
  const status = { text: 'Mint confirmed', accentText: 'Minted token #42', linkLabel: 'Transaction', linkHref: 'https://explorer.invalid/mint' };
  const host: RoomCollectionFlowHost = {
    captureContext: () => { const generation = state.generation; return () => generation === state.generation; },
    isActive: () => state.active, events, getIdentity: () => ({ userId: state.userId, wallet: state.wallet, signer: state.signer }),
    watchIdentity: callback => { events.on('identity', callback); return () => { events.off('identity', callback); }; },
    mint: vi.fn(async () => minted), artwork: vi.fn(async () => artwork),
    canAddArtwork: () => state.canAdd, isArtworkSubmitted: () => state.submitted,
    getStatus: () => status, setStatus: vi.fn(),
    onStateChanged: vi.fn(),
    onArtworkPending: vi.fn(), onFailure: vi.fn(),
    isCollectionSubmitted: () => state.mintPending, isArtworkPending: () => state.submitted,
  };
  return { state, host, events, minted, artwork, status, flow: new RoomCollectionFlow(host) };
}

describe('two-stage room collection', () => {
  it('runs artwork only after a confirmed mint and returns the completed record', async () => {
    const f = fixture(), order: string[] = [];
    const locks: boolean[] = []; vi.mocked(f.host.onStateChanged!).mockImplementation(() => locks.push(f.flow.isCollecting));
    vi.mocked(f.host.mint).mockImplementation(async o => { expect(o.isCurrent?.()).toBe(true); order.push('mint'); return f.minted; });
    vi.mocked(f.host.artwork).mockImplementation(async o => { expect(o.isCurrent?.()).toBe(true); order.push('artwork'); return f.artwork; });
    expect(await f.flow.collect()).toBe(f.artwork); expect(order).toEqual(['mint', 'artwork']);
    expect(f.flow.isCollecting).toBe(false); expect(f.events.eventNames()).toEqual([]);
    expect(locks).toEqual([true, false]);
  });
  it('deduplicates a second collect click while either stage is waiting', async () => {
    const f = fixture(); let done!: () => void;
    vi.mocked(f.host.artwork).mockImplementation(() => new Promise(resolve => { done = () => resolve(f.artwork); }));
    const pending = f.flow.collect(); await vi.waitFor(() => expect(f.host.artwork).toHaveBeenCalledOnce());
    expect(f.flow.isCollecting).toBe(true); expect(await f.flow.collect()).toBeNull(); done(); await pending;
    expect(f.host.mint).toHaveBeenCalledOnce(); expect(f.host.artwork).toHaveBeenCalledOnce();
  });
  it.each(['null', 'error'])('does not ask for artwork after a failed mint (%s)', async kind => {
    const f = fixture(); if (kind === 'null') vi.mocked(f.host.mint).mockResolvedValue(null); else vi.mocked(f.host.mint).mockRejectedValue(new Error('rpc secret'));
    expect(await f.flow.collect()).toBeNull(); expect(f.host.artwork).not.toHaveBeenCalled(); expect(f.flow.isCollecting).toBe(false);
    expect(JSON.stringify(vi.mocked(f.host.setStatus).mock.calls)).not.toContain('rpc secret');
  });
  it.each(['null', 'error'])('preserves the mint and its transaction link when artwork fails (%s)', async kind => {
    const f = fixture(); if (kind === 'null') vi.mocked(f.host.artwork).mockResolvedValue(null); else vi.mocked(f.host.artwork).mockRejectedValue(new Error('declined'));
    expect(await f.flow.collect()).toBe(f.minted); expect(f.host.setStatus).toHaveBeenCalledWith(expect.objectContaining({
      accentText: 'Collected token #42', text: expect.stringContaining('already collected'), linkHref: f.status.linkHref,
    })); expect(f.host.mint).toHaveBeenCalledOnce();
    expect(f.host.onArtworkPending).toHaveBeenCalledWith(expect.objectContaining({ accentText: 'Collected token #42', text: expect.stringContaining('already collected') }), expect.any(Function));
  });
  it('describes a submitted artwork approval as awaiting confirmation, not missing', async () => {
    const f = fixture(); f.state.submitted = true; vi.mocked(f.host.artwork).mockResolvedValue(null);
    expect(await f.flow.collect()).toBe(f.minted); expect(f.host.setStatus).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('without another wallet approval') }));
  });
  it.each(['generation', 'account', 'wallet', 'inactive'] as const)('does not continue into another wallet action after %s changes', async kind => {
    const f = fixture(); vi.mocked(f.host.mint).mockImplementation(async () => {
      if (kind === 'generation') f.state.generation++;
      if (kind === 'account') f.state.userId = 'other';
      if (kind === 'wallet') f.state.wallet = '0xdef';
      if (kind === 'inactive') f.state.active = false;
      return f.minted;
    });
    await f.flow.collect(); expect(f.host.artwork).not.toHaveBeenCalled(); expect(f.host.setStatus).not.toHaveBeenCalled();
  });
  it.each(['sleep', 'shutdown', 'destroy'])('retains cancellation after %s even if the same scene becomes active again', async event => {
    const f = fixture(); vi.mocked(f.host.mint).mockImplementation(async () => { f.events.emit(event); f.state.active = true; return f.minted; });
    await f.flow.collect(); expect(f.host.artwork).not.toHaveBeenCalled(); expect(f.events.eventNames()).toEqual([]);
  });
  it('does not infer artwork rights from a confirmed mint alone', async () => {
    const f = fixture(); f.state.canAdd = false; expect(await f.flow.collect()).toBe(f.minted); expect(f.host.artwork).not.toHaveBeenCalled();
  });
  it('does not overwrite a new context with a late artwork error', async () => {
    const f = fixture(); vi.mocked(f.host.artwork).mockImplementation(async () => { f.state.generation++; throw new Error('late'); });
    expect(await f.flow.collect()).toBe(f.minted); expect(f.host.setStatus).not.toHaveBeenCalled(); expect(f.events.eventNames()).toEqual([]);
    expect(f.host.onArtworkPending).not.toHaveBeenCalled();
  });
  it('remembers an account switch away and back, cancels the second approval and unlocks the current room', async () => {
    const f = fixture(), locks: boolean[] = [];
    vi.mocked(f.host.onStateChanged!).mockImplementation(() => locks.push(f.flow.isCollecting));
    vi.mocked(f.host.mint).mockImplementation(async () => {
      f.state.userId = 'other'; f.events.emit('identity'); f.state.userId = 'buyer'; f.events.emit('identity'); return f.minted;
    });
    await f.flow.collect(); expect(f.host.artwork).not.toHaveBeenCalled(); expect(locks).toEqual([true, false]);
    expect(f.events.eventNames()).toEqual([]);
  });
  it('requires a fresh attempt after an explicit retry and rejects stale room retries', async () => {
    const f = fixture(); vi.mocked(f.host.mint).mockResolvedValue(null);
    await f.flow.collect();
    const retry = vi.mocked(f.host.onFailure!).mock.calls[0][1];
    expect(f.host.mint).toHaveBeenCalledOnce(); await retry();
    expect(f.host.mint).toHaveBeenCalledTimes(2);
    f.state.generation++; await retry(); expect(f.host.mint).toHaveBeenCalledTimes(2);
  });
  it('does not offer another approval for an unknown or submitted outcome', async () => {
    const f = fixture(); f.state.mintPending = true; vi.mocked(f.host.mint).mockResolvedValue(null);
    await f.flow.collect(); expect(f.host.onFailure).not.toHaveBeenCalled();
  });
  it('does not show a retry error after a declined cost confirmation', async () => {
    const f = fixture(); vi.mocked(f.host.mint).mockImplementation(async o => { o.onDeclined?.(); return null; });
    await f.flow.collect(); expect(f.host.onFailure).not.toHaveBeenCalled(); expect(f.host.artwork).not.toHaveBeenCalled();
  });
  it('rejects a known mismatched signer before preparation, then revalidates on explicit retry', async () => {
    const f = fixture(); f.state.signer = '0xdef'; await f.flow.collect();
    expect(f.host.mint).not.toHaveBeenCalled();
    expect(f.host.onFailure).toHaveBeenCalledOnce();
    f.state.signer = '0xabc'; await vi.mocked(f.host.onFailure!).mock.calls[0][1]();
    expect(f.host.mint).toHaveBeenCalledOnce(); expect(f.host.artwork).toHaveBeenCalledOnce();
  });
  it('preserves the collected token and retries only artwork after its known rejection', async () => {
    const f = fixture(); vi.mocked(f.host.artwork).mockResolvedValueOnce(null);
    await f.flow.collect(); await vi.mocked(f.host.onArtworkPending!).mock.calls[0][1]!();
    expect(f.host.mint).toHaveBeenCalledOnce(); expect(f.host.artwork).toHaveBeenCalledTimes(2);
  });

});
