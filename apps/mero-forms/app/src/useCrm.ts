import { useEffect, useMemo, useState } from "react";
import { CrmClient } from "./crmApi";
import type { FormView, ResponseView } from "./formsApi";
import { crmPayload, existingContact } from "./lib/crm";
import { findPipelines, type Pipeline } from "./lib/pipelines";
import { useSignedIn } from "./sessionContext";
import type { Workspace } from "./useWorkspace";
import { listAppInfos } from "@calimero-apps/connect";

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
          (await listAppInfos(client, { package: CRM_PACKAGE })).map((a) => ({ appId: a.appId, name: a.name })),
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
 * Sends one response to the form's CRM pipeline: reuses the contact with the
 * same email or creates one, creates a deal for them in the chosen stage,
 * puts every answer in a note on it, then records the deal here so the
 * response reads as sent.
 *
 * Not atomic: two app instances share no transaction. A failure after the
 * deal exists leaves the response unmarked, and the error says so; the deal is
 * then in the CRM and sending again makes a second one.
 */
export function useSendToCrm(workspace: Workspace) {
  const { client, after } = useSignedIn();
  return async (form: FormView, response: ResponseView): Promise<string> => {
    const link = form.crm;
    if (!link.context_id || !link.stage_id) throw new Error("This form is not connected to a CRM pipeline.");
    const crm = new CrmClient(client, link.context_id, after);
    const p = crmPayload(form, response);
    const contacts = p.contact.email ? await crm.listContacts() : [];
    const contactId = existingContact(contacts, p.contact.email)?.id ?? (await crm.createContact(p.contact));
    const dealId = await crm.createDeal({
      title: p.deal.title,
      organization: p.deal.organization,
      contact_id: contactId,
      stage_id: p.deal.stage_id,
      source: p.deal.source,
    });
    try {
      await crm.addNote({ deal_id: dealId, body: p.note });
      await workspace.act((c) =>
        c.recordCrmDeal({ id: response.id, crm_context: link.context_id, crm_deal: dealId }),
      );
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      throw new Error(`The deal was created in the CRM, but finishing the hand-off failed: ${why}`);
    }
    return dealId;
  };
}
