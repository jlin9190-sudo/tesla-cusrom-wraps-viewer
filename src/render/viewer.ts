import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { MaterialRole, VehicleProfile } from '../core/vehicles.ts';
import type { PanelMap } from '../core/panels.ts';
import { VIEWS, fitCamera, type ViewName } from './views.ts';
import { createWheel } from './wheels.ts';

export type Finish = 'gloss' | 'satin' | 'matte';
export const FINISHES: Finish[] = ['gloss', 'satin', 'matte'];

const FINISH_PARAMS: Record<Finish, { roughness: number; clearcoat: number; clearcoatRoughness: number }> = {
  gloss: { roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.03 },
  satin: { roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.4 },
  matte: { roughness: 0.85, clearcoat: 0, clearcoatRoughness: 1 },
};

export const BACKGROUND = 0xdfe2e6;
const MAX_SLOTS = 4;

export interface ViewerOptions {
  canvas: HTMLCanvasElement;
  vehicle: VehicleProfile;
  /** Base URL that vehicle asset paths are relative to. */
  assetBase: string;
  /** Keep the drawing buffer so canvas.toDataURL works outside the render call (headless capture). */
  preserveDrawingBuffer?: boolean;
  interactive?: boolean;
  pixelRatio?: number;
}

interface Slot {
  image: CanvasImageSource | null;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
}

