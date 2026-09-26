/**
 * Builds the committed vehicle assets for the previewer from the in-car model:
 *   public/vehicles/<id>/model.glb     meshopt-compressed geometry, wrap faces tagged
 *   public/vehicles/<id>/panels.png    panel label map in wrap-PNG space (R channel = panel index)
 *   public/vehicles/<id>/panels.json   panel names, bboxes, pixel counts
 *
 * Usage: npm run build-vehicle -- [--source-dir <dir>] [--inspect]
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Document, NodeIO, PropertyType, type Node, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { PNG } from 'pngjs';
import { connectedComponents, dilateLabels, rasterizeSegment, rasterizeTriangle, type Vec2 } from './lib/raster.ts';
import { MODEL_Y_PANEL_RULES, nameComponent, type ComponentInfo } from './lib/modely-panels.ts';
import { panelOrientation, type Vec3 } from './lib/orientation.ts';
import type { PanelsFile } from '../src/core/panels.ts';

const SOURCE_COMMIT = '4063aee8e9e759dbc2e529648a8ab9dd24640960';
const SOURCE_BASE = `https://raw.githubusercontent.com/dtschannen/Tesla-Wrap-Studio/${SOURCE_COMMIT}/src/assets/wraps/modely/3D/`;
const SOURCE_FILES = {
  'ModelY_High.gltf': 'f55fc82129785a011efd0e127822b89d86c316240add75f121d8fe1bd5e54ad6',
  'ModelY_High0.bin': 'db096143e34eb87ad097706bba043a5bb92c11b1a28d0b974e3f769f16269044',
} as const;

const MAP_SIZE = 1024;
const WRAP_MATERIALS = new Set(['Paint', 'PaintRough', 'PaintFade']);
const EXTERIOR_MATERIALS = new Set(['Exterior', 'ExteriorFade']);
const WRAP_EXTERIOR = 'WrapExterior';
/** Degenerate-UV triangles collapse to a single point; anything smaller than this (in UV²) is treated as unmapped. */
const MIN_UV_AREA = 1e-9;

const { values: args } = parseArgs({
  options: {
    'source-dir': { type: 'string' },
    out: { type: 'string', default: 'public/vehicles/modely' },
    inspect: { type: 'boolean', default: false },
  },
});

async function loadSource(): Promise<Record<string, Uint8Array<ArrayBuffer>>> {
  const files: Record<string, Uint8Array<ArrayBuffer>> = {};
  for (const [name, sha] of Object.entries(SOURCE_FILES)) {
    let data: Uint8Array<ArrayBuffer>;
    if (args['source-dir']) {
      data = new Uint8Array(await readFile(path.join(args['source-dir'], name)));
    } else {
      const res = await fetch(SOURCE_BASE + name);
      if (!res.ok) throw new Error(`Download failed ${res.status}: ${SOURCE_BASE + name}`);
      data = new Uint8Array(await res.arrayBuffer());
    }
    const actual = createHash('sha256').update(data).digest('hex');
    if (actual !== sha) throw new Error(`${name}: sha256 mismatch (${actual})`);
    files[name] = data;
  }
  return files;
}

/** The source ships only 4x4 placeholder textures; drop them so the model is pure geometry + UVs. */
function stripTextures(json: any): void {
  delete json.images;
  delete json.textures;
  delete json.samplers;
  for (const m of json.materials ?? []) {
    const pbr = m.pbrMetallicRoughness ?? {};
    delete pbr.baseColorTexture;
    delete pbr.metallicRoughnessTexture;
    delete m.normalTexture;
    delete m.occlusionTexture;
    delete m.emissiveTexture;
  }
}

function triangleIndices(prim: Primitive): number[] {
  const idx = prim.getIndices();
  if (idx) return Array.from(idx.getArray()!);
  const count = prim.getAttribute('POSITION')!.getCount();
  return Array.from({ length: count }, (_, i) => i);
}

function uvArea(uv: ArrayLike<number>, a: number, b: number, c: number): number {
  const ax = uv[a * 2], ay = uv[a * 2 + 1];
  return Math.abs((uv[b * 2] - ax) * (uv[c * 2 + 1] - ay) - (uv[b * 2 + 1] - ay) * (uv[c * 2] - ax)) / 2;
}

