import type { PanelMap } from './panels.ts';

/** Limits published in teslamotors/custom-wraps README. */
export const TESLA_LIMITS = {
  minSide: 512,
  maxSide: 1024,
  maxBytes: 1024 * 1024,
  /** Stay under this to be safe if Tesla means 1 MB = 10^6 bytes. */
  safeBytes: 1_000_000,
  maxNameLength: 30,
  namePattern: /^[A-Za-z0-9_\- ]+$/,
};

/** A panel counts as filled when at least this share of its pixels is fully opaque. */
export const FILLED_THRESHOLD = 0.99;
const OPAQUE_ALPHA = 250;

export interface WrapImage {
  fileName: string;
  fileSize: number;
  /** First bytes of the file, used to verify the PNG signature. */
  header: Uint8Array;
  width: number;
  height: number;
  rgba: Uint8Array | Uint8ClampedArray;
}

export type IssueLevel = 'error' | 'warning';

export interface CheckIssue {
  level: IssueLevel;
  code: string;
  message: string;
  panel?: string;
}

export interface PanelCoverage {
  name: string;
  label: string;
  /** Share of panel pixels that are fully opaque (0–1). */
  coverage: number;
  /** Mean colour of the panel pixels as `#rrggbb`, alpha ignored. */
  meanColor: string;
}

export interface CheckReport {
  ok: boolean;
  file: { name: string; bytes: number; width: number; height: number };
  errors: number;
  warnings: number;
  issues: CheckIssue[];
  coverage: {
    /** Fully opaque share across all panel pixels. */
    overall: number;
    panels: PanelCoverage[];
    /** Opaque pixels outside every panel: harmless, but never visible on the car. */
    outsideOpaqueRatio: number;
  };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(header: Uint8Array): boolean {
  return PNG_SIGNATURE.every((b, i) => header[i] === b);
}

function hex(n: number): string {
  return Math.round(n).toString(16).padStart(2, '0');
}

export function checkFile(img: Pick<WrapImage, 'fileName' | 'fileSize' | 'header' | 'width' | 'height'>, templateSize: [number, number]): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const L = TESLA_LIMITS;

  if (!isPng(img.header) || !/\.png$/i.test(img.fileName)) {
    issues.push({ level: 'error', code: 'not_png', message: 'File must be a PNG with a .png extension.' });
  }

  const stem = img.fileName.replace(/\.png$/i, '');
  if (!L.namePattern.test(stem)) {
    issues.push({ level: 'error', code: 'file_name_chars', message: `File name "${stem}" may only contain letters, digits, underscores, dashes and spaces.` });
  }
  if (stem.length > L.maxNameLength) {
    issues.push({ level: 'error', code: 'file_name_length', message: `File name "${stem}" is ${stem.length} characters; the limit is ${L.maxNameLength}.` });
  }

  if (img.fileSize > L.maxBytes) {
    issues.push({ level: 'error', code: 'file_too_large', message: `File is ${img.fileSize} bytes; the limit is 1 MB (${L.maxBytes} bytes).` });
  } else if (img.fileSize > L.safeBytes) {
    issues.push({ level: 'warning', code: 'file_near_limit', message: `File is ${img.fileSize} bytes, above 1,000,000. Shrink it in case the car counts 1 MB as 10^6 bytes.` });
  }

  const { width: w, height: h } = img;
  if (w < L.minSide || h < L.minSide || w > L.maxSide || h > L.maxSide) {
    issues.push({ level: 'error', code: 'dimensions_out_of_range', message: `Image is ${w}x${h}; each side must be between ${L.minSide} and ${L.maxSide} pixels.` });
  }
  const [tw, th] = templateSize;
  if (Math.abs(w / h - tw / th) > 0.01) {
    issues.push({ level: 'error', code: 'aspect_mismatch', message: `Image is ${w}x${h} but the template is ${tw}x${th}; the design would be stretched on the car.` });
  } else if (w !== tw || h !== th) {
    issues.push({ level: 'warning', code: 'not_template_size', message: `Image is ${w}x${h}; Tesla recommends the template size ${tw}x${th}.` });
  }
  return issues;
}

/** Samples the wrap at every panel pixel of the template-resolution panel map. */
export function analyzeCoverage(img: WrapImage, map: PanelMap): { panels: PanelCoverage[]; overall: number; outsideOpaqueRatio: number } {
  const n = map.panels.length + 1;
  const total = new Float64Array(n);
  const opaque = new Float64Array(n);
  const rgb = new Float64Array(n * 3);
  let outsideOpaque = 0;
  let outsideTotal = 0;
  for (let y = 0; y < map.height; y++) {
    const sy = Math.min(img.height - 1, Math.floor(((y + 0.5) * img.height) / map.height));
    for (let x = 0; x < map.width; x++) {
      const sx = Math.min(img.width - 1, Math.floor(((x + 0.5) * img.width) / map.width));
      const p = (sy * img.width + sx) * 4;
      const a = img.rgba[p + 3];
      const label = map.labels[y * map.width + x];
      if (!label) {
        outsideTotal++;
        if (a >= OPAQUE_ALPHA) outsideOpaque++;
        continue;
      }
      total[label]++;
      if (a >= OPAQUE_ALPHA) opaque[label]++;
      rgb[label * 3] += img.rgba[p];
      rgb[label * 3 + 1] += img.rgba[p + 1];
      rgb[label * 3 + 2] += img.rgba[p + 2];
    }
  }
  let sumTotal = 0;
  let sumOpaque = 0;
  const panels = map.panels.map((panel) => {
    const i = panel.index;
    sumTotal += total[i];
    sumOpaque += opaque[i];
    const t = total[i] || 1;
    return {
      name: panel.name,
      label: panel.label,
      coverage: round(opaque[i] / t),
      meanColor: `#${hex(rgb[i * 3] / t)}${hex(rgb[i * 3 + 1] / t)}${hex(rgb[i * 3 + 2] / t)}`,
    };
  });
  return { panels, overall: round(sumOpaque / (sumTotal || 1)), outsideOpaqueRatio: round(outsideOpaque / (outsideTotal || 1)) };
}

function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}

export function checkWrap(img: WrapImage, map: PanelMap, templateSize: [number, number]): CheckReport {
  const issues = checkFile(img, templateSize);
  const coverage = analyzeCoverage(img, map);
  for (const p of coverage.panels) {
    if (p.coverage < FILLED_THRESHOLD) {
      issues.push({
        level: 'warning',
        code: 'panel_not_filled',
        panel: p.name,
        message: `${p.name} is only ${(p.coverage * 100).toFixed(1)}% opaque; transparent pixels show the base paint colour on the car.`,
      });
    }
  }
  const errors = issues.filter((i) => i.level === 'error').length;
  return {
    ok: errors === 0,
    file: { name: img.fileName, bytes: img.fileSize, width: img.width, height: img.height },
    errors,
    warnings: issues.length - errors,
    issues,
    coverage,
  };
}
