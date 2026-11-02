import type { CrmLink } from "../formsApi";

/**
 * A form's link to a Mero CRM pipeline. What a response becomes there (a
 * contact, a deal, a note with every answer) is built by the contract now,
 * in `sendToCrm` (`logic/src/lib.rs`, `crm_payload`, v1's `crmPayload`).
 */
export const isLinked = (link: CrmLink) => link.context_id !== "" && link.stage_id !== "";

export const NO_LINK: CrmLink = {
  context_id: "",
  stage_id: "",
  name_field: "",
  email_field: "",
  phone_field: "",
  organization_field: "",
  title_field: "",
};