/** Moves Exterior triangles that carry real wrap UVs into their own primitive with a dedicated material. */
function splitExteriorPrimitives(doc: Document): void {
  const root = doc.getRoot();
  const wrapExterior = doc.createMaterial(WRAP_EXTERIOR).setBaseColorFactor([1, 1, 1, 1]);
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const matName = prim.getMaterial()?.getName() ?? '';
      if (!EXTERIOR_MATERIALS.has(matName)) continue;
      const uvAttr = prim.getAttribute('TEXCOORD_1');
      if (!uvAttr) continue;
      const uv = uvAttr.getArray()!;
      const tris = triangleIndices(prim);
      const keep: number[] = [];
      const wrap: number[] = [];
      for (let t = 0; t < tris.length; t += 3) {
        const target = uvArea(uv, tris[t], tris[t + 1], tris[t + 2]) > MIN_UV_AREA ? wrap : keep;
        target.push(tris[t], tris[t + 1], tris[t + 2]);
      }
      if (!wrap.length) continue;
      const wrapPrim = prim.clone().setMaterial(wrapExterior);
      wrapPrim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(wrap)));
      mesh.addPrimitive(wrapPrim);
      if (keep.length) prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(keep)));
      else mesh.removePrimitive(prim);
    }
  }
}

interface WrapTriangle {
  node: string;
  uv: [Vec2, Vec2, Vec2];
  pos: [Vec3, Vec3, Vec3];
  /** Mean vertex normal in world space (independent of winding, which mirrored nodes flip). */
  normal: Vec3;
  centroid: Vec3;
}

function collectWrapTriangles(doc: Document): WrapTriangle[] {
  const out: WrapTriangle[] = [];
  const visit = (node: Node) => {
    const mesh = node.getMesh();
    if (mesh) {
      const m = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        const matName = prim.getMaterial()?.getName() ?? '';
        if (!WRAP_MATERIALS.has(matName) && matName !== WRAP_EXTERIOR) continue;
        const uv = prim.getAttribute('TEXCOORD_1')!.getArray()!;
        const pos = prim.getAttribute('POSITION')!.getArray()!;
        const nrm = prim.getAttribute('NORMAL')!.getArray()!;
        const tris = triangleIndices(prim);
        for (let t = 0; t < tris.length; t += 3) {
          const ids = [tris[t], tris[t + 1], tris[t + 2]];
          if (uvArea(uv, ids[0], ids[1], ids[2]) <= MIN_UV_AREA) continue;
          const world = ids.map((i): Vec3 => {
            const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
            return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
          }) as [Vec3, Vec3, Vec3];
          const normal: Vec3 = [0, 0, 0];
          for (const i of ids) {
            const x = nrm[i * 3], y = nrm[i * 3 + 1], z = nrm[i * 3 + 2];
            normal[0] += m[0] * x + m[4] * y + m[8] * z;
            normal[1] += m[1] * x + m[5] * y + m[9] * z;
            normal[2] += m[2] * x + m[6] * y + m[10] * z;
          }
          out.push({
            node: node.getName(),
            uv: ids.map((i) => [uv[i * 2] * MAP_SIZE, uv[i * 2 + 1] * MAP_SIZE]) as [Vec2, Vec2, Vec2],
            pos: world,
            normal,
            centroid: [0, 1, 2].map((k) => (world[0][k] + world[1][k] + world[2][k]) / 3) as Vec3,
          });
        }
      }
    }
    node.listChildren().forEach(visit);
  };
  doc.getRoot().getDefaultScene()!.listChildren().forEach(visit);
  return out;
}

