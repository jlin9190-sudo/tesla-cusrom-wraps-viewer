import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { PNG } from 'pngjs';
import { beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const BIN = path.resolve('bin/wrap-preview.mjs');
let dir: string;

async function cli(...args: string[]): Promise<{ code: number; json: any }> {
  try {
    const { stdout } = await run('node', [BIN, ...args], { maxBuffer: 1 << 26 });
    return { code: 0, json: JSON.parse(stdout) };
  } catch (err: any) {
    return { code: err.code, json: JSON.parse(err.stdout) };
  }
}

async function solidPng(name: string, size: number, rgba: [number, number, number, number]): Promise<string> {
  const png = new PNG({ width: size, height: size });
  for (let i = 0; i < size * size; i++) png.data.set(rgba, i * 4);
  const file = path.join(dir, name);
  await writeFile(file, PNG.sync.write(png));
  return file;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'wrap-preview-'));
});

describe('wrap-preview check', () => {
  it('passes a fully painted template-sized wrap and reports every panel', async () => {
    const { code, json } = await cli('check', await solidPng('Red.png', 1024, [255, 0, 0, 255]));
    expect(code).toBe(0);
    expect(json.ok).toBe(true);
    expect(json.issues).toEqual([]);
    expect(json.coverage.panels).toHaveLength(16);
    for (const p of json.coverage.panels) expect(p).toMatchObject({ coverage: 1, meanColor: '#ff0000' });
  });

  it('warns (exit 0) when panels are transparent', async () => {
    const { code, json } = await cli('check', await solidPng('Clear.png', 1024, [0, 0, 0, 0]));
    expect(code).toBe(0);
    expect(json.issues.filter((i: any) => i.code === 'panel_not_filled')).toHaveLength(16);
  });

  it('fails (exit 1) on Tesla rule violations', async () => {
    const { code, json } = await cli('check', await solidPng('Too Big!.png', 1100, [0, 0, 0, 255]));
    expect(code).toBe(1);
    expect(json.issues.map((i: any) => i.code)).toEqual(expect.arrayContaining(['file_name_chars', 'dimensions_out_of_range']));
  });

  it('returns a usage error (exit 2) for missing files', async () => {
    const { code, json } = await cli('check', path.join(dir, 'nope.png'));
    expect(code).toBe(2);
    expect(json).toMatchObject({ ok: false, kind: 'usage' });
  });
});

describe('wrap-preview render', () => {
  it(
    'renders the wrap colour onto the car body',
    async () => {
      const out = path.join(dir, 'render');
      const { code, json } = await cli('render', await solidPng('Blue.png', 1024, [0, 60, 255, 255]), '--out', out, '--views', 'left,front', '--size', '400x250');
      expect(code).toBe(0);
      expect(Object.keys(json.outputs.views)).toEqual(['left', 'front']);
      expect(existsSync(json.outputs.sheet)).toBe(true);
      expect(JSON.parse(await readFile(json.outputs.report, 'utf8')).ok).toBe(true);

      // Mid-door on the side view must be clearly blue if the wrap UVs are wired up.
      const side = PNG.sync.read(await readFile(json.outputs.views.left.file));
      let blue = 0;
      for (let y = 110; y < 170; y++) {
        for (let x = 150; x < 250; x++) {
          const i = (y * side.width + x) * 4;
          if (side.data[i + 2] > 150 && side.data[i] < 90) blue++;
        }
      }
      expect(blue / (60 * 100)).toBeGreaterThan(0.5);
    },
    180_000,
  );
});
