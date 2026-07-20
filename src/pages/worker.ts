import worker from './workerLegacy.js';

export interface PagesWorkerEnv {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

export interface PagesWorkerHandler {
  fetch(request: Request, env: PagesWorkerEnv): Promise<Response>;
}

export default worker satisfies PagesWorkerHandler;