/** Splits every node's UV footprint into islands and returns per-island stats for naming. */
function findComponents(tris: WrapTriangle[]): { components: ComponentInfo[]; pixelComponent: Int32Array } {
  const N = MAP_SIZE * MAP_SIZE;
  const pixelComponent = new Int32Array(N).fill(-1);
  const components: ComponentInfo[] = [];
  const byNode = new Map<string, WrapTriangle[]>();
  for (const t of tris) {
    if (!byNode.has(t.node)) byNode.set(t.node, []);
    byNode.get(t.node)!.push(t);
  }
  for (const [node, list] of byNode) {
    const mask = new Uint8Array(N);
    const sum = new Float64Array(N * 4);
    for (const t of list) {
      const plot = (x: number, y: number) => {
        const i = y * MAP_SIZE + x;
        mask[i] = 1;
        sum[i * 4] += t.centroid[0];
        sum[i * 4 + 1] += t.centroid[1];
        sum[i * 4 + 2] += t.centroid[2];
        sum[i * 4 + 3] += 1;
      };
      rasterizeTriangle(t.uv[0], t.uv[1], t.uv[2], MAP_SIZE, MAP_SIZE, plot);
      rasterizeSegment(t.uv[0], t.uv[1], MAP_SIZE, MAP_SIZE, plot);
      rasterizeSegment(t.uv[1], t.uv[2], MAP_SIZE, MAP_SIZE, plot);
      rasterizeSegment(t.uv[2], t.uv[0], MAP_SIZE, MAP_SIZE, plot);
    }
    // Islands of the same panel are often split by UV seams a pixel or two apart; bridge them.
    const bridged = dilateLabels(mask, MAP_SIZE, MAP_SIZE, 4);
    const { ids, count } = connectedComponents(bridged, MAP_SIZE, MAP_SIZE);
    const base = components.length;
    for (let c = 0; c < count; c++) {
      components.push({ node, pixels: 0, bbox: [Infinity, Infinity, -Infinity, -Infinity], centroid3d: [0, 0, 0], centroidUv: [0, 0] });
    }
    const acc = new Float64Array(count * 4);
    for (let i = 0; i < N; i++) {
      if (!mask[i]) continue;
      const c = ids[i] - 1;
      const comp = components[base + c];
      const x = i % MAP_SIZE, y = (i - x) / MAP_SIZE;
      comp.pixels++;
      comp.bbox = [Math.min(comp.bbox[0], x), Math.min(comp.bbox[1], y), Math.max(comp.bbox[2], x), Math.max(comp.bbox[3], y)];
      comp.centroidUv[0] += x;
      comp.centroidUv[1] += y;
      for (let k = 0; k < 4; k++) acc[c * 4 + k] += sum[i * 4 + k];
      pixelComponent[i] = base + c;
    }
    for (let c = 0; c < count; c++) {
      const comp = components[base + c];
      comp.centroidUv = [comp.centroidUv[0] / comp.pixels, comp.centroidUv[1] / comp.pixels];
      const n = acc[c * 4 + 3];
      comp.centroid3d = [acc[c * 4] / n, acc[c * 4 + 1] / n, acc[c * 4 + 2] / n];
    }
  }
  return { components, pixelComponent };
}

