// Files for the image specs, as a file dialog hands them over.
import { MAX_IMAGE_BYTES } from '../../src/lib/images';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAKAAAABkCAIAAACO1KzYAAAAzklEQVR42u3TMQ3AIBCG0dJUFiMKqgZVVcCIBnQgAQGMJDc079tv+V8ujVkv/bfbBIAFWIAFWIAFWIABC7AAC7AAC7AAAxZgARZgRfacHL+5WTCmrxcfLMCABViABViABViAAQuwAAuwAAuwAAswYAEWYAEWYAEWYMACLMACLMACLMACDFiABViABViABRiwAAuwAAuwAAswYAEWYAEWYAEWYAEGLMACLMACLMDaS2NWK/hgARZgARZgARZgwAIswAIswAIswIAFWIAFWGEteyUIRfjltvgAAAAASUVORK5CYII='; // 160x100

export interface ImageFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export const pngFile = (name = 'diagram.png'): ImageFile => ({
  name,
  mimeType: 'image/png',
  buffer: Buffer.from(PNG_BASE64, 'base64'),
});

/** An SVG that claims to be a PNG by name and MIME type. */
export const svgAsPng = (): ImageFile => ({
  name: 'logo.png',
  mimeType: 'image/png',
  buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
});

/** A real PNG one byte over the cap. */
export const oversizedPng = (): ImageFile => {
  const buffer = Buffer.alloc(MAX_IMAGE_BYTES + 1);
  Buffer.from(PNG_BASE64, 'base64').copy(buffer);
  return { name: 'poster.png', mimeType: 'image/png', buffer };
};
