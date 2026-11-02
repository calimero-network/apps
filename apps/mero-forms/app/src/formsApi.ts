import type { CalimeroClient } from "@calimero-network/mero-js";

/**
 * The forms contract, typed (no client is generated from a component ABI
 * yet), and the ONE place its answers are adapted to the shapes the screens
 * use.
 *
 * The screens were written against v1's generated `FormsClient`: snake_case
 * argument objects and results, plain numbers. The component contract takes
 * camelCase arguments and answers camelCase records with 64-bit integers as
 * decimal strings. This class keeps v1's method names and shapes and converts
 * both ways, so the screens stay as they were. Timestamps are now milliseconds
 * (v1's were nanoseconds).
 *
 * A refusal comes back as an `AppError` (`appCode` + `fields.message`). It is
 * rethrown as a plain `Error` carrying v1's message, which is what the screens
 * show and what `publicRefusal` matches on.
 *
 * `formsApi.test.ts` asserts CALLS and VIEWS are exactly the committed
 * `logic/res/abi.json`'s, with the same parameter names.
 */
export const CALLS = [
  "addTeamMember",
  "clearCaptchaSecret",
  "createForm",
  "createLink",
  "deleteForm",
  "deleteLink",
  "forgetFormKey",
  "recordCrmDeal",
  "registerFormKey",
  "removeTeamMember",
  "sendToCrm",
  "setArchived",
  "setCaptchaKey",
  "setCaptchaSecret",
  "setCaptchaSiteKey",
  "setCrmLink",
  "setFormOpen",
  "setFormPublic",
  "setLinkCap",
  "setWorkspaceName",
  "submitResponse",
  "submitViaLink",
  "updateForm",
] as const;
export const VIEWS = [
  "amIAdmin",
  "amITeam",
  "captchaSettings",
  "fieldKinds",
  "getForm",
  "getResponse",
  "linkForm",
  "listFormKeys",
  "listForms",
  "listLinks",
  "listResponses",
  "listTeam",
  "myAccount",
  "workspaceName",
] as const;

type Call = (typeof CALLS)[number];
/** Responses one `listResponses` page asks for. */
export const RESPONSE_PAGE = 500;
type View = (typeof VIEWS)[number];

// ── what the screens use (v1's shapes) ───────────────────────────────────────

export interface Field {
  id: string;
  kind: string;
  label: string;
  help: string;
  required: boolean;
  options: string[];
}

export interface CrmLink {
  /** The Mero CRM app instance (v1: context) the deals go to. */
  context_id: string;
  stage_id: string;
  name_field: string;
  email_field: string;
  phone_field: string;
  organization_field: string;
  title_field: string;
}

export interface AnswerInput {
  field_id: string;
  values: string[];
}

export interface Answer {
  field_id: string;
  label: string;
  kind: string;
  values: string[];
}

export interface CaptchaPass {
  nonce: string;
  expires_ms: number;
  signature: string;
}

export interface CaptchaSettings {
  site_key: string;
  secret_set: boolean;
  tee_available: boolean;
  needs_resealing: boolean;
}

export interface FormView {
  id: string;
  title: string;
  description: string;
  fields: Field[];
  open: boolean;
  crm: CrmLink;
  public: boolean;
  link_cap: number;
  captcha_key: string;
  /** Unix milliseconds. */
  created_at: number;
  created_by: string;
  updated_at: number;
}

export interface LinkFormView {
  form_id: string;
  title: string;
  description: string;
  fields: Field[];
  accepting: boolean;
  captcha: boolean;
  captcha_by_node: boolean;
  captcha_site_key: string;
}

export interface LinkView {
  /** The SHA-256 (hex) of the link's token. */
  id: string;
  form_id: string;
  label: string;
  created_at: number;
  created_by: string;
  responses: number;
  last_hour: number;
  last_response_at: number;
}

export interface FormSummary {
  id: string;
  title: string;
  description: string;
  open: boolean;
  fields: number;
  responses: number;
  new_responses: number;
  last_response_at: number;
  created_at: number;
}

export interface ResponseView {
  id: string;
  form_id: string;
  answers: Answer[];
  source: string;
  created_at: number;
  submitted_by: string;
  link: string;
  archived: boolean;
  crm_context: string;
  crm_deal: string;
  crm_sent_at: number;
  crm_sent_by: string;
}

export interface FormKeyView {
  /** The form key's API key id. */
  account: string;
  label: string;
  form_id: string;
  created_at: number;
  created_by: string;
  responses: number;
  last_response_at: number;
}

