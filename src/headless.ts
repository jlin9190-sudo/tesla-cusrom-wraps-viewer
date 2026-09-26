/**
 * Page driven by the CLI through Playwright. Exposes `window.wrapPreview`; uses the same
 * WrapViewer as the interactive page so both render identically.
 */
import { getVehicle, DEFAULT_VEHICLE } from './core/vehicles.ts';
import { WrapViewer, drawPanelEdges, drawPanelNames, loadImage, type Finish } from './render/viewer.ts';
import { VIEWS, type ViewName } from './render/views.ts';

export interface HeadlessRenderRequest {
  wrapDataUrl: string;
  title: string;
  views: ViewName[];
  width: number;
  height: number;
  finish: Finish;
  baseColor: string;
  debugUv: boolean;
  sheet: boolean;
}

export interface HeadlessRenderResult {
  views: { name: ViewName; dataUrl: string }[];
  sheet?: string;
}

export interface WrapPreviewApi {
  ready: Promise<void>;
  render(req: HeadlessRenderRequest): Promise<HeadlessRenderResult>;
  panelGuide(templateDataUrl: string | null): Promise<string>;
}

declare global {
  interface Window {
    wrapPreview: WrapPreviewApi;
  }
}

const vehicle = getVehicle(new URLSearchParams(location.search).get('vehicle') ?? DEFAULT_VEHICLE);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const viewerPromise = WrapViewer.create({ canvas, vehicle, assetBase: './', preserveDrawingBuffer: true });

function contactSheet(title: string, views: HeadlessRenderResult['views'], images: HTMLImageElement[], width: number, height: number): string {
  const cols = Math.min(3, views.length);
  const rows = Math.ceil(views.length / cols);
  const scale = Math.min(1, 512 / width);
  const cw = Math.round(width * scale), ch = Math.round(height * scale);
  const header = 44, gap = 6;
  const c = document.createElement('canvas');
  c.width = cols * cw + (cols + 1) * gap;
  c.height = header + rows * ch + (rows + 1) * gap;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#111';
  ctx.font = 'bold 20px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, gap * 2, header / 2 + gap / 2);
  views.forEach((v, i) => {
    const x = gap + (i % cols) * (cw + gap);
    const y = header + gap + Math.floor(i / cols) * (ch + gap);
    ctx.drawImage(images[i], x, y, cw, ch);
    const text = `${v.name} · ${VIEWS[v.name].label}`;
    ctx.font = 'bold 15px sans-serif';
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(x, y, tw + 16, 26);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x + 8, y + 13);
  });
  return c.toDataURL('image/png');
}

window.wrapPreview = {
  ready: viewerPromise.then(() => undefined),

  async render(req) {
    const viewer = await viewerPromise;
    viewer.setFinish(req.finish);
    viewer.setBaseColor(req.baseColor);
    viewer.setDebugOverlay(req.debugUv);
    viewer.setWrap(0, await loadImage(req.wrapDataUrl));
    const views = req.views.map((name) => ({ name, dataUrl: viewer.renderView(0, name, req.width, req.height) }));
    const result: HeadlessRenderResult = { views };
    if (req.sheet) {
      const images = await Promise.all(views.map((v) => loadImage(v.dataUrl)));
      result.sheet = contactSheet(req.title, views, images, req.width, req.height);
    }
    return result;
  },

  async panelGuide(templateDataUrl) {
    const viewer = await viewerPromise;
    const map = viewer.panels;
    const c = document.createElement('canvas');
    c.width = map.width;
    c.height = map.height;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    const guide = document.createElement('canvas');
    guide.width = map.width;
    guide.height = map.height;
    drawPanelEdges(guide.getContext('2d', { willReadFrequently: true })!, map, { fill: true });
    ctx.drawImage(guide, 0, 0);
    if (templateDataUrl) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(await loadImage(templateDataUrl), 0, 0, c.width, c.height);
      ctx.globalCompositeOperation = 'source-over';
    }
    drawPanelNames(ctx, map);
    return c.toDataURL('image/png');
  },
};
