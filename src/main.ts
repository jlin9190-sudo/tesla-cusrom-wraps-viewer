import './style.css';
import { checkWrap, type CheckReport, type WrapImage } from './core/check.ts';
import { DEFAULT_VEHICLE, getVehicle } from './core/vehicles.ts';
import { WrapViewer, type Finish } from './render/viewer.ts';
import { VIEWS, VIEW_NAMES, type ViewName } from './render/views.ts';

const MAX_VERSIONS = 4;
const VIEW_LABELS: Record<ViewName, string> = {
  front_left: '左前 3/4',
  front: '正前',
  left: '左侧',
  rear_right: '右后 3/4',
  rear: '正后',
  right: '右侧',
  top: '俯视',
};

interface Version {
  id: number;
  name: string;
  url: string;
  bitmap: ImageBitmap;
  report: CheckReport;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const vehicle = getVehicle(new URLSearchParams(location.search).get('vehicle') ?? DEFAULT_VEHICLE);
const canvas = $<HTMLCanvasElement>('canvas');
const stage = $('stage');
const versions: Version[] = [];
let openVersion: number | null = null;
let nextId = 1;
let activeView: ViewName = 'front_left';

$('vehicle-name').textContent = `${vehicle.name} · 基于 Tesla 车机原版模型`;

const viewer = await WrapViewer.create({
  canvas,
  vehicle,
  assetBase: './',
  interactive: true,
  pixelRatio: Math.min(window.devicePixelRatio, 2),
});
$('loading').hidden = true;

function toast(message: string): void {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 3200);
}

async function decode(file: File): Promise<{ image: WrapImage; bitmap: ImageBitmap }> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const bitmap = await createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const c = document.createElement('canvas');
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const rgba = ctx.getImageData(0, 0, c.width, c.height).data;
  return {
    bitmap,
    image: { fileName: file.name, fileSize: file.size, header: buffer.subarray(0, 8), width: bitmap.width, height: bitmap.height, rgba },
  };
}

async function addFiles(files: File[]): Promise<void> {
  for (const file of files) {
    if (versions.length >= MAX_VERSIONS) {
      toast(`最多同时对比 ${MAX_VERSIONS} 个版本，请先移除一个`);
      break;
    }
    try {
      const { image, bitmap } = await decode(file);
      const report = checkWrap(image, viewer.panels, vehicle.templateSize);
      versions.push({ id: nextId++, name: file.name, url: URL.createObjectURL(file), bitmap, report });
    } catch {
      toast(`无法读取 ${file.name}，请确认是 PNG 图片`);
    }
  }
  sync();
}

function removeVersion(id: number): void {
  const i = versions.findIndex((v) => v.id === id);
  if (i < 0) return;
  URL.revokeObjectURL(versions[i].url);
  versions[i].bitmap.close();
  versions.splice(i, 1);
  sync();
}

