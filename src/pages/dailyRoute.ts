import type { PagesWorkerEnv } from './model';
import { resolveApiBaseUrl } from './shareMetadata';

export async function handleToday(request: Request, env: PagesWorkerEnv, url: URL): Promise<Response> {
  if (!['GET','HEAD'].includes(request.method)) return new Response('Method Not Allowed',{status:405,headers:{Allow:'GET, HEAD'}});
  const headers={'Cache-Control':'no-store'};
  try {
    const response=await fetch(new URL('/api/daily',resolveApiBaseUrl(env,url)),{headers:{Accept:'application/json'},signal:AbortSignal.timeout(2500)});
    if (!response.ok) throw new Error('Daily challenge unavailable.');
    const body: unknown=await response.json();
    if (!body || typeof body!=='object') throw new Error('Invalid daily response.');
    const pick='pick' in body ? body.pick : null;
    let path='/?today=1';
    if (pick && typeof pick==='object' && 'available' in pick && pick.available===true && 'playPath' in pick
      && typeof pick.playPath==='string' && /^\/r\/-?\d+\/-?\d+\?from=share&daily=\d{4}-\d{2}-\d{2}$/.test(pick.playPath)) path=pick.playPath;
    const destination=new URL(path,url.origin);
    // Public renderer/first-visit preferences retain their ordinary deep-link behavior.
    for (const name of ['renderer','welcome']) {const value=url.searchParams.get(name);if(value!==null)destination.searchParams.set(name,value);}
    return new Response(null,{status:302,headers:{...headers,Location:destination.toString()}});
  } catch {
    return new Response(request.method==='HEAD' ? null : '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Room of the Day — WAMP</title><body><h1>Room of the Day</h1><p>Today’s challenge could not load.</p><p><a href="/today">Try again</a> · <a href="/">Explore WAMP</a></p></body></html>',
      {status:503,headers:{...headers,'Content-Type':'text/html; charset=utf-8','Retry-After':'30'}});
  }
}
