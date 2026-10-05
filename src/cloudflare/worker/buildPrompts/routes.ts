import type { BuildPromptInput } from '../../../buildPrompts/model';
import { BUILD_PROMPT_SLUG } from '../../../buildPrompts/model';
import { loadOptionalRequestAuth,requireAuthenticatedRequestAuth,requireOptionalScope,requireAdminRequest,requireTrustedOriginForMutation } from '../auth/request';
import { HttpError,jsonResponse,parseJsonBody } from '../core/http';
import type { Env } from '../core/types';
import { loadBuildPrompts,loadCurrentBuildPrompt,submitBuildPromptEntry,withdrawBuildPromptEntry,loadAdminBuildPrompts,saveBuildPrompt,deleteBuildPrompt } from './store';
function scoped(env: Env): Env {return {...env,DB:env.DB.withSession?.('first-primary')??env.DB};}
export async function handleBuildPrompts(request: Request,url: URL,env: Env): Promise<Response> {
  env=scoped(env);
  const match=/^\/api\/build-prompts\/([a-z0-9-]+)\/entry$/.exec(url.pathname);
  if(match) {
    const auth=await requireAuthenticatedRequestAuth(env,request,'enter a weekly prompt','rooms:write');
    if(request.method==='POST') {
      const body=await parseJsonBody<{targetKey?:unknown;version?:unknown}>(request,{maxBytes:1024});
      if(typeof body?.targetKey!=='string' || body.targetKey.length>200 || !/^(room|expanded_room):.+$/.test(body.targetKey)
        || typeof body.version!=='number' || !Number.isSafeInteger(body.version) || body.version<1)throw new HttpError(400,'Choose the published level version.');
      const entry=await submitBuildPromptEntry(env,match[1],auth.user.id,body.targetKey,body.version);
      return jsonResponse(request,{entry},{headers:{'Cache-Control':'no-store'}});
    }
    if(request.method==='DELETE') {await withdrawBuildPromptEntry(env,match[1],auth.user.id);return jsonResponse(request,{ok:true});}
    throw new HttpError(405,'Method not allowed.');
  }
  if(request.method!=='GET')throw new HttpError(405,'Method not allowed.');
  const auth=await loadOptionalRequestAuth(env,request);requireOptionalScope(auth,'leaderboards:read','browse weekly prompts');
  if(url.pathname==='/api/build-prompts/current')return jsonResponse(request,{prompt:await loadCurrentBuildPrompt(env),serverTime:new Date().toISOString()},{headers:{'Cache-Control':'private, no-store'}});
  if(url.pathname!=='/api/build-prompts')throw new HttpError(404,'Prompt endpoint not found.');
  const slug=url.searchParams.get('slug')??undefined,rawOffset=url.searchParams.get('offset')??'0';
  if(slug&&!BUILD_PROMPT_SLUG.test(slug) || !/^\d{1,5}$/.test(rawOffset))throw new HttpError(400,'Invalid prompt page.');
  return jsonResponse(request,await loadBuildPrompts(env,auth?.user.id??null,slug,Number(rawOffset)),{headers:{'Cache-Control':'private, no-store'}});
}
export async function handleAdminBuildPrompts(request: Request,url: URL,env: Env): Promise<Response> {
  requireAdminRequest(env,request,'manage weekly Build Prompts');requireTrustedOriginForMutation(request);env=scoped(env);
  if(request.method==='PUT')await saveBuildPrompt(env,await parseJsonBody<BuildPromptInput>(request,{maxBytes:4096}));
  else if(request.method==='DELETE') {
    const slug=url.searchParams.get('slug');if(!slug||!BUILD_PROMPT_SLUG.test(slug))throw new HttpError(400,'Choose a prompt.');await deleteBuildPrompt(env,slug);
  } else if(request.method!=='GET')throw new HttpError(405,'Method not allowed.');
  return jsonResponse(request,{prompts:await loadAdminBuildPrompts(env)},{headers:{'Cache-Control':'no-store'}});
}
