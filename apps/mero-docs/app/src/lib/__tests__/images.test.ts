import { describe, expect, it } from 'vitest';
import {
  MAX_IMAGE_BYTES,
  blobRef,
  checkImageFile,
  parseBlobRef,
  sniffImageType,
} from '../images';

const ID = 'ab'.repeat(32);
const bytes = (...values: (number | string)[]) =>
  new Uint8Array(
    values.flatMap((v) =>
      typeof v === 'string' ? [...v].map((c) => c.charCodeAt(0)) : [v],
    ),
  );
const PNG = bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16, 'JFIF');
const GIF = bytes('GIF89a', 1, 0, 1, 0);
const WEBP = bytes('RIFF', 36, 0, 0, 0, 'WEBPVP8 ');
const SVG = bytes('<svg xmlns="http://www.w3.org/2000/svg"/>');

const file = (data: Uint8Array, name: string, type: string) =>
  new File([data], name, { type });

describe('sniffImageType', () => {
  it('names PNG, JPEG, GIF and WebP by their leading bytes', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(GIF)).toBe('image/gif');
    expect(sniffImageType(bytes('GIF87a', 1, 0))).toBe('image/gif');
    expect(sniffImageType(WEBP)).toBe('image/webp');
  });

  it('refuses SVG, a RIFF that is not WebP, and too few bytes', () => {
    expect(sniffImageType(SVG)).toBeNull();
    expect(sniffImageType(bytes('RIFF', 36, 0, 0, 0, 'WAVEfmt '))).toBeNull();
    expect(sniffImageType(bytes(0x89, 'PN'))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe('checkImageFile', () => {
  it('takes the type from the bytes, not the name or the browser MIME', async () => {
    expect(await checkImageFile(file(PNG, 'photo.jpg', 'image/jpeg'))).toEqual({
      type: 'image/png',
    });
    expect(await checkImageFile(file(SVG, 'logo.png', 'image/png'))).toEqual({
      error: 'type',
    });
  });

  it('refuses a file over the size cap and takes one exactly at it', async () => {
    const pad = (size: number) => {
      const data = new Uint8Array(size);
      data.set(PNG);
      return file(data, 'big.png', 'image/png');
    };
    expect(await checkImageFile(pad(MAX_IMAGE_BYTES))).toEqual({
      type: 'image/png',
    });
    expect(await checkImageFile(pad(MAX_IMAGE_BYTES + 1))).toEqual({
      error: 'size',
    });
  });

  it('reports the wrong type before the size', async () => {
    const data = new Uint8Array(MAX_IMAGE_BYTES + 1);
    data.set(SVG);
    expect(await checkImageFile(file(data, 'a.svg', 'image/svg+xml'))).toEqual({
      error: 'type',
    });
  });
});

describe('blob references', () => {
  it('round-trips a blob id', () => {
    expect(parseBlobRef(blobRef(ID))).toBe(ID);
  });

  it('refuses anything that is not a blob id, so no url is ever fetched', () => {
    for (const url of [
      '',
      ID,
      `blob:${ID.toUpperCase()}`,
      `blob:${ID}0`,
      `blob:${ID.slice(1)}`,
      'blob:https://example.com/0b8c6a52-1f7e-4c1c-9d1e-1e1f2a3b4c5d',
      'https://example.com/a.png',
      'data:image/png;base64,AAAA',
      ` blob:${ID}`,
    ]) {
      expect({ url, id: parseBlobRef(url) }).toEqual({ url, id: null });
    }
  });
});
