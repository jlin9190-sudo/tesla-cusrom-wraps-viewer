import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const DIST_DIR = path.join(ROOT, 'dist');
export const CUSTOM_WRAPS_DIR = path.join(PUBLIC_DIR, 'custom-wraps');
