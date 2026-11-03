import { asError, int, type Transport } from "./formsApi";

/**
 * The few Mero CRM methods the hand-off uses, on a Mero CRM app instance (a
 * pipeline), through the same signed-in client: the person sending is the
 * person who writes the deal. Method and argument names are the component
 * contract's (camelCase); the answers read here are single-word fields.
 */
export interface StageView {
  id: string;
  name: string;
  probability: number;
  position: number;
}

export interface ContactView {
  id: string;
  name: string;
  email: string;
}

type Raw = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const rows = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);

export class CrmClient {
  constructor(
    private readonly client: Transport,
    readonly app: string,
    private readonly after: () => void = () => {},
  ) {}

  private async run<T>(kind: "call" | "view", method: string, args: Raw = {}): Promise<T> {
    try {
      return (await this.client[kind](this.app, method, args)).result as T;
    } catch (e) {
      throw asError(e);
    } finally {
      this.after();
    }
  }

  async listStages(): Promise<StageView[]> {
    return rows(await this.run("view", "listStages")).map((s) => ({
      id: str(s.id),
      name: str(s.name),
      probability: int(s.probability),
      position: int(s.position),
    }));
  }

  async listContacts(): Promise<ContactView[]> {
    return rows(await this.run("view", "listContacts")).map((c) => ({
      id: str(c.id),
      name: str(c.name),
      email: str(c.email),
    }));
  }

  createContact(p: { name: string; email: string; phone: string; organization: string; job_title: string }): Promise<string> {
    return this.run("call", "createContact", {
      name: p.name,
      email: p.email,
      phone: p.phone,
      organization: p.organization,
      jobTitle: p.job_title,
    });
  }

  createDeal(p: { title: string; organization: string; contact_id: string | null; stage_id: string; source: string }): Promise<string> {
    return this.run("call", "createDeal", {
      title: p.title,
      value: "0",
      organization: p.organization,
      contactId: p.contact_id,
      stageId: p.stage_id,
      owner: null,
      expectedClose: null,
      source: p.source,
    });
  }

  addNote(p: { deal_id: string; body: string }): Promise<string> {
    return this.run("call", "addNote", { dealId: p.deal_id, body: p.body });
  }
}
