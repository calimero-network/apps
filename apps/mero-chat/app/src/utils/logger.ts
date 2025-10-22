/**
 * Centralized logging utility with environment-based controls
 */

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

class Logger {
  private static instance: Logger;
  private logLevel: LogLevel;
  private isDevelopment: boolean;

  private constructor() {
    this.isDevelopment = import.meta.env.DEV;
    this.logLevel = this.isDevelopment ? LogLevel.DEBUG : LogLevel.WARN;
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return level <= this.logLevel;
  }

  private formatMessage(
    level: string,
    context: string,
    message: string,
  ): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] [${context}] ${message}`;
  }

  error(context: string, message: string, error?: unknown): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      const formattedMsg = this.formatMessage("ERROR", context, message);
      if (error) {
        console.error(formattedMsg, error);
      } else {
        console.error(formattedMsg);
      }
    }
  }

  warn(context: string, message: string, data?: unknown): void {
    if (this.shouldLog(LogLevel.WARN)) {
      const formattedMsg = this.formatMessage("WARN", context, message);
      if (data) {
        console.warn(formattedMsg, data);
      } else {
        console.warn(formattedMsg);
      }
    }
  }

  info(context: string, message: string, data?: unknown): void {
    if (this.shouldLog(LogLevel.INFO)) {
      const formattedMsg = this.formatMessage("INFO", context, message);
      if (data) {
        console.log(formattedMsg, data);
      } else {
        console.log(formattedMsg);
      }
    }
  }

  debug(context: string, message: string, data?: unknown): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      const formattedMsg = this.formatMessage("DEBUG", context, message);
      if (data) {
        console.log(formattedMsg, data);
      } else {
        console.log(formattedMsg);
      }
    }
  }

  /**
   * Performance timing helper
   */
  time(label: string): void {
    if (this.isDevelopment) {
      console.time(label);
    }
  }

  timeEnd(label: string): void {
    if (this.isDevelopment) {
      console.timeEnd(label);
    }
  }

  /**
   * Group logs together
   */
  group(label: string): void {
    if (this.isDevelopment) {
      console.group(label);
    }
  }

  groupEnd(): void {
    if (this.isDevelopment) {
      console.groupEnd();
    }
  }
}

// Export singleton instance
export const logger = Logger.getInstance();

// Export convenience methods
export const log = {
  error: (context: string, message: string, error?: unknown) =>
    logger.error(context, message, error),
  warn: (context: string, message: string, data?: unknown) =>
    logger.warn(context, message, data),
  info: (context: string, message: string, data?: unknown) =>
    logger.info(context, message, data),
  debug: (context: string, message: string, data?: unknown) =>
    logger.debug(context, message, data),
  time: (label: string) => logger.time(label),
  timeEnd: (label: string) => logger.timeEnd(label),
  group: (label: string) => logger.group(label),
  groupEnd: () => logger.groupEnd(),
};
