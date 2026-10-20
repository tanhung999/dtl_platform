import { createReadStream, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** One source per image; keep previously published public URLs working. */
export function legacyAssets(): Plugin {
  let aliases = new Map<string, string>();
  return {
    name: 'dtl-legacy-asset-urls',
    configResolved({ root }) {
      aliases = new Map([
        ...readdirSync(resolve(root, 'src/assets')).filter(name => /^icon-[a-z-]+\.png$/.test(name))
          .map(name => [name, resolve(root, 'src/assets', name)] as [string, string]),
        ['dong-tay-land-logo.png', resolve(root, 'public/logo.png')],
      ]);
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const source = aliases.get((request.url ?? '').split('?')[0].slice(1));
        if (!source || !['GET', 'HEAD'].includes(request.method ?? '')) return next();
        response.setHeader('Content-Type', 'image/png');
        response.setHeader('Cache-Control', 'no-cache');
        if (request.method === 'HEAD') return response.end();
        createReadStream(source).on('error', next).pipe(response);
      });
    },
    generateBundle() {
      for (const [fileName, source] of aliases) this.emitFile({ type: 'asset', fileName, source: readFileSync(source) });
    },
  };
}