export interface TeamMember {
  account: string;
  admin: boolean;
}

// ── the wire ─────────────────────────────────────────────────────────────────

type Raw = Record<string, unknown>;

/** A decimal string as a number. Millisecond timestamps are well inside 2^53. */
export function int(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value !== "") return Number(value);
  return 0;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const list = <T>(v: unknown, f: (x: Raw) => T): T[] => (Array.isArray(v) ? (v as Raw[]).map(f) : []);

export const toField = (f: Raw): Field => ({
  id: str(f.id),
  kind: str(f.kind),
  label: str(f.label),
  help: str(f.help),
  required: f.required === true,
  options: Array.isArray(f.options) ? (f.options as string[]) : [],
});

const fromField = (f: Field) => ({
  id: f.id,
  kind: f.kind,
  label: f.label,
  help: f.help,
  required: f.required,
  options: f.options,
});

export const toCrmLink = (l: Raw | undefined): CrmLink => ({
  context_id: str(l?.contextId),
  stage_id: str(l?.stageId),
  name_field: str(l?.nameField),
  email_field: str(l?.emailField),
  phone_field: str(l?.phoneField),
  organization_field: str(l?.organizationField),
  title_field: str(l?.titleField),
});

const fromCrmLink = (l: CrmLink) => ({
  contextId: l.context_id,
  stageId: l.stage_id,
  nameField: l.name_field,
  emailField: l.email_field,
  phoneField: l.phone_field,
  organizationField: l.organization_field,
  titleField: l.title_field,
});

const toAnswer = (a: Raw): Answer => ({
  field_id: str(a.fieldId),
  label: str(a.label),
  kind: str(a.kind),
  values: Array.isArray(a.values) ? (a.values as string[]) : [],
});

const fromAnswers = (answers: AnswerInput[]) => answers.map((a) => ({ fieldId: a.field_id, values: a.values }));

export const toFormView = (f: Raw): FormView => ({
  id: str(f.id),
  title: str(f.title),
  description: str(f.description),
  fields: list(f.fields, toField),
  open: f.open === true,
  crm: toCrmLink(f.crm as Raw | undefined),
  public: f.public === true,
  link_cap: int(f.linkCap),
  captcha_key: str(f.captchaKey),
  created_at: int(f.createdAt),
  created_by: str(f.createdBy),
  updated_at: int(f.updatedAt),
});

const toLinkFormView = (f: Raw): LinkFormView => ({
  form_id: str(f.formId),
  title: str(f.title),
  description: str(f.description),
  fields: list(f.fields, toField),
  accepting: f.accepting === true,
  captcha: f.captcha === true,
  captcha_by_node: f.captchaByNode === true,
  captcha_site_key: str(f.captchaSiteKey),
});

const toLinkView = (l: Raw): LinkView => ({
  id: str(l.id),
  form_id: str(l.formId),
  label: str(l.label),
  created_at: int(l.createdAt),
  created_by: str(l.createdBy),
  responses: int(l.responses),
  last_hour: int(l.lastHour),
  last_response_at: int(l.lastResponseAt),
});

const toSummary = (f: Raw): FormSummary => ({
  id: str(f.id),
  title: str(f.title),
  description: str(f.description),
  open: f.open === true,
  fields: int(f.fields),
  responses: int(f.responses),
  new_responses: int(f.newResponses),
  last_response_at: int(f.lastResponseAt),
  created_at: int(f.createdAt),
});

export const toResponseView = (r: Raw): ResponseView => ({
  id: str(r.id),
  form_id: str(r.formId),
  answers: list(r.answers, toAnswer),
  source: str(r.source),
  created_at: int(r.createdAt),
  submitted_by: str(r.submittedBy),
  link: str(r.link),
  archived: r.archived === true,
  crm_context: str(r.crmContext),
  crm_deal: str(r.crmDeal),
  crm_sent_at: int(r.crmSentAt),
  crm_sent_by: str(r.crmSentBy),
});

const toKeyView = (k: Raw): FormKeyView => ({
  account: str(k.account),
  label: str(k.label),
  form_id: str(k.formId),
  created_at: int(k.createdAt),
  created_by: str(k.createdBy),
  responses: int(k.responses),
  last_response_at: int(k.lastResponseAt),
});

const toCaptchaSettings = (s: Raw): CaptchaSettings => ({
  site_key: str(s.siteKey),
  secret_set: s.secretSet === true,
  tee_available: s.teeAvailable === true,
  needs_resealing: s.needsResealing === true,
});

