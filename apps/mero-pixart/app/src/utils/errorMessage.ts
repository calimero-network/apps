import { AppError } from "@calimero-network/mero-js";
import { describeError } from "@calimero-apps/connect";

/**
 * Pull a human-readable message out of an unknown thrown error.
 *
 * A contract refusal is an `AppError` whose `fields.message` (or the other
 * fields) is the contract's own words; everything else is mero-js's typed
 * error, which `describeError` puts in one line.
 */
export function extractErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (typeof err === "string") return err.trim() || fallback;
  if (err === null || err === undefined) return fallback;
  if (err instanceof AppError) {
    const fields = (err.fields ?? {}) as Record<string, unknown>;
    if (typeof fields.message === "string" && fields.message.trim()) return fields.message.trim();
    if (err.appCode === "UnknownBlob") return "An image tile was not uploaded. Try again.";
    if (err.appCode === "TooMany") return "This document holds as many layers as it can (500).";
  }
  const msg = describeError(err).trim();
  return msg || fallback;
}

/** Friendlier copy for the refusals people actually meet when creating projects. */
export function humanizeError(msg: string): string {
  if (/CREATE_APP|forbidden|not allowed|capabilit/i.test(msg)) {
    return "You don't have permission to create projects in this team. Ask a team admin.";
  }
  return msg;
}
