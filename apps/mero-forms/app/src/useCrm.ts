import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildDelegatedClient,
  listDelegatedContexts,
  readDelegatedSession,
  relayForContext,
  resolveApplicationIdFromRegistry,
  type ExecuteTransport,
} from "@calimero-network/mero-js";
import { useMero } from "@calimero-network/mero-react";
import type { FormView, ResponseView } from "./generated/FormsClient";
import { CrmClient } from "./generated/crm/CrmClient";
import { crmPayload, existingContact } from "./lib/crm";
import { crmRefusalHint, findAccountPipelines, type Pipeline } from "./lib/pipelines";
import { REGISTRY_URL } from "./utils/invitation";
import type { Workspace } from "./useWorkspace";

export type { Pipeline } from "./lib/pipelines";

/** Mero CRM's package id: how its pipelines are told apart from other contexts. */
export const CRM_PACKAGE = "com.calimero.mero-crm";

/**
 * The transport a CRM call to `contextId` goes through.
 *
 * A node session writes through its own node, as its identity in the pipeline.
 * An account session (signed in with Calimero Cloud) writes through the relay
 * that serves the pipeline, which is not necessarily the one this app's
 * session is on: a pipeline lives in its own namespace and may be served by
 * another relay, so a client is built for that relay under the same account.
 */
function useCrmTransport(): (contextId: string) => ExecuteTransport | null {
  const { mero, isDelegated } = useMero();
  return useCallback(
    (contextId: string) => {
      if (!mero) return null;
      if (!isDelegated) return mero.rpc;
      const session = readDelegatedSession();
      if (!session) return null;
      const relayUrl = relayForContext(session.account, contextId) ?? session.relayUrl;
      if (!relayUrl) return null;
      if (relayUrl === session.relayUrl) return mero.rpc;
      return buildDelegatedClient({ ...session, relayUrl }, contextId)?.rpc ?? null;
    },
    [mero, isDelegated],
  );
}

/**
 * The Mero CRM pipelines the signed-in identity is a member of, with their
 * stages, plus any pipeline ids passed in `extra` (the form's linked one, and
 * one pasted by hand) that answer as a pipeline.
 *
 * A node session asks its node which Mero CRM contexts it has joined. An
 * account session asks every Calimero Cloud relay it knows for its contexts
 * (`listDelegatedContexts`) and keeps the Mero CRM ones. Either way only a
 * pipeline the identity is in is offered, because only that one can take a
 * deal from here.
 */
export function usePipelines(
  enabled: boolean,
  extra: string[] = [],
): {
  pipelines: Pipeline[] | null;
  error: string | null;
  reload: () => void;
} {
  const { mero, admin, isDelegated } = useMero();
  const transportFor = useCrmTransport();
  const [pipelines, setPipelines] = useState<Pipeline[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const extraKey = useMemo(() => [...new Set(extra.filter(Boolean))].sort().join(","), [extra]);

  useEffect(() => {
    if (!enabled || !mero) return;
    let live = true;

    async function found(): Promise<Pipeline[]> {
      if (isDelegated) {
        const session = readDelegatedSession();
        if (!session) return [];
        return findAccountPipelines({
          listContexts: async () =>
            (await listDelegatedContexts(session)).map((c) => ({
              id: c.id,
              applicationId: c.applicationId,
              relayUrl: c.relayUrl,
            })),
          crmApplicationId: async () =>
            (await resolveApplicationIdFromRegistry(REGISTRY_URL, CRM_PACKAGE)).applicationId,
          stagesOf: async (contextId, relayUrl) => {
            const client = buildDelegatedClient({ ...session, relayUrl }, contextId);
            if (!client) throw new Error("no relay");
            return new CrmClient(client, contextId).listStages();
          },
        });
      }
      if (!admin) return [];
      const { apps } = await admin.listApplications();
      const contextIds = new Set<string>();
      for (const app of apps.filter((a) => a.package === CRM_PACKAGE)) {
        const { contexts } = await admin.getContextsForApplication(app.id);
        for (const c of contexts) contextIds.add(c.id);
      }
      const out: Pipeline[] = [];
      for (const contextId of contextIds) {
        try {
          out.push({ contextId, stages: await new CrmClient(mero!, contextId).listStages() });
        } catch {
          // Installed here but not joined, or still syncing: not usable yet.
        }
      }
      return out;
    }

    (async () => {
      let list: Pipeline[] = [];
      let listError: string | null = null;
      try {
        list = await found();
      } catch (e) {
        listError = e instanceof Error ? e.message : String(e);
      }
      // A pipeline named by id is tried directly, so it works even when the
      // listing does not: a relay down, or a node that cannot say.
      for (const contextId of extraKey ? extraKey.split(",") : []) {
        if (list.some((p) => p.contextId === contextId)) continue;
        const transport = transportFor(contextId);
        if (!transport) continue;
        try {
          list.push({ contextId, stages: await new CrmClient(transport, contextId).listStages() });
        } catch {
          // Not a pipeline this identity can read.
        }
      }
      return { list, listError };
    })().then(({ list, listError }) => {
      if (!live) return;
      setPipelines(list);
      setError(list.length === 0 ? listError : null);
    });
    return () => {
      live = false;
    };
  }, [enabled, mero, admin, isDelegated, tick, extraKey, transportFor]);

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
  const transportFor = useCrmTransport();
  return async (form: FormView, response: ResponseView): Promise<string> => {
    const link = form.crm;
    if (!link.context_id || !link.stage_id) throw new Error("This form is not connected to a CRM pipeline.");
    const transport = transportFor(link.context_id);
    if (!transport) throw new Error("Not connected for writing yet: no node or relay to send through.");
    const crm = new CrmClient(transport, link.context_id);
    const p = crmPayload(form, response);
    let contactId: string;
    let dealId: string;
    try {
      const contacts = p.contact.email ? await crm.listContacts() : [];
      contactId = existingContact(contacts, p.contact.email)?.id ?? (await crm.createContact(p.contact));
      dealId = await crm.createDeal({
        title: p.deal.title,
        value: 0,
        organization: p.deal.organization,
        contact_id: contactId,
        stage_id: p.deal.stage_id,
        owner: null,
        expected_close: null,
        source: p.deal.source,
      });
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      throw new Error(crmRefusalHint(why) ?? why);
    }
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
