// Opened at an older release than the one this host serves now (a saved link,
// an invite, the extension's window): go to the served one first, before the
// app reads anything from the address (`boot.tsx` takes the extension's
// handoff out of it as it loads).
import { moveToServedRelease } from "./lib/served";

void moveToServedRelease().then((leaving) => {
  if (!leaving) void import("./boot");
});
