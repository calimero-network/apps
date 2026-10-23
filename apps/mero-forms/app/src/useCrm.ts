import { useEffect, useState } from "react";
import { useMero } from "@calimero-network/mero-react";
import type { FormView, ResponseView } from "./generated/FormsClient";
import { CrmClient, type StageView } from "./generated/crm/CrmClient";
import { crmPayload, existingContact } from "./lib/crm";
import type { Workspace } from "./useWorkspace";

/** Mero CRM's package id: how its pipelines are found among this node's contexts. */
export const CRM_PACKAGE = "com.calimero.mero-crm";

export interface Pipeline {
  contextId: string;
  stages: StageView[];
}

/**
 * The Mero CRM pipelines this node is a member of, with their stages.
 *
 * Read from the node, not from this app's state: a pipeline is another app's
 * context, and the hand-off writes to it as this node's identity there. A
 * pipeline the node is not in cannot take a deal from here, so it is not
 * offered. An account session has no node to ask, and gets none.
 */
export function usePipelines(enabled: boolean): {
  pipelines: Pipeline[] | null;
  error: string | null;
  reload: () => void;
} {
  const { mero, admin, isDelegated } = useMero();
  const [pipelines, setPipelines] = useState<Pipeline[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled || !mero || !admin) return;
    if (isDelegated) {
      setPipelines([]);
      return;
    }
    let live = true;
    (async () => {
      const { apps } = await admin.listApplications();
      const crmApps = apps.filter((a) => a.package === CRM_PACKAGE);
      const contextIds = new Set<string>();
      for (const app of crmApps) {
        const { contexts } = await admin.getContextsForApplication(app.id);
        for (const c of contexts) contextIds.add(c.id);
      }
      const out: Pipeline[] = [];
      for (const contextId of contextIds) {
        try {
          const stages = await new CrmClient(mero, contextId).listStages();
          out.push({ contextId, stages });
        } catch {
          // Installed here but not joined, or still syncing: not usable yet.
        }
      }
      return out;
    })()
      .then((p) => {
        if (!live) return;
        setPipelines(p ?? []);
        setError(null);
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [enabled, mero, admin, isDelegated, tick]);

  return { pipelines, error, reload: () => setTick((t) => t + 1) };
}

/**
 * Sends one response to the form's CRM pipeline: reuses the contact with the
 * same email or creates one, creates a deal for them in the chosen stage,
 * puts every answer in a note on it, then records the deal here so the
 * response reads as sent.
 *
 * Not atomic: two apps' contexts cannot share a transaction. A failure after
 * the deal exists leaves the response unmarked, and the error says so; the
 * deal is then in the CRM and sending again makes a second one.
 */
export function useSendToCrm(workspace: Workspace) {
  const { mero } = useMero();
  return async (form: FormView, response: ResponseView): Promise<string> => {
    if (!mero) throw new Error("Not connected to a node yet.");
    const link = form.crm;
    if (!link.context_id || !link.stage_id) throw new Error("This form is not connected to a CRM pipeline.");
    const crm = new CrmClient(mero, link.context_id);
    const p = crmPayload(form, response);
    const contacts = p.contact.email ? await crm.listContacts() : [];
    const contactId = existingContact(contacts, p.contact.email)?.id ?? (await crm.createContact(p.contact));
    const dealId = await crm.createDeal({
      title: p.deal.title,
      value: 0,
      organization: p.deal.organization,
      contact_id: contactId,
      stage_id: p.deal.stage_id,
      owner: null,
      expected_close: null,
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
