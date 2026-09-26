import { describe, expect, it } from 'vitest';
import { analyzeCoverage, checkFile, checkWrap, type WrapImage } from '../src/core/check.ts';
import type { PanelMap } from '../src/core/panels.ts';

const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TEMPLATE: [number, number] = [1024, 1024];

function codes(issues: { code: string }[]): string[] {
  return issues.map((i) => i.code);
}

function file(overrides: Partial<Parameters<typeof checkFile>[0]> = {}) {
  return { fileName: 'My_Wrap-1.png', fileSize: 400_000, header: PNG_HEADER, width: 1024, height: 1024, ...overrides };
}

/** 4x4 map: left half panel 1, right half panel 2. */
const MAP: PanelMap = {
  width: 4,
  height: 4,
  labels: new Uint8Array([1, 1, 2, 2, 1, 1, 2, 2, 1, 1, 2, 2, 1, 1, 2, 2]),
  panels: [
    { index: 1, name: 'left_half', label: '左', description: '', bbox: [0, 0, 2, 4], center: [1, 2], pixels: 8, orientation: { imageRight: 'right', imageUp: 'front', facing: 'up', mirrored: false } },
    { index: 2, name: 'right_half', label: '右', description: '', bbox: [2, 0, 2, 4], center: [3, 2], pixels: 8, orientation: { imageRight: 'right', imageUp: 'front', facing: 'up', mirrored: false } },
  ],
};

function image(w: number, h: number, pixel: (x: number, y: number) => [number, number, number, number]): WrapImage {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.set(pixel(x, y), (y * w + x) * 4);
  return { fileName: 'test.png', fileSize: 1000, header: PNG_HEADER, width: w, height: h, rgba };
}

describe('checkFile', () => {
  it('accepts a template-sized PNG with a valid name', () => {
    expect(checkFile(file(), TEMPLATE)).toEqual([]);
  });

  it('rejects non-PNG content or extension', () => {
    expect(codes(checkFile(file({ header: new Uint8Array(8) }), TEMPLATE))).toContain('not_png');
    expect(codes(checkFile(file({ fileName: 'wrap.jpg' }), TEMPLATE))).toContain('not_png');
  });

  it('enforces Tesla file name rules on the stem', () => {
    expect(codes(checkFile(file({ fileName: 'bad.name!.png' }), TEMPLATE))).toContain('file_name_chars');
    expect(codes(checkFile(file({ fileName: `${'a'.repeat(31)}.png` }), TEMPLATE))).toContain('file_name_length');
    expect(checkFile(file({ fileName: `${'a'.repeat(30)}.png` }), TEMPLATE)).toEqual([]);
  });

  it('errors above 1 MiB and warns between 10^6 bytes and 1 MiB', () => {
    expect(codes(checkFile(file({ fileSize: 1024 * 1024 + 1 }), TEMPLATE))).toEqual(['file_too_large']);
    expect(checkFile(file({ fileSize: 1_010_000 }), TEMPLATE).map((i) => [i.code, i.level])).toEqual([['file_near_limit', 'warning']]);
  });

  it('checks the 512–1024 range and the template aspect ratio', () => {
    expect(codes(checkFile(file({ width: 2048, height: 2048 }), TEMPLATE))).toEqual(['dimensions_out_of_range', 'not_template_size']);
    expect(codes(checkFile(file({ width: 1024, height: 768 }), TEMPLATE))).toEqual(['aspect_mismatch']);
    expect(checkFile(file({ width: 512, height: 512 }), TEMPLATE).map((i) => [i.code, i.level])).toEqual([['not_template_size', 'warning']]);
  });
});

describe('analyzeCoverage', () => {
  it('reports per-panel opacity and mean colour', () => {
    const img = image(4, 4, (x) => (x < 2 ? [255, 0, 0, 255] : [0, 0, 255, x === 3 ? 0 : 255]));
    const cov = analyzeCoverage(img, MAP);
    expect(cov.panels).toEqual([
      { name: 'left_half', label: '左', coverage: 1, meanColor: '#ff0000' },
      { name: 'right_half', label: '右', coverage: 0.5, meanColor: '#0000ff' },
    ]);
    expect(cov.overall).toBe(0.75);
  });

  it('samples images whose resolution differs from the panel map', () => {
    const img = image(8, 8, (x) => (x < 4 ? [0, 255, 0, 255] : [0, 0, 0, 0]));
    const cov = analyzeCoverage(img, MAP);
    expect(cov.panels.map((p) => p.coverage)).toEqual([1, 0]);
  });
});

describe('checkWrap', () => {
  it('names each unfilled panel in a warning', () => {
    const img = image(4, 4, (x) => (x < 2 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
    const unfilled = checkWrap(img, MAP, [4, 4]).issues.filter((i) => i.code === 'panel_not_filled');
    expect(unfilled.map((i) => [i.panel, i.level])).toEqual([['right_half', 'warning']]);
  });
});