function badge(report: CheckReport): string {
  if (report.errors) return `<span class="badge err">${report.errors} 个错误</span>`;
  if (report.warnings) return `<span class="badge warn">${report.warnings} 个提醒</span>`;
  return '<span class="badge ok">符合 Tesla 要求</span>';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function renderVersionList(): void {
  const list = $('versions');
  list.innerHTML = '';
  versions.forEach((v, i) => {
    const li = document.createElement('li');
    li.className = `version${openVersion === v.id ? ' open' : ''}`;
    const r = v.report;
    const issues = r.issues.map((iss) => `<li class="${iss.level}">${escapeHtml(iss.message)}</li>`).join('');
    const rows = r.coverage.panels
      .map((p) => `<tr class="${p.coverage < 0.99 ? 'low' : ''}"><td><span class="swatch" style="background:${p.meanColor}"></span>${p.label} <small>${p.name}</small></td><td>${(p.coverage * 100).toFixed(1)}%</td></tr>`)
      .join('');
    li.innerHTML = `
      <div class="head">
        <img src="${v.url}" alt="" />
        <div class="meta">
          <div class="name" title="${escapeHtml(v.name)}">${escapeHtml(v.name)}</div>
          <div class="slot">#${i + 1} · ${r.file.width}×${r.file.height} · ${(r.file.bytes / 1024).toFixed(0)} KB</div>
          ${badge(r)}
        </div>
        <button class="remove" title="移除">×</button>
      </div>
      <div class="details">
        ${issues ? `<ul class="issues">${issues}</ul>` : ''}
        <table class="coverage"><tbody>${rows}</tbody></table>
      </div>`;
    li.querySelector('.head')!.addEventListener('click', () => {
      openVersion = openVersion === v.id ? null : v.id;
      renderVersionList();
    });
    li.querySelector('.remove')!.addEventListener('click', (e) => {
      e.stopPropagation();
      removeVersion(v.id);
    });
    list.append(li);
  });
}

function renderCellLabels(): void {
  const cells = $('cells');
  cells.innerHTML = '';
  if (versions.length < 1) return;
  viewer.cellRects().forEach((r, i) => {
    const v = versions[i];
    const el = document.createElement('div');
    el.className = 'cell';
    Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    el.innerHTML = `<div class="label">#${i + 1} ${escapeHtml(v.name)} ${badge(v.report)}</div>`;
    cells.append(el);
  });
}

let slotCount = 1;

function sync(): void {
  const count = Math.max(1, versions.length);
  viewer.setSlotCount(count);
  if (count !== slotCount) {
    slotCount = count;
    viewer.setView(activeView);
  }
  for (let i = 0; i < count; i++) viewer.setWrap(i, versions[i]?.bitmap ?? null);
  $('empty').hidden = versions.length > 0;
  renderVersionList();
  renderCellLabels();
}

// File input and drag & drop (sidebar zone and the whole stage).
const input = $<HTMLInputElement>('file-input');
input.addEventListener('change', () => {
  addFiles([...(input.files ?? [])]);
  input.value = '';
});
for (const zone of [$('dropzone'), stage]) {
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    addFiles([...(e.dataTransfer?.files ?? [])].filter((f) => f.type === 'image/png' || f.name.toLowerCase().endsWith('.png')));
  });
}

// Tesla examples, available after `npm run fetch-assets`.
const examples = $<HTMLSelectElement>('examples');
fetch(`custom-wraps/${vehicle.customWrapsDir}/manifest.json`)
  .then((r) => (r.ok ? r.json() : null))
  .then((m: { examples: string[] } | null) => {
    if (!m?.examples.length) return;
    for (const path of m.examples) examples.add(new Option(path.split('/').pop()!.replace(/\.png$/i, ''), path));
    examples.hidden = false;
  })
  .catch(() => {});
examples.addEventListener('change', async () => {
  const path = examples.value;
  examples.value = '';
  if (!path) return;
  const blob = await fetch(`custom-wraps/${vehicle.customWrapsDir}/${path}`).then((r) => r.blob());
  addFiles([new File([blob], path.split('/').pop()!, { type: 'image/png' })]);
});

// Render settings.
$('finish').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  $('finish').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
  viewer.setFinish(btn.dataset.finish as Finish);
});
$<HTMLInputElement>('base-color').addEventListener('input', (e) => viewer.setBaseColor((e.target as HTMLInputElement).value));
$<HTMLInputElement>('debug-uv').addEventListener('change', (e) => viewer.setDebugOverlay((e.target as HTMLInputElement).checked));

const viewsEl = $('views');
for (const name of VIEW_NAMES) {
  const b = document.createElement('button');
  b.textContent = VIEW_LABELS[name];
  b.title = VIEWS[name].label;
  b.dataset.view = name;
  b.classList.toggle('active', name === activeView);
  b.addEventListener('click', () => {
    activeView = name;
    viewsEl.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    viewer.setView(name);
  });
  viewsEl.append(b);
}
viewer.controls?.addEventListener('start', () => viewsEl.querySelectorAll('button').forEach((x) => x.classList.remove('active')));

$('screenshot').addEventListener('click', () => {
  viewer.render();
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `wrap-preview-${activeView}.png`;
  a.click();
});

new ResizeObserver(() => {
  viewer.resize();
  renderCellLabels();
}).observe(canvas);
viewer.resize();
viewer.setView(activeView);
sync();

function loop(): void {
  viewer.render();
  requestAnimationFrame(loop);
}
loop();