/** Loads `url` into an Image element (browser only). */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image ${url}`));
    img.src = url;
  });
}

export async function loadPanelMap(vehicle: VehicleProfile, assetBase: string): Promise<PanelMap> {
  const [json, img] = await Promise.all([
    fetch(assetBase + vehicle.panelsJsonUrl).then((r) => r.json()),
    loadImage(assetBase + vehicle.panelsUrl),
  ]);
  const c = document.createElement('canvas');
  c.width = json.width;
  c.height = json.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const rgba = ctx.getImageData(0, 0, c.width, c.height).data;
  const labels = new Uint8Array(c.width * c.height);
  for (let i = 0; i < labels.length; i++) labels[i] = rgba[i * 4 + 3] ? rgba[i * 4] : 0;
  return { width: json.width, height: json.height, labels, panels: json.panels };
}

/** Paints panel boundaries (and optionally a per-panel fill colour) over the canvas, in template space. */
export function drawPanelEdges(ctx: CanvasRenderingContext2D, map: PanelMap, opts: { fill?: boolean } = {}): void {
  const { width: w, height: h, labels } = map;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = labels[i];
      let edge = false;
      for (let k = 1; k <= 2 && !edge; k++) {
        edge =
          (x + k < w && labels[i + k] !== l) ||
          (y + k < h && labels[i + k * w] !== l) ||
          (x - k >= 0 && labels[i - k] !== l) ||
          (y - k >= 0 && labels[i - k * w] !== l);
      }
      const p = i * 4;
      if (edge) {
        d[p] = 255; d[p + 1] = 0; d[p + 2] = 170; d[p + 3] = 255;
      } else if (opts.fill && l) {
        const [r, g, b] = panelColor(l);
        d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Writes each panel's machine name at its centre; tall thin panels get vertical text. */
export function drawPanelNames(ctx: CanvasRenderingContext2D, map: PanelMap): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of map.panels) {
    const [, , bw, bh] = p.bbox;
    const vertical = bh > bw * 2.5;
    const size = Math.max(11, Math.min(26, (vertical ? bh : bw) / 9));
    ctx.save();
    ctx.translate(p.center[0], p.center[1]);
    if (vertical) ctx.rotate(-Math.PI / 2);
    ctx.font = `bold ${size}px sans-serif`;
    ctx.lineWidth = Math.max(3, size / 4);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.fillStyle = '#c0007a';
    ctx.strokeText(p.name, 0, 0);
    ctx.fillText(p.name, 0, 0);
    ctx.restore();
  }
}

export function panelColor(index: number): [number, number, number] {
  const c = new THREE.Color().setHSL(((index * 0.618034) % 1 + 1) % 1, 0.6, 0.72);
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
}

export class WrapViewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  readonly controls: OrbitControls | null;
  readonly box = new THREE.Box3();
  private readonly vehicle: VehicleProfile;
  private readonly wrapMaterial: THREE.MeshPhysicalMaterial;
  private readonly slots: Slot[] = [];
  private slotCount = 1;
  private baseColor = '#ffffff';
  private debugOverlay = false;
  private panelMap: PanelMap | null = null;
  private guideCanvas: HTMLCanvasElement | null = null;
  private currentView: ViewName = 'front_left';

  private constructor(private readonly opts: ViewerOptions) {
    this.vehicle = opts.vehicle;
    this.renderer = new THREE.WebGLRenderer({ canvas: opts.canvas, antialias: true, preserveDrawingBuffer: !!opts.preserveDrawingBuffer });
    this.renderer.setPixelRatio(opts.pixelRatio ?? 1);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(BACKGROUND);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(-3, 6, -4);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(4, 3, 5);
    this.scene.add(fill);

    this.wrapMaterial = new THREE.MeshPhysicalMaterial({ name: 'wrap', metalness: 0, ...FINISH_PARAMS.gloss });
    const [tw, th] = this.vehicle.templateSize;
    for (let i = 0; i < MAX_SLOTS; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = tw;
      canvas.height = th;
      const texture = new THREE.CanvasTexture(canvas);
      texture.flipY = false;
      texture.channel = 1;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      this.slots.push({ image: null, canvas, texture });
      this.composeSlot(i);
    }
    // Assign a map before first compile so the shader is built with texture sampling.
    this.wrapMaterial.map = this.slots[0].texture;

    this.controls = opts.interactive ? new OrbitControls(this.camera, opts.canvas) : null;
    if (this.controls) {
      this.controls.enableDamping = true;
      this.controls.maxPolarAngle = Math.PI * 0.495;
      this.controls.minDistance = 2.5;
      this.controls.maxDistance = 20;
    }
  }

  static async create(opts: ViewerOptions): Promise<WrapViewer> {
    const viewer = new WrapViewer(opts);
    await viewer.loadVehicle();
    return viewer;
  }

  private async loadVehicle(): Promise<void> {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const [gltf, panelMap] = await Promise.all([
      loader.loadAsync(this.opts.assetBase + this.vehicle.modelUrl),
      loadPanelMap(this.vehicle, this.opts.assetBase),
    ]);
    this.panelMap = panelMap;
    const car = gltf.scene;
    const materials = this.createRoleMaterials();
    const hidden = new Set(this.vehicle.hiddenNodes);
    car.traverse((obj) => {
      if (hidden.has(obj.name)) obj.visible = false;
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const name = (mesh.material as THREE.Material).name;
      const role: MaterialRole = this.vehicle.materialRoles[name] ?? 'interior';
      if (role === 'hidden') mesh.visible = false;
      else mesh.material = materials[role];
    });
    this.scene.add(car);
    car.updateMatrixWorld(true);

    this.box.makeEmpty();
    car.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh && obj.visible) this.box.expandByObject(obj);
    });
    for (const nodeName of this.vehicle.wheels.nodes) {
      const node = car.getObjectByName(nodeName);
      if (!node) continue;
      const pos = node.getWorldPosition(new THREE.Vector3());
      const wheel = createWheel(this.vehicle.wheels, Math.sign(pos.x) || 1);
      wheel.position.copy(pos);
      this.scene.add(wheel);
    }
    this.box.min.y = 0;
    this.scene.add(this.createContactShadow());
    this.setView(this.currentView);
  }

  private createRoleMaterials(): Record<Exclude<MaterialRole, 'hidden'>, THREE.Material> {
    const invisible = new THREE.MeshBasicMaterial({ visible: false });
    return {
      wrap: this.wrapMaterial,
      trim: new THREE.MeshPhysicalMaterial({ color: 0x0c0c0d, roughness: 0.38, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.1 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0x07090c, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.82, envMapIntensity: 1.4 }),
      glassInterior: invisible,
      lightGlass: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.18, depthWrite: false }),
      light: new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.25, metalness: 0.85 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.12, metalness: 1 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9, metalness: 0 }),
      interior: new THREE.MeshStandardMaterial({ color: 0x1d1e21, roughness: 0.85, metalness: 0 }),
    };
  }

  private createContactShadow(): THREE.Mesh {
    const size = this.box.getSize(new THREE.Vector3());
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(128, 128, 20, 128, 128, 128);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.3)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size.x * 1.45, size.z * 1.25),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((this.box.min.x + this.box.max.x) / 2, 0.002, (this.box.min.z + this.box.max.z) / 2);
    mesh.renderOrder = -1;
    return mesh;
  }

  get panels(): PanelMap {
    if (!this.panelMap) throw new Error('Vehicle not loaded');
    return this.panelMap;
  }

  /** Sets the wrap image shown in `slot` (null = plain base paint). */
  setWrap(slot: number, image: CanvasImageSource | null): void {
    this.slots[slot].image = image;
    this.composeSlot(slot);
  }

  setSlotCount(n: number): void {
    this.slotCount = Math.max(1, Math.min(MAX_SLOTS, n));
  }

  setFinish(finish: Finish): void {
    Object.assign(this.wrapMaterial, FINISH_PARAMS[finish]);
    this.wrapMaterial.needsUpdate = true;
  }

  setBaseColor(color: string): void {
    this.baseColor = color;
    this.slots.forEach((_, i) => this.composeSlot(i));
  }

  setDebugOverlay(on: boolean): void {
    this.debugOverlay = on;
    this.slots.forEach((_, i) => this.composeSlot(i));
  }

  /** Bakes base paint + wrap (+ optional panel guide) into the slot's texture canvas. */
  private composeSlot(i: number): void {
    const { canvas, texture, image } = this.slots[i];
    const ctx = canvas.getContext('2d')!;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = this.baseColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (image) ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (this.debugOverlay && this.panelMap) ctx.drawImage(this.getGuideCanvas(), 0, 0, canvas.width, canvas.height);
    texture.needsUpdate = true;
  }

  private getGuideCanvas(): HTMLCanvasElement {
    if (!this.guideCanvas && this.panelMap) {
      const c = document.createElement('canvas');
      c.width = this.panelMap.width;
      c.height = this.panelMap.height;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      drawPanelEdges(ctx, this.panelMap);
      drawPanelNames(ctx, this.panelMap);
      this.guideCanvas = c;
    }
    return this.guideCanvas!;
  }

  setView(view: ViewName, aspect = this.cellAspect()): void {
    this.currentView = view;
    this.camera.aspect = aspect;
    const target = fitCamera(this.camera, this.box, VIEWS[view]);
    if (this.controls) {
      this.controls.target.copy(target);
      this.controls.update();
    }
  }

  private layout(): { cols: number; rows: number } {
    const n = this.slotCount;
    const cols = n === 1 ? 1 : 2;
    return { cols, rows: Math.ceil(n / cols) };
  }

  private cellAspect(): number {
    const el = this.renderer.domElement;
    const w = el.clientWidth || el.width;
    const h = el.clientHeight || el.height;
    const { cols, rows } = this.layout();
    return w && h ? w / cols / (h / rows) : 16 / 10;
  }

  /** Grid rectangles of each visible slot in CSS pixels, origin top-left. */
  cellRects(): { x: number; y: number; w: number; h: number }[] {
    const el = this.renderer.domElement;
    const W = el.clientWidth, H = el.clientHeight;
    const { cols, rows } = this.layout();
    const cw = W / cols, ch = H / rows;
    return Array.from({ length: this.slotCount }, (_, i) => ({ x: (i % cols) * cw, y: Math.floor(i / cols) * ch, w: cw, h: ch }));
  }

  /** Resizes the drawing buffer to the canvas' CSS size. */
  resize(): void {
    const el = this.renderer.domElement;
    this.renderer.setSize(el.clientWidth, el.clientHeight, false);
  }

  /** Renders all visible slots side by side with one shared camera. */
  render(): void {
    this.controls?.update();
    const el = this.renderer.domElement;
    const H = el.clientHeight;
    this.camera.aspect = this.cellAspect();
    this.camera.updateProjectionMatrix();
    this.renderer.setScissorTest(true);
    for (const [i, r] of this.cellRects().entries()) {
      const y = H - r.y - r.h;
      this.renderer.setViewport(r.x, y, r.w, r.h);
      this.renderer.setScissor(r.x, y, r.w, r.h);
      this.wrapMaterial.map = this.slots[i].texture;
      this.renderer.render(this.scene, this.camera);
    }
    this.renderer.setScissorTest(false);
  }

  /** Renders one slot from a preset view at an exact pixel size and returns a PNG data URL. */
  renderView(slot: number, view: ViewName, width: number, height: number): string {
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.renderer.setViewport(0, 0, width, height);
    this.camera.aspect = width / height;
    fitCamera(this.camera, this.box, VIEWS[view]);
    this.wrapMaterial.map = this.slots[slot].texture;
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
}