/**
 * A contract refusal as a plain `Error` with v1's message: every error the
 * contract raises carries `{ message }`. Anything else passes through.
 */
export function asError(e: unknown): unknown {
  const appCode = (e as { appCode?: unknown } | null)?.appCode;
  if (typeof appCode !== "string") return e;
  const message = (e as { fields?: Raw }).fields?.message;
  const err = new Error(typeof message === "string" && message ? message : appCode);
  (err as Error & { appCode?: string }).appCode = appCode;
  return err;
}

export type Transport = Pick<CalimeroClient, "call" | "view">;

/**
 * The workspace at app instance `app`, with v1's generated client's method
 * names and argument shapes. `after` runs after every request (the session
 * store syncs a refreshed session there).
 */
export class FormsClient {
  constructor(
    private readonly client: Transport,
    readonly app: string,
    private readonly after: () => void = () => {},
  ) {}

  private async call<T>(method: Call, args: Raw = {}): Promise<T> {
    try {
      return (await this.client.call(this.app, method, args)).result as T;
    } catch (e) {
      throw asError(e);
    } finally {
      this.after();
    }
  }

  private async view<T>(method: View, args: Raw = {}): Promise<T> {
    try {
      return (await this.client.view(this.app, method, args)).result as T;
    } catch (e) {
      throw asError(e);
    } finally {
      this.after();
    }
  }

  // forms
  createForm(p: { title: string; description: string }): Promise<string> {
    return this.call("createForm", { title: p.title, description: p.description });
  }
  async updateForm(p: { form_id: string; title: string; description: string; fields: Field[] }): Promise<FormView> {
    return toFormView(
      await this.call<Raw>("updateForm", {
        formId: p.form_id,
        title: p.title,
        description: p.description,
        fields: p.fields.map(fromField),
      }),
    );
  }
  async setFormOpen(p: { form_id: string; open: boolean }): Promise<FormView> {
    return toFormView(await this.call<Raw>("setFormOpen", { formId: p.form_id, open: p.open }));
  }
  async setCrmLink(p: { form_id: string; link: CrmLink }): Promise<FormView> {
    return toFormView(await this.call<Raw>("setCrmLink", { formId: p.form_id, link: fromCrmLink(p.link) }));
  }
  async deleteForm(p: { form_id: string }): Promise<void> {
    await this.call("deleteForm", { formId: p.form_id });
  }
  async getForm(p: { form_id: string }): Promise<FormView> {
    return toFormView(await this.view<Raw>("getForm", { formId: p.form_id }));
  }
  async listForms(): Promise<FormSummary[]> {
    return list(await this.view<unknown>("listForms"), toSummary);
  }
  fieldKinds(): Promise<string[]> {
    return this.view("fieldKinds");
  }

  // responses
  submitResponse(p: { form_id: string; answers: AnswerInput[]; source: string }): Promise<string> {
    return this.call("submitResponse", { formId: p.form_id, answers: fromAnswers(p.answers), source: p.source });
  }
  /** One page of a form's responses, newest first, and the next page's cursor. */
  async listResponsesPage(p: {
    form_id: string;
    cursor?: string | null;
    limit?: number;
  }): Promise<{ items: ResponseView[]; next: string | null }> {
    const page = await this.view<Raw>("listResponses", {
      formId: p.form_id,
      cursor: p.cursor ?? null,
      limit: p.limit ?? RESPONSE_PAGE,
    });
    return { items: list(page?.items, toResponseView), next: typeof page?.next === "string" ? page.next : null };
  }
  /**
   * Every response of a form, newest first, as v1's `list_responses` answered:
   * the contract answers one page per call, and this follows `next` page by
   * page (each its own view), so no single read is unbounded.
   */
  async listResponses(p: { form_id: string }): Promise<ResponseView[]> {
    const out: ResponseView[] = [];
    let cursor: string | null = null;
    do {
      const page = await this.listResponsesPage({ form_id: p.form_id, cursor });
      out.push(...page.items);
      cursor = page.next;
    } while (cursor);
    return out;
  }
  async getResponse(p: { id: string }): Promise<ResponseView> {
    return toResponseView(await this.view<Raw>("getResponse", { id: p.id }));
  }
  async setArchived(p: { id: string; archived: boolean }): Promise<ResponseView> {
    return toResponseView(await this.call<Raw>("setArchived", { id: p.id, archived: p.archived }));
  }
  /** Hands the response to its form's Mero CRM pipeline from the contract (one cross-app call). */
  async sendToCrm(p: { id: string }): Promise<ResponseView> {
    return toResponseView(await this.call<Raw>("sendToCrm", { id: p.id }));
  }
  async recordCrmDeal(p: { id: string; crm_context: string; crm_deal: string }): Promise<ResponseView> {
    return toResponseView(
      await this.call<Raw>("recordCrmDeal", { id: p.id, crmContext: p.crm_context, crmDeal: p.crm_deal }),
    );
  }