async function main(): Promise<void> {
  const files = await loadSource();
  const json = JSON.parse(new TextDecoder().decode(files['ModelY_High.gltf']));
  stripTextures(json);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.readJSON({ json, resources: { 'ModelY_High0.bin': files['ModelY_High0.bin'] } });

  splitExteriorPrimitives(doc);
  const tris = collectWrapTriangles(doc);
  const { components, pixelComponent } = findComponents(tris);

  if (args.inspect) {
    components
      .map((c, i) => ({ i, ...c }))
      .sort((a, b) => b.pixels - a.pixels)
      .forEach((c) =>
        console.log(
          c.i, c.node, c.pixels, 'bbox', c.bbox.join(','), 'uv', c.centroidUv.map((v) => v.toFixed(0)).join(','),
          'xyz', c.centroid3d.map((v) => v.toFixed(2)).join(','), '->', nameComponent(c) ?? '(unnamed)',
        ),
      );
    return;
  }

  const panelIndex = new Map<string, number>();
  const componentPanel = components.map((c) => {
    const name = nameComponent(c);
    if (!name) throw new Error(`Unnamed wrap island on ${c.node} at uv ${c.centroidUv.map(Math.round)} (${c.pixels}px)`);
    if (!panelIndex.has(name)) panelIndex.set(name, panelIndex.size + 1);
    return panelIndex.get(name)!;
  });

  let labels: Uint8Array = new Uint8Array(MAP_SIZE * MAP_SIZE);
  for (let i = 0; i < labels.length; i++) if (pixelComponent[i] >= 0) labels[i] = componentPanel[pixelComponent[i]];
  // Texture filtering reads a little past the triangle edges, so count a small margin as part of the panel.
  labels = dilateLabels(labels, MAP_SIZE, MAP_SIZE, 2);

  const trianglesByPanel = new Map<number, WrapTriangle[]>();
  for (const t of tris) {
    const x = Math.floor((t.uv[0][0] + t.uv[1][0] + t.uv[2][0]) / 3);
    const y = Math.floor((t.uv[0][1] + t.uv[1][1] + t.uv[2][1]) / 3);
    const label = labels[Math.min(MAP_SIZE - 1, Math.max(0, y)) * MAP_SIZE + Math.min(MAP_SIZE - 1, Math.max(0, x))];
    if (!label) continue;
    if (!trianglesByPanel.has(label)) trianglesByPanel.set(label, []);
    trianglesByPanel.get(label)!.push(t);
  }

  const panels: PanelsFile['panels'] = [];
  for (const [name, index] of panelIndex) {
    const rule = MODEL_Y_PANEL_RULES.find((r) => r.name === name)!;
    let pixels = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, sx = 0, sy = 0;
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] !== index) continue;
      const x = i % MAP_SIZE, y = (i - x) / MAP_SIZE;
      pixels++;
      sx += x;
      sy += y;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    panels.push({
      index,
      name,
      label: rule.label,
      description: rule.description,
      bbox: [x0, y0, x1 - x0 + 1, y1 - y0 + 1],
      center: [Math.round(sx / pixels), Math.round(sy / pixels)],
      pixels,
      orientation: panelOrientation(trianglesByPanel.get(index) ?? []),
    });
  }
  panels.sort((a, b) => a.index - b.index);

  const png = new PNG({ width: MAP_SIZE, height: MAP_SIZE });
  for (let i = 0; i < labels.length; i++) {
    png.data[i * 4] = labels[i];
    png.data[i * 4 + 1] = 0;
    png.data[i * 4 + 2] = 0;
    png.data[i * 4 + 3] = labels[i] ? 255 : 0;
  }

  // The ground plane only carried a baked shadow texture that no longer exists.
  doc.getRoot().listNodes().find((n) => n.getName() === 'Floor')?.dispose();
  // The previewer only samples the wrap UVs (TEXCOORD_1) on wrap faces; drop everything else.
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const matName = prim.getMaterial()?.getName() ?? '';
      for (const semantic of ['TEXCOORD_0', 'TANGENT', 'COLOR_0']) prim.setAttribute(semantic, null);
      if (!WRAP_MATERIALS.has(matName) && matName !== WRAP_EXTERIOR) prim.setAttribute('TEXCOORD_1', null);
    }
  }
  // Material names drive rendering roles, so never merge materials even when their factors are identical.
  await doc.transform(prune({ keepLeaves: true, keepAttributes: true }), dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH] }));
  await MeshoptEncoder.ready;
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizeTexcoord: 16, quantizePosition: 16 }));

  const outDir = args.out!;
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'model.glb'), await io.writeBinary(doc));
  await writeFile(path.join(outDir, 'panels.png'), PNG.sync.write(png));
  const panelsFile: PanelsFile = {
    vehicle: 'modely',
    width: MAP_SIZE,
    height: MAP_SIZE,
    source: { repo: 'dtschannen/Tesla-Wrap-Studio', commit: SOURCE_COMMIT, files: SOURCE_FILES },
    panels,
  };
  await writeFile(path.join(outDir, 'panels.json'), JSON.stringify(panelsFile, null, 2) + '\n');
  console.log(`Wrote ${outDir}: ${panels.length} panels, ${tris.length} wrap triangles`);
}

await main();
