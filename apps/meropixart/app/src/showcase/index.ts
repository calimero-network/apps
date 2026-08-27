// The bundled showcase documents, in picker order.
//
// Each one is a recipe (see ./types) rather than a bitmap, so together they add a
// few kB to the bundle and render crisp at any canvas size.

import { aurora } from "./projects/aurora";
import { ridge } from "./projects/ridge";
import { bauhaus } from "./projects/bauhaus";
import { transformLab } from "./projects/transformLab";
import type { ShowcaseProject } from "./types";

export const SHOWCASE_PROJECTS: ShowcaseProject[] = [aurora, ridge, bauhaus, transformLab];

export function findShowcase(id: string): ShowcaseProject | undefined {
  return SHOWCASE_PROJECTS.find((p) => p.id === id);
}

export type { ShowcaseProject } from "./types";
