/**
 * wrap-preview: check and render Tesla Paint Shop wrap PNGs on the 3D car.
 * stdout carries exactly one JSON document per invocation; progress and help go to stderr.
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { checkWrap, type CheckReport } from '../src/core/check.ts';
import { DEFAULT_VEHICLE, getVehicle, VEHICLES, type VehicleProfile } from '../src/core/vehicles.ts';
import { VIEW_NAMES, VIEWS, isViewName, type ViewName } from '../src/render/views.ts';
import { FINISHES, type Finish } from '../src/render/viewer.ts';
import { ensureCustomWraps, loadPanelMapNode, loadPanelsFile, templatePath } from './assets.ts';
import { openSession } from './browser.ts';
import { readWrapImage, UsageError } from './image.ts';
import { PUBLIC_DIR } from './paths.ts';

const HELP = `wrap-preview — preview Tesla Paint Shop wraps on the 3D car (vehicles: ${Object.keys(VEHICLES).join(', ')})

Usage:
  wrap-preview check <wrap.png> [--vehicle ${DEFAULT_VEHICLE}]
      Validate against Tesla's rules and report per-panel coverage. No rendering; fast.

  wrap-preview render <wrap.png> --out <dir> [options]
      Render the wrap on the car. Writes <dir>/views/<view>.png, <dir>/sheet.png, <dir>/report.json.
      --views <a,b,...>     Views to render (default: all). Available: ${VIEW_NAMES.join(', ')}
      --size <WxH>          Pixel size of each view (default 1024x640)
      --finish <f>          ${FINISHES.join(' | ')} (default gloss)
      --base-color <#hex>   Paint shown under transparent pixels (default #ffffff)
      --debug-uv            Overlay panel boundaries and names on the car
      --no-sheet            Skip the contact sheet
      --rebuild             Force a rebuild of the web bundle first

  wrap-preview template --out <dir> [--vehicle ${DEFAULT_VEHICLE}]
      Write Tesla's template.png, panels.png (label map, R channel = panel index),
      panels-guide.png (coloured panels with names) and panels.json.

Output: one JSON document on stdout.
Exit codes: 0 = success and the wrap passes all Tesla checks, 1 = rendered/checked but has errors, 2 = usage or runtime failure.
`;

function emit(result: unknown): void {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

function parseSize(v: string): [number, number] {
  const m = /^(\d+)x(\d+)$/i.exec(v);
  if (!m) throw new UsageError(`--size must look like 1024x640, got "${v}"`);
  const w = Number(m[1]), h = Number(m[2]);
  if (w < 64 || h < 64 || w > 4096 || h > 4096) throw new UsageError('--size sides must be between 64 and 4096');
  return [w, h];
}

function parseViews(v: string | undefined): ViewName[] {
  if (!v) return VIEW_NAMES;
  const names = v.split(',').map((s) => s.trim()).filter(Boolean);
  const bad = names.filter((n) => !isViewName(n));
  if (bad.length) throw new UsageError(`Unknown view(s): ${bad.join(', ')}. Available: ${VIEW_NAMES.join(', ')}`);
  return names as ViewName[];
}

async function runCheck(file: string, vehicle: VehicleProfile): Promise<{ report: CheckReport; bytes: Buffer }> {
  const [{ image, bytes }, map] = await Promise.all([readWrapImage(file), loadPanelMapNode(vehicle)]);
  return { report: checkWrap(image, map, vehicle.templateSize), bytes };
}

async function cmdCheck(positionals: string[], values: Record<string, unknown>): Promise<number> {
  const file = positionals[0];
  if (!file) throw new UsageError('check needs a PNG path');
  const vehicle = getVehicle(String(values.vehicle));
  const { report } = await runCheck(file, vehicle);
  emit({ command: 'check', vehicle: vehicle.id, ...report });
  return report.ok ? 0 : 1;
}

async function cmdRender(positionals: string[], values: Record<string, unknown>): Promise<number> {
  const file = positionals[0];
  if (!file) throw new UsageError('render needs a PNG path');
  if (!values.out) throw new UsageError('render needs --out <dir>');
  const vehicle = getVehicle(String(values.vehicle));
  const views = parseViews(values.views as string | undefined);
  const [width, height] = parseSize(String(values.size));
  const finish = String(values.finish) as Finish;
  if (!FINISHES.includes(finish)) throw new UsageError(`--finish must be one of ${FINISHES.join(', ')}`);
  const baseColor = String(values['base-color']);
  if (!/^#[0-9a-f]{6}$/i.test(baseColor)) throw new UsageError('--base-color must look like #rrggbb');
  const debugUv = Boolean(values['debug-uv']);
  const sheet = values.sheet !== false;
  const outDir = path.resolve(String(values.out));

  const { report, bytes } = await runCheck(file, vehicle);
  process.stderr.write(`Rendering ${views.length} view(s) of ${path.basename(file)}...\n`);
  const session = await openSession(vehicle.id, { rebuild: Boolean(values.rebuild) });
  let result;
  try {
    result = await session.call('render', {
      wrapDataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
      title: `${path.basename(file)} · ${vehicle.name} · ${finish}${debugUv ? ' · debug-uv' : ''}`,
      views,
      width,
      height,
      finish,
      baseColor,
      debugUv,
      sheet,
    });
  } finally {
    await session.close();
  }

  await mkdir(path.join(outDir, 'views'), { recursive: true });
  const viewFiles: Record<string, string> = {};
  for (const v of result.views) {
    const dest = path.join(outDir, 'views', `${v.name}.png`);
    await writeFile(dest, Buffer.from(v.dataUrl.split(',')[1], 'base64'));
    viewFiles[v.name] = dest;
  }
  let sheetFile: string | undefined;
  if (result.sheet) {
    sheetFile = path.join(outDir, 'sheet.png');
    await writeFile(sheetFile, Buffer.from(result.sheet.split(',')[1], 'base64'));
  }
  const reportFile = path.join(outDir, 'report.json');
  const output = {
    command: 'render',
    vehicle: vehicle.id,
    ...report,
    settings: { views, size: [width, height], finish, baseColor, debugUv },
    outputs: {
      sheet: sheetFile,
      views: Object.fromEntries(views.map((v) => [v, { file: viewFiles[v], label: VIEWS[v].label }])),
      report: reportFile,
    },
  };
  await writeFile(reportFile, JSON.stringify(output, null, 2) + '\n');
  emit(output);
  return report.ok ? 0 : 1;
}

async function cmdTemplate(values: Record<string, unknown>): Promise<number> {
  if (!values.out) throw new UsageError('template needs --out <dir>');
  const vehicle = getVehicle(String(values.vehicle));
  const outDir = path.resolve(String(values.out));
  await mkdir(outDir, { recursive: true });
  await ensureCustomWraps(vehicle);
  const template = await readFile(templatePath(vehicle));

  const session = await openSession(vehicle.id, { rebuild: Boolean(values.rebuild) });
  let guide: string;
  try {
    guide = await session.call('panelGuide', `data:image/png;base64,${template.toString('base64')}`);
  } finally {
    await session.close();
  }
  const files = {
    template: path.join(outDir, 'template.png'),
    panelsMap: path.join(outDir, 'panels.png'),
    panelsGuide: path.join(outDir, 'panels-guide.png'),
    panelsJson: path.join(outDir, 'panels.json'),
  };
  await writeFile(files.template, template);
  await copyFile(path.join(PUBLIC_DIR, vehicle.panelsUrl), files.panelsMap);
  await writeFile(files.panelsGuide, Buffer.from(guide.split(',')[1], 'base64'));
  const panels = await loadPanelsFile(vehicle);
  await writeFile(files.panelsJson, JSON.stringify(panels, null, 2) + '\n');
  emit({
    command: 'template',
    vehicle: vehicle.id,
    templateSize: vehicle.templateSize,
    notes: [
      'Paint every panel fully opaque; pixels outside panels are never visible on the car.',
      'Left/right are from the driver seat. panels.png stores the panel index in the R channel (0 = not on the car).',
      'orientation.imageRight / imageUp tell which car direction the PNG x axis and up axis point to on that panel; rotate text and logos accordingly (e.g. doors are rotated 90 degrees).',
      'Verify placement with `render --debug-uv`, which prints panel names onto the car.',
    ],
    files,
    panels: panels.panels.map(({ index, name, label, description, bbox, orientation }) => ({ index, name, label, description, bbox, orientation })),
  });
  return 0;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    allowNegative: true,
    options: {
      vehicle: { type: 'string', default: DEFAULT_VEHICLE },
      out: { type: 'string', short: 'o' },
      views: { type: 'string' },
      size: { type: 'string', default: '1024x640' },
      finish: { type: 'string', default: 'gloss' },
      'base-color': { type: 'string', default: '#ffffff' },
      'debug-uv': { type: 'boolean', default: false },
      sheet: { type: 'boolean', default: true },
      rebuild: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    process.stderr.write(HELP);
    return values.help ? 0 : 2;
  }
  switch (command) {
    case 'check':
      return cmdCheck(rest, values);
    case 'render':
      return cmdRender(rest, values);
    case 'template':
      return cmdTemplate(values);
    default:
      throw new UsageError(`Unknown command "${command}". Run with --help.`);
  }
}

try {
  process.exitCode = await main();
} catch (err) {
  const usage = err instanceof UsageError || (err as { code?: string }).code?.startsWith('ERR_PARSE_ARGS');
  emit({ ok: false, error: (err as Error).message, kind: usage ? 'usage' : 'runtime' });
  if (!usage) process.stderr.write(`${(err as Error).stack}\n`);
  process.exitCode = 2;
}
