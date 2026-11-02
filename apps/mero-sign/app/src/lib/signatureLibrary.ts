import type { ClientApiDataSource } from '../api/dataSource/ClientApiDataSource';
import type { SignatureRecord } from '../api/clientApi';

/** A saved signature as the pickers show it. */
export interface LibrarySignature {
  id: string;
  name: string;
  dataURL: string;
  createdAt: string;
}

function toDataURL(bytes: Uint8Array, type = 'image/png'): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(new Blob([bytes as BlobPart], { type }));
  });
}

/**
 * The library's signatures with their images, which are blobs of the
 * personal library. A row whose image does not load still lists (named, no
 * picture), and the failure is logged rather than hidden.
 */
export async function withImages(
  api: Pick<ClientApiDataSource, 'downloadBlob'>,
  rows: SignatureRecord[],
): Promise<LibrarySignature[]> {
  return Promise.all(
    rows.map(async (sig) => {
      let dataURL = '';
      const res = await api.downloadBlob(sig.blob_id);
      if (res.error) console.error(`Could not load signature image ${sig.blob_id}:`, res.error.message);
      else dataURL = await toDataURL(res.data);
      return {
        id: String(sig.id),
        name: sig.name,
        dataURL,
        createdAt: new Date(sig.created_at).toLocaleDateString(),
      };
    }),
  );
}

/** Saves a drawn signature (a data URL) to the library: the image as a blob, then the row. */
export async function saveSignature(
  api: Pick<ClientApiDataSource, 'uploadBlob' | 'createSignature'>,
  dataURL: string,
  name: string,
): Promise<number> {
  const bytes = dataURLBytes(dataURL);
  const uploaded = await api.uploadBlob(bytes);
  if (uploaded.error) throw new Error(uploaded.error.message);
  const created = await api.createSignature(name, uploaded.data.id, bytes.length);
  if (created.error) throw new Error(created.error.message);
  return created.data;
}

/** The bytes a `data:` URL carries (base64). */
export function dataURLBytes(dataURL: string): Uint8Array {
  const b64 = dataURL.slice(dataURL.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
