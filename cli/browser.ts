/** Builds the web app if needed, serves dist/ locally and drives headless.html with Playwright. */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import type { WrapPreviewApi } from '../src/headless.ts';
import { DIST_DIR, ROOT } from './paths.ts';

const BUILD_INPUTS = ['src', 'public/vehicles', 'index.html', 'headless.html', 'vite.config.ts'];

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
};

async function newestMtime(p: string): Promise<number> {
  if (!existsSync(p)) return 0;
  const s = statSync(p);
  if (!s.isDirectory()) return s.mtimeMs;
  let newest = s.mtimeMs;
  for (const entry of await readdir(p)) newest = Math.max(newest, await newestMtime(path.join(p, entry)));
  return newest;
}

/** Rebuilds dist/ when any source is newer than the last build (or `force`). */
export async function ensureBuilt(force = false): Promise<void> {
  const marker = path.join(DIST_DIR, 'headless.html');
  if (!force && existsSync(marker)) {
    const built = statSync(marker).mtimeMs;
    const inputs = await Promise.all(BUILD_INPUTS.map((p) => newestMtime(path.join(ROOT, p))));
    if (Math.max(...inputs) <= built) return;
  }
  const { build } = await import('vite');
  await build({ root: ROOT, logLevel: 'error', configFile: path.join(ROOT, 'vite.config.ts') });
}

function serve(dir: string): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const file = path.join(dir, path.normalize(urlPath).replace(/^([/\\])+/, ''));
    if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

export interface PreviewSession {
  page: Page;
  call<K extends 'render' | 'panelGuide'>(method: K, ...args: Parameters<WrapPreviewApi[K]>): Promise<Awaited<ReturnType<WrapPreviewApi[K]>>>;
  close(): Promise<void>;
}

export async function openSession(vehicle: string, opts: { rebuild?: boolean } = {}): Promise<PreviewSession> {
  await ensureBuilt(opts.rebuild);
  const server = await serve(DIST_DIR);
  let browser: Browser | undefined;
  try {
    // SwiftShader everywhere so renders are identical across machines with or without a GPU.
    browser = await chromium.launch({
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--font-render-hinting=none'],
    });
    const page = await browser.newPage({ viewport: { width: 1024, height: 640 }, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const { port } = server.address() as AddressInfo;
    await page.goto(`http://127.0.0.1:${port}/headless.html?vehicle=${encodeURIComponent(vehicle)}`);
    await page.waitForFunction(() => 'wrapPreview' in window, undefined, { timeout: 60_000 }).catch(() => {
      throw new Error(`Preview page failed to start: ${errors.join('; ') || 'timeout'}`);
    });
    await page.evaluate(() => window.wrapPreview.ready);
    const b = browser;
    return {
      page,
      call: (method, ...args) =>
        page.evaluate(([m, a]) => (window.wrapPreview as any)[m](...a), [method, args] as const) as any,
      async close() {
        await b.close();
        server.close();
      },
    };
  } catch (err) {
    await browser?.close();
    server.close();
    throw err;
  }
}
