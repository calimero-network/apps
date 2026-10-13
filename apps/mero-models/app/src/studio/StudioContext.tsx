import { createContext, useContext } from "react";
import type { SceneSync } from "../editor/sync";
import type { TextureCache } from "../editor/textures";

/** What the panels need from the open scene beyond the store: the network and the texture cache. */
export interface StudioServices {
  sync: SceneSync | null;
  textures: TextureCache | null;
}

export const StudioContext = createContext<StudioServices>({ sync: null, textures: null });

export function useStudio(): StudioServices {
  return useContext(StudioContext);
}
