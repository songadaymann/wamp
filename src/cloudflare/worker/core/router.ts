export type RouteAuth = 'public' | 'optional' | 'authenticated' | 'admin' | 'internal';
export type RoutePattern = string | RegExp | { prefix: string };

export interface WorkerRouteContext<TEnv, TExecutionContext> {
  request: Request;
  url: URL;
  env: TEnv;
  executionContext?: TExecutionContext;
}

export interface WorkerRoute<TEnv, TExecutionContext> {
  methods: readonly string[];
  pattern: RoutePattern;
  auth: RouteAuth;
  handler: (
    context: WorkerRouteContext<TEnv, TExecutionContext>,
    match: RegExpExecArray | null,
  ) => Promise<Response> | Response;
}

export interface WorkerRouteDispatch {
  matched: boolean;
  response: Response | null;
}

export async function dispatchWorkerRoute<TEnv, TExecutionContext>(
  routes: readonly WorkerRoute<TEnv, TExecutionContext>[],
  context: WorkerRouteContext<TEnv, TExecutionContext>,
): Promise<WorkerRouteDispatch> {
  for (const route of routes) {
    if (!route.methods.includes(context.request.method)) continue;
    const match = matchRoutePattern(route.pattern, context.url.pathname);
    if (match === undefined) continue;
    return {
      matched: true,
      response: await route.handler(context, match),
    };
  }
  return { matched: false, response: null };
}

export function matchRoutePattern(
  pattern: RoutePattern,
  pathname: string,
): RegExpExecArray | null | undefined {
  if (typeof pattern === 'string') return pattern === pathname ? null : undefined;
  if ('prefix' in pattern) return pathname.startsWith(pattern.prefix) ? null : undefined;
  return pattern.exec(pathname) ?? undefined;
}
