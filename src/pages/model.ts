export interface PagesWorkerEnv {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  ROOM_SHARE_API_BASE_URL?: string;
}

export interface PagesWorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}

export interface PagesWorkerHandler {
  fetch(
    request: Request,
    env: PagesWorkerEnv,
    context?: PagesWorkerExecutionContext,
  ): Promise<Response>;
}
