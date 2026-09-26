/** Directions on the car. Left/right are from the driver's seat. */
export type CarDirection = 'front' | 'rear' | 'up' | 'down' | 'left' | 'right';

/** How the wrap PNG's axes land on a panel. */
export interface PanelOrientation {
  /** Car direction that the PNG's +x (rightwards) points to on this panel. */
  imageRight: CarDirection;
  /** Car direction that the PNG's "up" (towards row 0) points to on this panel. */
  imageUp: CarDirection;
  /** Which way the panel surface faces. */
  facing: CarDirection;
  /** True if artwork appears mirrored when the panel is viewed from outside the car. */
  mirrored: boolean;
}

/** A body panel as it appears in wrap-PNG space (template resolution). */
export interface Panel {
  /** Value stored in the R channel of `panels.png` for this panel's pixels. */
  index: number;
  /** Stable machine name, e.g. `door_front_left`. Left/right are from the driver's seat. */
  name: string;
  /** Human-readable Chinese label. */
  label: string;
  description: string;
  /** [x, y, width, height] in template pixels. */
  bbox: [number, number, number, number];
  /** Pixel centroid in template pixels. */
  center: [number, number];
  pixels: number;
  orientation: PanelOrientation;
}

export interface PanelsFile {
  vehicle: string;
  width: number;
  height: number;
  source: { repo: string; commit: string; files: Record<string, string> };
  panels: Panel[];
}

/**
 * Per-pixel panel lookup at template resolution. `labels[y * width + x]` is a panel index or 0.
 */
export interface PanelMap {
  width: number;
  height: number;
  labels: Uint8Array;
  panels: Panel[];
}

export function panelMapFromRgba(file: PanelsFile, rgba: Uint8Array | Uint8ClampedArray): PanelMap {
  const labels = new Uint8Array(file.width * file.height);
  for (let i = 0; i < labels.length; i++) labels[i] = rgba[i * 4 + 3] ? rgba[i * 4] : 0;
  return { width: file.width, height: file.height, labels, panels: file.panels };
}
