import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './worker';
const env={ASSETS:{fetch:vi.fn(async()=>new Response('shell'))},ROOM_SHARE_API_BASE_URL:'https://api.example.test'};
afterEach(()=>vi.unstubAllGlobals());
describe('/today public destination',()=>{
  it.each(['GET','HEAD'])('resolves %s to the current exact level with no cached redirect',async method=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({pick:{available:true,playPath:'/r/-11/-5?from=share&daily=2026-10-05'}})));
    vi.stubGlobal('fetch',fetcher);
    const response=await worker.fetch(new Request('https://wamp.land/today?renderer=canvas&welcome=0',{method}),env);
    expect(response.status).toBe(302);expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Location')).toBe('https://wamp.land/r/-11/-5?from=share&daily=2026-10-05&renderer=canvas&welcome=0');
    expect(String(fetcher.mock.calls[0][0])).toBe('https://api.example.test/api/daily');
  });
  it.each([null,{available:false,playPath:'/r/0/0?from=share&daily=2026-10-05'},{available:true,playPath:'https://evil.test'}])('opens the daily view for no eligible/stale/untrusted picks',async pick=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({pick}))));
    expect((await worker.fetch(new Request('https://wamp.land/today'),env)).headers.get('Location')).toBe('https://wamp.land/?today=1');
  });
  it('shows a visible recoverable failure instead of silently opening the wrong room',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('Offline')));
    const response=await worker.fetch(new Request('https://wamp.land/today'),env);
    expect(response.status).toBe(503);expect(await response.text()).toContain('Today’s challenge could not load.');
    expect(response.headers.get('Retry-After')).toBe('30');
  });
  it('rejects mutation methods',async()=>{
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
    expect((await worker.fetch(new Request('https://wamp.land/today',{method:'POST'}),env)).status).toBe(405);expect(fetcher).not.toHaveBeenCalled();
  });
});
