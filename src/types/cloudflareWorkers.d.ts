// Import only the platform class, keeping Workers' HTMLRewriter Element out of the game DOM.
// Constructor and RPC branding come from the platform declarations, not a duplicated signature.
declare module 'cloudflare:workers' {
  export const WorkerEntrypoint: typeof import('@cloudflare/workers-types').CloudflareWorkersModule.WorkerEntrypoint;
}
