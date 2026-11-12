import { MeroFormsClient, type AppCallTransport, type AppTransport } from "./generated/client";

/**
 * The forms contract is called through `MeroFormsClient`
 * (`src/generated/client.ts`, which `mero-app-build codegen` writes from
 * `logic/res/abi.json`): camelCase arguments, 64-bit integers as decimal
 * strings. This file is what sits around it:
 *
 * - the shapes the screens use. The screens were written against v1's
 *   `FormsClient`: snake_case records and plain numbers. The ABI names its
 *   records without their shapes, so the generated answers are `unknown`, and
 *   each one passes through a `to*` below (`from*` builds a record argument).
 *   Timestamps are milliseconds (v1's were nanoseconds).
 * - `formsTransport`, the one adapter on the wire: a refusal comes back as an
 *   `AppError` (`appCode` + `fields.message`) and is rethrown as a plain
 *   `Error` carrying v1's message (`asError`), which is what the screens show
 *   and what `publicRefusal` matches on.
 *
 * `client.test.ts` checks the generated class against the committed ABI.
 */

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
  id: string;
  form_id: string;
  label: string;
  grant_id: string;
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
  grant_id: str(l.grantId),
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

// ── answers and record arguments, at the call sites ──────────────────────────

/** `getForm`'s answer, and every call that answers the form it changed. */
export const toForm = (v: unknown): FormView => toFormView(v as Raw);
/** `listForms`'s answer. */
export const toForms = (v: unknown): FormSummary[] => list(v, toSummary);
/** `getResponse`'s answer, and `setArchived`'s and `recordCrmDeal`'s. */
export const toResponse = (v: unknown): ResponseView => toResponseView(v as Raw);
/** `listResponses`'s answer. */
export const toResponses = (v: unknown): ResponseView[] => list(v, toResponseView);
/** `createLink`'s and `deleteLink`'s answer. */
export const toLink = (v: unknown): LinkView => toLinkView(v as Raw);
/** `listLinks`'s answer. */
export const toLinks = (v: unknown): LinkView[] => list(v, toLinkView);
/** `linkForm`'s answer. */
export const toLinkForm = (v: unknown): LinkFormView => toLinkFormView(v as Raw);
/** `listFormKeys`'s answer. */
export const toFormKeys = (v: unknown): FormKeyView[] => list(v, toKeyView);
/** `listTeam`'s answer. */
export const toTeam = (v: unknown): TeamMember[] => list(v, (m) => ({ account: str(m.account), admin: m.admin === true }));
/** `captchaSettings`'s answer, and the captcha secret calls'. */
export const toCaptcha = (v: unknown): CaptchaSettings => toCaptchaSettings(v as Raw);

/** A form's fields as `updateForm` takes them. */
export const fromFields = (fields: Field[]) => fields.map(fromField);
export { fromCrmLink, fromAnswers };
/** A captcha pass as `submitViaLink` takes it: its expiry as a decimal string. */
export const fromCaptchaPass = (pass: CaptchaPass | null) =>
  pass ? { nonce: pass.nonce, expiresMs: String(pass.expires_ms), signature: pass.signature } : null;

/** Ignores a call's answer, for the calls the screens only wait for. */
export const done = (): void => undefined;

// ── the client ───────────────────────────────────────────────────────────────

/** Rethrows a refusal with v1's message (`asError`). */
function rethrow(e: unknown): never {
  throw asError(e);
}

/**
 * `client` with every contract refusal turned into v1's `Error` (`asError`),
 * for `MeroFormsClient` to call through. Events pass through when `client`
 * has them.
 */
export function formsTransport(client: AppCallTransport & Partial<Pick<AppTransport, "events">>): AppTransport {
  return {
    apps: {
      call: (args, options) => client.apps.call(args, options).catch(rethrow),
      view: (args, options) => client.apps.view(args, options).catch(rethrow),
    },
    events: (app, from, signal) => {
      if (!client.events) throw new Error("this client has no event stream");
      return client.events(app, from, signal);
    },
  };
}

/**
 * The workspace at app instance `app`. `after` runs after every request (the
 * session store syncs a refreshed session there).
 */
export function formsClient(
  client: AppCallTransport & Partial<Pick<AppTransport, "events">>,
  app: string,
  after?: () => void,
): MeroFormsClient {
  return new MeroFormsClient(formsTransport(client), app, after ? { after } : {});
}

export { MeroFormsClient };
