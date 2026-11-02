import { asError, int, type Transport } from "./formsApi";

/**
 * What the Connect tab reads from a Mero CRM app instance (a pipeline), through
 * the same signed-in client: its stages, to pick the one new deals start in.
 * The hand-off itself is the forms contract's `sendToCrm`, a cross-app call
 * from one instance to the other; this page writes nothing to the CRM.
 */
export interface StageView {
  id: string;
  name: string;
  probability: number;
  position: number;
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
}
