import { useEffect, useMemo, useState } from "react";
import { CrmClient } from "./crmApi";
import type { FormView, ResponseView } from "./formsApi";
import { findPipelines, type Pipeline } from "./lib/pipelines";
import { useSignedIn } from "./sessionContext";
import type { Workspace } from "./useWorkspace";

export type { Pipeline } from "./lib/pipelines";

/** Mero CRM's package id: how its instances (pipelines) are told apart from other apps. */
export const CRM_PACKAGE = "com.calimero.mero-crm";

/**
 * The Mero CRM pipelines the signed-in account reaches, with their stages,
 * plus any pipeline ids passed in `extra` (the form's linked one, and one
 * pasted by hand) that answer as a pipeline.
 *
 * v1 asked the node which Mero CRM contexts it had joined, or every Calimero
 * Cloud relay an account session knew. On Calimero 1.0 the account reaches
 * every instance of every org it is in, so this is one `listApps` by package.
 */
export function usePipelines(
  enabled: boolean,
  extra: string[] = [],
): {
  pipelines: Pipeline[] | null;
  error: string | null;
  reload: () => void;
} {
  const { client, after } = useSignedIn();
  const [pipelines, setPipelines] = useState<Pipeline[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const extraKey = useMemo(() => [...new Set(extra.filter(Boolean))].sort().join(","), [extra]);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    findPipelines(
      {
        listInstances: async () =>
          (await client.listApps({ package: CRM_PACKAGE })).map((a) => ({ appId: a.appId, name: a.name })),
        stagesOf: (appId) => new CrmClient(client, appId, after).listStages(),
      },
      extraKey ? extraKey.split(",") : [],
    ).then((found) => {
      if (!live) return;
      setPipelines(found.pipelines);
      setError(found.error);
    });
    return () => {
      live = false;
    };
  }, [enabled, client, after, tick, extraKey]);

  return { pipelines, error, reload: () => setTick((t) => t + 1) };
}

/**
 * Sends one response to the form's CRM pipeline, from the contract
 * (`sendToCrm`): one cross-app call from this workspace to the pipeline's
 * instance, in which Mero CRM reuses the contact with the same email or
 * creates one, creates a deal in the chosen stage and puts every answer in a
 * note on it; the deal is then recorded here in the same call, so the
 * response reads as sent for the whole team. Returns the deal's id.
 *
 * Both instances must be in the same organization (cross-app calls stay
 * inside one), and Mero CRM must allow the call (`importFormResponse`).
 */
export function useSendToCrm(workspace: Workspace) {
  return async (form: FormView, response: ResponseView): Promise<string> => {
    const link = form.crm;
    if (!link.context_id || !link.stage_id) throw new Error("This form is not connected to a CRM pipeline.");
    const sent = await workspace.act((c) => c.sendToCrm({ id: response.id }));
    return sent.crm_deal;
  };
}
