import { resolve } from 'node:path';
import { normalizePath, type HtmlTagDescriptor, type Plugin } from 'vite';

/** Download the gated game's static module graph without executing it early. */
export function bootModulePreloadPlugin(): Plugin {
  let root = '';
  let base = './';
  return {
    name: 'boot-module-preload',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      base = config.base;
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, context) {
        const indexId = normalizePath(resolve(root, 'index.html'));
        if (normalizePath(resolve(context.filename)) !== indexId || !context.bundle) return [];
        const bundle = context.bundle;
        const chunks = Object.values(bundle).filter(output => output.type === 'chunk');
        const entry = chunks.find(chunk => chunk.isEntry
          && chunk.facadeModuleId === indexId);
        const runtimeId = normalizePath(resolve(root, 'src/main.ts'));
        const runtime = chunks.find(chunk => Object.prototype.hasOwnProperty.call(chunk.modules, runtimeId));
        if (!entry || !runtime || !entry.dynamicImports.includes(runtime.fileName)) {
          throw new Error('Cannot identify the gated game runtime for startup module preloads.');
        }
        const visit = (name: string, files: Set<string>): void => {
          if (files.has(name)) return;
          const chunk = bundle[name];
          if (!chunk || chunk.type !== 'chunk') throw new Error(`Missing startup module: ${name}`);
          files.add(name);
          chunk.imports.forEach(dependency => visit(dependency, files));
        };
        // Vite already hints the entry's static imports at their normal priority.
        const entryFiles = new Set<string>();
        visit(entry.fileName, entryFiles);
        const runtimeFiles = new Set<string>();
        visit(runtime.fileName, runtimeFiles);
        return [...runtimeFiles].filter(name => !entryFiles.has(name)).map((name): HtmlTagDescriptor => ({
          tag: 'link',
          attrs: {
            rel: 'modulepreload',
            crossorigin: '',
            fetchpriority: 'low',
            href: `${base}${name}`,
            'data-wamp-boot-preload': '',
          },
          injectTo: 'head',
        }));
      },
    },
  };
}
