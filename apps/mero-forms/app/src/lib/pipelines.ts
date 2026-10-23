import type { StageView } from "../generated/crm/CrmClient";

/** A Mero CRM pipeline the hand-off can write to. */
export interface Pipeline {
  contextId: string;
  stages: StageView[];
  /**
   * The relay that serves it, for an account session: a deal is written
   * through that relay under this account's warrant. Absent for a node
   * session, which writes through its own node.
   */
  relayUrl?: string;
}

/** A context the account is in, as `listDelegatedContexts` lists it. */
export interface ListedContext {
  id: string;
  applicationId: string;
  relayUrl: string;
}

/** What finding an account's pipelines needs; all of it injected, so it is testable. */
export interface AccountPipelineDeps {
  /** The account's contexts on every relay it knows. */
  listContexts: () => Promise<ListedContext[]>;
  /** Mero CRM's application id from the registry, or null when the registry cannot say. */
  crmApplicationId: () => Promise<string | null>;
  /** A pipeline's stages, read through `relayUrl`; throws when the context is not a pipeline. */
  stagesOf: (contextId: string, relayUrl: string) => Promise<StageView[]>;
}

/**
 * Most contexts to try when the registry cannot say which are Mero CRM: each
 * is one read through a relay, and an account in dozens of contexts should not
 * pay for all of them to open one tab.
 */
export const MAX_PROBES = 25;

/**
 * The Mero CRM pipelines an account is in, across every relay it knows.
 *
 * Which contexts are Mero CRM is decided by application id: core derives it
 * from the package and its publisher, so the registry's id for
 * `com.calimero.mero-crm` is the one every install of it carries. When the
 * registry cannot be reached, each context is tried as a pipeline instead
 * (up to {@link MAX_PROBES}), and the ones that answer `list_stages` are kept.
 */
export async function findAccountPipelines(deps: AccountPipelineDeps): Promise<Pipeline[]> {
  const [contexts, crmId] = await Promise.all([
    deps.listContexts(),
    deps.crmApplicationId().catch(() => null),
  ]);
  const seen = new Set<string>();
  const candidates = contexts
    .filter((c) => (crmId ? c.applicationId.toLowerCase() === crmId.toLowerCase() : true))
    .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
    .slice(0, crmId ? undefined : MAX_PROBES);
  const out: Pipeline[] = [];
  for (const c of candidates) {
    try {
      out.push({ contextId: c.id, stages: await deps.stagesOf(c.id, c.relayUrl), relayUrl: c.relayUrl });
    } catch {
      // Not a pipeline after all, or its relay did not answer: not usable now.
    }
  }
  return out;
}

/** A pasted pipeline id, tidied: 64 hex, or null. */
export function parsePipelineId(input: string): string | null {
  const id = input.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(id) ? id : null;
}

/**
 * Why a relay refused a CRM write, in words someone can act on.
 *
 * Mero CRM stamps who created each contact and deal in an entry only that
 * account owns, and core lets a relay sign such an entry on someone's behalf
 * only when it is an attested TEE relay (a `RelayTee`). Calimero Cloud's relays
 * are; a team's own node relaying is not.
 */
export function crmRefusalHint(message: string): string | null {
  if (/RelayTee|on a member's behalf/i.test(message)) {
    return "This relay cannot write Mero CRM records on your behalf: only a Calimero Cloud relay can. Send from a Calimero Cloud sign-in, or from a node that is a member of the pipeline.";
  }
  return null;
}
