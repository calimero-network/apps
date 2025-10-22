/**
 * Safe localStorage wrapper with error handling and type safety
 */

export class StorageHelper {
  /**
   * Safely get an item from localStorage
   */
  static getItem<T = string>(key: string, defaultValue?: T): T | null {
    try {
      const item = localStorage.getItem(key);
      if (item === null) {
        return defaultValue ?? null;
      }
      // Try to parse as JSON if it looks like JSON
      if (
        (item.startsWith("{") || item.startsWith("[")) &&
        defaultValue !== undefined
      ) {
        try {
          return JSON.parse(item) as T;
        } catch {
          // If parsing fails, return as-is (for backward compatibility)
          return item as unknown as T;
        }
      }
      return item as unknown as T;
    } catch (error) {
      console.error(`Error reading from localStorage (key: ${key}):`, error);
      return defaultValue ?? null;
    }
  }

  /**
   * Safely set an item in localStorage
   */
  static setItem<T>(key: string, value: T): boolean {
    try {
      const stringValue =
        typeof value === "string" ? value : JSON.stringify(value);
      localStorage.setItem(key, stringValue);
      return true;
    } catch (error) {
      console.error(`Error writing to localStorage (key: ${key}):`, error);
      return false;
    }
  }

  /**
   * Safely remove an item from localStorage
   */
  static removeItem(key: string): boolean {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (error) {
      console.error(`Error removing from localStorage (key: ${key}):`, error);
      return false;
    }
  }

  /**
   * Safely clear all localStorage
   */
  static clear(): boolean {
    try {
      localStorage.clear();
      return true;
    } catch (error) {
      console.error("Error clearing localStorage:", error);
      return false;
    }
  }

  /**
   * Check if localStorage is available
   */
  static isAvailable(): boolean {
    try {
      const testKey = "__storage_test__";
      localStorage.setItem(testKey, "test");
      localStorage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get JSON item with validation
   */
  static getJSON<T>(
    key: string,
    validator?: (data: unknown) => boolean,
  ): T | null {
    try {
      const item = localStorage.getItem(key);
      if (!item) return null;

      const parsed = JSON.parse(item) as T;

      if (validator && !validator(parsed)) {
        console.warn(`Validation failed for localStorage key: ${key}`);
        return null;
      }

      return parsed;
    } catch (error) {
      console.error(
        `Error parsing JSON from localStorage (key: ${key}):`,
        error,
      );
      return null;
    }
  }

  /**
   * Set JSON item
   */
  static setJSON<T>(key: string, value: T): boolean {
    return this.setItem(key, value);
  }
}
