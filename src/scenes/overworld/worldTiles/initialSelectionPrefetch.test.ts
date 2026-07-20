import { describe, expect, it } from 'vitest';
import { InitialSelectionPrefetchGate } from './initialSelectionPrefetch';

describe('InitialSelectionPrefetchGate', () => {
  it('defers the implicit startup selection until target-LOD coverage is ready', () => {
    const gate = new InitialSelectionPrefetchGate('0,0');

    expect(gate.shouldPrefetch('0,0', false)).toBe(false);
    expect(gate.shouldPrefetch('0,0', true)).toBe(true);
    gate.markPrefetched('0,0');
    expect(gate.shouldPrefetch('0,0', true)).toBe(false);
  });

  it('allows a changed selection immediately and retains intent until scheduling succeeds', () => {
    const gate = new InitialSelectionPrefetchGate('0,0');

    expect(gate.shouldPrefetch('3,-2', false)).toBe(true);
    expect(gate.shouldPrefetch('3,-2', false)).toBe(true);
    gate.markPrefetched('3,-2');
    expect(gate.shouldPrefetch('3,-2', false)).toBe(false);
  });

  it('lets an explicit same-room hover or selection bypass startup deferral', () => {
    const gate = new InitialSelectionPrefetchGate('0,0');

    gate.markUserIntent('0,0');
    expect(gate.shouldPrefetch('0,0', false)).toBe(true);
  });

  it('resets lifecycle state and can retry after a cutover pause', () => {
    const gate = new InitialSelectionPrefetchGate('0,0');
    gate.markPrefetched('0,0');
    gate.clearPrefetched();
    expect(gate.shouldPrefetch('0,0', true)).toBe(true);

    gate.reset('4,5');
    expect(gate.shouldPrefetch('4,5', false)).toBe(false);
  });
});
