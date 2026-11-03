import type { StageView } from "../crmApi";

/**
 * A Mero CRM pipeline the hand-off can write to: an instance of Mero CRM the
 * signed-in account reaches. v1 called it a context; `contextId` keeps that
 * name because the form's CRM link stores it as `context_id`.
 */
export interface Pipeline {
  /** The Mero CRM app instance id. */
  contextId: string;
  /** The instance's name, or empty. */
  name: string;
  stages: StageView[];
}

/** What finding pipelines needs; all of it injected, so it is testable. */
export interface PipelineDeps {
  /** The Mero CRM instances the account reaches (`listApps({ package })`). */
  listInstances: () => Promise<Array<{ appId: string; name: string }>>;
  /** A pipeline's stages; throws when the instance is not one the account can read. */
  stagesOf: (appId: string) => Promise<StageView[]>;
}

/**
 * The Mero CRM pipelines the account can write to, plus any ids in `extra`
 * (the form's linked one, and one pasted by hand) that answer as a pipeline.
 * An id named directly is tried even when listing fails, so a pipeline in
 * another org, or created from a dev bundle, still works.
 */
export async function findPipelines(
  deps: PipelineDeps,
  extra: string[] = [],
): Promise<{ pipelines: Pipeline[]; error: string | null }> {
  const out: Pipeline[] = [];
  let error: string | null = null;
  let listed: Array<{ appId: string; name: string }> = [];
  try {
    listed = await deps.listInstances();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const candidates = new Map<string, string>();
  for (const a of listed) candidates.set(a.appId, a.name);
  for (const id of extra) if (id && !candidates.has(id)) candidates.set(id, "");
  for (const [appId, name] of candidates) {
    try {
      out.push({ contextId: appId, name, stages: await deps.stagesOf(appId) });
    } catch {
      // Not a pipeline this account can read.
    }
  }
  return { pipelines: out, error: out.length === 0 ? error : null };
}

/** A pasted pipeline (app instance) id, tidied, or null. */
export function parsePipelineId(input: string): string | null {
  const id = input.trim();
  return id && id.length <= 256 && !/\s/.test(id) ? id : null;
}
