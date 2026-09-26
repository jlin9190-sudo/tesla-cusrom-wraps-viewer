import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import type { WrapImage } from '../src/core/check.ts';

export class UsageError extends Error {}

/** Reads and decodes a wrap PNG. Throws UsageError when the file is missing or not decodable. */
export async function readWrapImage(file: string): Promise<{ image: WrapImage; bytes: Buffer }> {
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch {
    throw new UsageError(`Cannot read file: ${file}`);
  }
  let png: PNG;
  try {
    png = PNG.sync.read(bytes);
  } catch (err) {
    throw new UsageError(`Cannot decode ${file} as PNG: ${(err as Error).message}`);
  }
  const { size } = await stat(file);
  return {
    bytes,
    image: {
      fileName: path.basename(file),
      fileSize: size,
      header: new Uint8Array(bytes.subarray(0, 8)),
      width: png.width,
      height: png.height,
      rgba: png.data,
    },
  };
}
