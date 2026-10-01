// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const bytesParser = (DataBytes: any): string => {
  try {
    let asciiString = "";

    if (DataBytes instanceof Uint8Array) {
      asciiString = new TextDecoder("utf-8").decode(DataBytes);
    } else if (Array.isArray(DataBytes)) {
      const bytes = new Uint8Array(DataBytes);
      asciiString = new TextDecoder("utf-8").decode(bytes);
    } else if (typeof DataBytes === "string") {
      asciiString = DataBytes;
    } else if (DataBytes instanceof ArrayBuffer) {
      const bytes = new Uint8Array(DataBytes);
      asciiString = new TextDecoder("utf-8").decode(bytes);
    }

    return asciiString;
  } catch (e) {
    console.error(`BytesParser - Couldn't decode data:`, DataBytes, e);
    return "";
  }
};
