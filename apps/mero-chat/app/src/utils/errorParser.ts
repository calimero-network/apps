// A contract's `app::bail!` message reaches the client behind this prefix:
// as text from core rc.81 on, as a decimal byte list from older nodes.
const CORE_PREFIX = "the method call returned an error: ";

/** The numbers in `[34, 65, ...]`, or null when `list` is not such a list. */
function parseByteList(list: string): number[] | null {
  const m = /^\[([\d,\s]+)\]$/.exec(list.trim());
  if (!m) return null;
  const numbers = m[1].split(",").map((num) => parseInt(num.trim()));
  if (numbers.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
    return null;
  return numbers;
}

export function parseErrorMessage(errorMessage: string | number[]): string {
  if (typeof errorMessage === "string") {
    const at = errorMessage.indexOf(CORE_PREFIX);
    if (at !== -1) {
      const rest = errorMessage.slice(at + CORE_PREFIX.length).trim();
      const bytes = parseByteList(rest);
      if (!bytes) return rest || errorMessage;
      try {
        return new TextDecoder().decode(new Uint8Array(bytes));
      } catch (error) {
        console.error("Failed to parse array from string:", error);
        return errorMessage;
      }
    }
    // Look for array pattern in the string (e.g., "[34, 65, ...]")
    const arrayMatch = errorMessage.match(/\[([\d,\s]+)\]/);
    if (arrayMatch) {
      try {
        const arrayString = arrayMatch[1];
        const numberArray = arrayString
          .split(",")
          .map((num) => parseInt(num.trim()));

        const messageData = new Uint8Array(numberArray);
        return new TextDecoder().decode(messageData);
      } catch (error) {
        console.error("Failed to parse array from string:", error);
        return errorMessage;
      }
    }
    return errorMessage;
  }

  if (Array.isArray(errorMessage)) {
    try {
      const messageData = new Uint8Array(errorMessage);
      return new TextDecoder().decode(messageData);
    } catch (error) {
      console.error("Failed to parse error message:", error);
      return "An unknown error occurred";
    }
  }

  return "An unknown error occurred";
}

export function extractErrorMessage(error: unknown): string {
  if (!error) {
    return "An unknown error occurred";
  }

  if (typeof error === "object" && error !== null) {
    const errorObj = error as Record<string, unknown>;

    if (
      errorObj.message &&
      (typeof errorObj.message === "string" || Array.isArray(errorObj.message))
    ) {
      return parseErrorMessage(errorObj.message as string | number[]);
    }

    if (
      errorObj.error &&
      (typeof errorObj.error === "string" || Array.isArray(errorObj.error))
    ) {
      return parseErrorMessage(errorObj.error as string | number[]);
    }
  }

  if (typeof error === "string") {
    return error;
  }

  return "An unknown error occurred";
}
