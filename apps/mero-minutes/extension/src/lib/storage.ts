/** Typed reads and writes over `chrome.storage`. */
export type Area = "local" | "session";

function area(name: Area): chrome.storage.StorageArea {
  return chrome.storage[name];
}

export async function read<T>(name: Area, key: string): Promise<T | null> {
  const got = await area(name).get(key);
  return (got[key] as T | undefined) ?? null;
}

export async function write<T>(name: Area, key: string, value: T | null): Promise<void> {
  if (value === null) await area(name).remove(key);
  else await area(name).set({ [key]: value });
}

/** Calls `onChange` with the value now and after every change, until the returned function is called. */
export function watch<T>(name: Area, key: string, onChange: (value: T | null) => void): () => void {
  let live = true;
  void read<T>(name, key).then((v) => {
    if (live) onChange(v);
  });
  const listener = (changes: Record<string, chrome.storage.StorageChange>, changed: string) => {
    if (changed !== name || !(key in changes)) return;
    onChange(((changes[key] as chrome.storage.StorageChange).newValue as T | undefined) ?? null);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    live = false;
    chrome.storage.onChanged.removeListener(listener);
  };
}
