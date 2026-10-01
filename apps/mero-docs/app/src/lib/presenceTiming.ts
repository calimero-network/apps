// Shared by every presence writer and reader: the node replays a closed tab's
// last slice indefinitely, so a live tab re-announces and readers age out the rest.

export const PRESENCE_BEAT_MS = 10_000; // how often an open tab refreshes its slice
export const PRESENCE_STALE_MS = 25_000; // older than this and the tab is gone
export const PRESENCE_LEAVE_REPEAT_MS = 1_000; // a caret write still in flight can land after the first leave
