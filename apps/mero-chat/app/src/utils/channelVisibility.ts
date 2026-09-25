import type { VisibilityMode } from "../api/groupApi";

export type ChannelVisibilityOption = "public" | "private";
// UI label only — the wire-level VisibilityMode stays "open"/"restricted".
// "Public"/"Private" reads better and matches the Public Channels /
// Private Channels category subgroups channels are routed into.
export type ChannelVisibilityLabel = "Public" | "Private";

export function getChannelVisibilityOption(
  defaultVisibility: VisibilityMode,
): ChannelVisibilityOption {
  return defaultVisibility === "restricted" ? "private" : "public";
}

export function getContextVisibilityModeFromOption(
  visibility: ChannelVisibilityOption,
): VisibilityMode {
  return visibility === "private" ? "restricted" : "open";
}

export function getChannelVisibilityOptionLabel(
  visibility: ChannelVisibilityOption,
): ChannelVisibilityLabel {
  return visibility === "private" ? "Private" : "Public";
}

export function getContextVisibilityLabel(
  visibility: VisibilityMode,
): ChannelVisibilityLabel {
  return visibility === "restricted" ? "Private" : "Public";
}

export function isRestrictedChannelType(channelType?: string): boolean {
  // Accept old "Restricted"/"Private" labels for back-compat with stored state.
  return (
    channelType === "Private" ||
    channelType === "Restricted"
  );
}