  // public links
  async setFormPublic(p: { form_id: string; public: boolean }): Promise<FormView> {
    return toFormView(await this.call<Raw>("setFormPublic", { formId: p.form_id, public: p.public }));
  }
  async setLinkCap(p: { form_id: string; per_hour: number }): Promise<FormView> {
    return toFormView(await this.call<Raw>("setLinkCap", { formId: p.form_id, perHour: p.per_hour }));
  }
  async setCaptchaKey(p: { form_id: string; key: string }): Promise<FormView> {
    return toFormView(await this.call<Raw>("setCaptchaKey", { formId: p.form_id, key: p.key }));
  }
  /** `link` is the SHA-256 (hex) of the token only the link's URL carries. */
  async createLink(p: { form_id: string; link: string; label: string }): Promise<LinkView> {
    return toLinkView(await this.call<Raw>("createLink", { formId: p.form_id, link: p.link, label: p.label }));
  }
  async deleteLink(p: { link: string }): Promise<LinkView> {
    return toLinkView(await this.call<Raw>("deleteLink", { link: p.link }));
  }
  async listLinks(p: { form_id: string }): Promise<LinkView[]> {
    return list(await this.view<unknown>("listLinks", { formId: p.form_id }), toLinkView);
  }
  async linkForm(p: { link: string }): Promise<LinkFormView> {
    return toLinkFormView(await this.view<Raw>("linkForm", { link: p.link }));
  }
  submitViaLink(p: {
    link: string;
    answers: AnswerInput[];
    captcha: CaptchaPass | null;
    captcha_token: string | null;
  }): Promise<string> {
    return this.call("submitViaLink", {
      link: p.link,
      answers: fromAnswers(p.answers),
      captcha: p.captcha
        ? { nonce: p.captcha.nonce, expiresMs: String(p.captcha.expires_ms), signature: p.captcha.signature }
        : null,
      captchaToken: p.captcha_token,
    });
  }

  // team
  async listTeam(): Promise<TeamMember[]> {
    return list(await this.view<unknown>("listTeam"), (m) => ({ account: str(m.account), admin: m.admin === true }));
  }
  async addTeamMember(p: { who: string }): Promise<void> {
    await this.call("addTeamMember", { who: p.who });
  }
  async removeTeamMember(p: { who: string }): Promise<void> {
    await this.call("removeTeamMember", { who: p.who });
  }

  // captcha secret
  async setCaptchaSecret(p: { site_key: string; secret: string }): Promise<CaptchaSettings> {
    return toCaptchaSettings(await this.call<Raw>("setCaptchaSecret", { siteKey: p.site_key, secret: p.secret }));
  }
  async setCaptchaSiteKey(p: { site_key: string }): Promise<CaptchaSettings> {
    return toCaptchaSettings(await this.call<Raw>("setCaptchaSiteKey", { siteKey: p.site_key }));
  }
  async clearCaptchaSecret(): Promise<CaptchaSettings> {
    return toCaptchaSettings(await this.call<Raw>("clearCaptchaSecret"));
  }
  async captchaSettings(): Promise<CaptchaSettings> {
    return toCaptchaSettings(await this.view<Raw>("captchaSettings"));
  }

  // workspace name
  workspaceName(): Promise<string> {
    return this.view("workspaceName");
  }
  async setWorkspaceName(p: { name: string }): Promise<void> {
    await this.call("setWorkspaceName", { name: p.name });
  }

  // form keys
  async registerFormKey(p: { account: string; form_id: string; label: string }): Promise<void> {
    await this.call("registerFormKey", { account: p.account, formId: p.form_id, label: p.label });
  }
  async forgetFormKey(p: { account: string }): Promise<void> {
    await this.call("forgetFormKey", { account: p.account });
  }
  async listFormKeys(): Promise<FormKeyView[]> {
    return list(await this.view<unknown>("listFormKeys"), toKeyView);
  }

  // identity
  amITeam(): Promise<boolean> {
    return this.view("amITeam");
  }
  amIAdmin(): Promise<boolean> {
    return this.view("amIAdmin");
  }
  myAccount(): Promise<string> {
    return this.view("myAccount");
  }
}

