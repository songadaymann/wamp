interface PagesWorkerEnv {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

declare const worker: {
  fetch(request: Request, env: PagesWorkerEnv): Promise<Response>;
};

export default worker;
