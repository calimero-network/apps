import { describe, expect, it } from "vitest";
import { MAX_ATTACHMENTS, MAX_IMAGE_BYTES, refuseImage, uploadImage } from "./attachments";

const file = (type: string, size: number, name = "x.png") => ({ name, type, size });

describe("images on a message", () => {
  it("takes the image types your agent can read, up to 10 MB", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
      expect(refuseImage(file(type, 1), 0)).toBeNull();
    }
    expect(refuseImage(file("image/png", MAX_IMAGE_BYTES), 0)).toBeNull();
  });

  it("says why it turns one away", () => {
    expect(refuseImage(file("image/svg+xml", 10, "logo.svg"), 0)).toMatch(/logo\.svg isn't a PNG/);
    expect(refuseImage(file("image/png", 0, "blank.png"), 0)).toBe("blank.png is empty.");
    expect(refuseImage(file("image/png", MAX_IMAGE_BYTES + 1, "big.png"), 0)).toMatch(/big\.png is 10\.0 MB/);
    expect(refuseImage(file("image/png", 1), MAX_ATTACHMENTS)).toBe("At most 4 images per message.");
    expect(refuseImage(file("text/plain", 1, ""), 0)).toMatch(/^That image isn't/);
  });

  it("describes an uploaded image the way say_with takes it", async () => {
    const stored: Blob[] = [];
    const store = {
      upload: async (data: Blob) => (stored.push(data), { blobId: "ab".repeat(32), size: data.size }),
      read: async () => new Blob(),
    };
    const picked = new File([new Uint8Array(5)], "shot.png", { type: "image/png" });
    expect(await uploadImage(store, picked)).toEqual({ blob_id: "ab".repeat(32), name: "shot.png", mime: "image/png", size: 5 });
    expect(stored).toEqual([picked]);
  });
});
