import type { Page, Response, TestInfo } from "@playwright/test";

export interface NodeCall {
  who: string;
  method: string;
  url: string;
  status: number;
  body: string;
  at: number;
}

const NODE_ROUTES = /\/(admin-api|jsonrpc|auth|sse|ws)(\/|$|\?)/;

export class TrafficLog {
  readonly calls: NodeCall[] = [];
  readonly pageErrors: string[] = [];

  watch(page: Page, who: string, nodeUrls: string[]): void {
    const origins = new Set(nodeUrls.map((u) => new URL(u).origin));
    page.on("pageerror", (e) => this.pageErrors.push(`[${who}] ${String(e).slice(0, 500)}`));
    page.on("response", (r: Response) => {
      const url = new URL(r.url());
      if (!origins.has(url.origin) || !NODE_ROUTES.test(url.pathname)) return;
      const call: NodeCall = {
        who,
        method: r.request().method(),
        url: `${url.origin}${url.pathname}`,
        status: r.status(),
        body: "",
        at: Date.now(),
      };
      this.calls.push(call);
      const isRpc = url.pathname.startsWith("/jsonrpc");
      if (r.status() >= 400 || isRpc) {
        r.text()
          .then((t) => {
            call.body = t.slice(0, 2000);
            if (isRpc && r.status() < 400 && /"error"\s*:/.test(t)) call.status = 599;
          })
          .catch(() => undefined);
      }
    });
  }

  failures(): NodeCall[] {
    return this.calls.filter((c) => c.status >= 400);
  }

  describeFirstFailure(): string | undefined {
    const first = this.failures()[0];
    if (!first) return undefined;
    const status = first.status === 599 ? "200 with a JSON-RPC error" : String(first.status);
    return `[${first.who}] ${first.method} ${first.url} -> ${status}\n${first.body}`;
  }

  async attach(testInfo: TestInfo): Promise<void> {
    await testInfo.attach("node-calls.json", {
      body: JSON.stringify(this.calls, null, 2),
      contentType: "application/json",
    });
    const first = this.describeFirstFailure();
    if (first) {
      await testInfo.attach("first-failing-node-call.txt", { body: first, contentType: "text/plain" });
    }
  }
}
