/** Downloads Tesla's official template and example wraps into public/custom-wraps (gitignored). */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import type { VehicleProfile } from '../src/core/vehicles.ts';
import { panelMapFromRgba, type PanelMap, type PanelsFile } from '../src/core/panels.ts';
import { CUSTOM_WRAPS_DIR, PUBLIC_DIR } from './paths.ts';

const REPO = 'teslamotors/custom-wraps';
const BRANCH = 'master';
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;

export interface CustomWrapsManifest {
  vehicle: string;
  template: string;
  examples: string[];
}

async function download(url: string, dest: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, new Uint8Array(await res.arrayBuffer()));
      return;
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw lastError;
}

async function listExamples(dir: string): Promise<string[]> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${dir}/example?ref=${BRANCH}`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) return [];
  const items = (await res.json()) as { name: string; type: string }[];
  return items.filter((i) => i.type === 'file' && i.name.toLowerCase().endsWith('.png')).map((i) => i.name);
}

export function templatePath(vehicle: VehicleProfile): string {
  return path.join(CUSTOM_WRAPS_DIR, vehicle.customWrapsDir, 'template.png');
}

/** Ensures the template (and, when `withExamples`, all example wraps) are cached locally. */
export async function ensureCustomWraps(vehicle: VehicleProfile, withExamples = false): Promise<CustomWrapsManifest> {
  const dir = path.join(CUSTOM_WRAPS_DIR, vehicle.customWrapsDir);
  const manifestPath = path.join(dir, 'manifest.json');
  let manifest: CustomWrapsManifest | null = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : null;
  if (!existsSync(templatePath(vehicle))) await download(`${RAW}${vehicle.customWrapsDir}/template.png`, templatePath(vehicle));
  if (withExamples && !manifest?.examples.length) {
    const examples = await listExamples(vehicle.customWrapsDir);
    for (const name of examples) {
      const dest = path.join(dir, 'example', name);
      if (!existsSync(dest)) await download(`${RAW}${vehicle.customWrapsDir}/example/${encodeURIComponent(name)}`, dest);
    }
    manifest = { vehicle: vehicle.id, template: 'template.png', examples: examples.map((n) => `example/${n}`) };
  }
  manifest ??= { vehicle: vehicle.id, template: 'template.png', examples: [] };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

export async function loadPanelsFile(vehicle: VehicleProfile): Promise<PanelsFile> {
  return JSON.parse(await readFile(path.join(PUBLIC_DIR, vehicle.panelsJsonUrl), 'utf8'));
}

export async function loadPanelMapNode(vehicle: VehicleProfile): Promise<PanelMap> {
  const file = await loadPanelsFile(vehicle);
  const png = PNG.sync.read(await readFile(path.join(PUBLIC_DIR, vehicle.panelsUrl)));
  return panelMapFromRgba(file, png.data);
}
