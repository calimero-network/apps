import { appendFileSync } from "node:fs";
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";

type Tally = { passed: number; flaky: number; failed: number; skipped: number };

export default class StrictJourneyReporter implements Reporter {
  private readonly byProject = new Map<string, Tally>();
  private readonly skipped: string[] = [];
  private readonly failures: string[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    const project = test.parent.project()?.name || "default";
    const tally = this.byProject.get(project) ?? { passed: 0, flaky: 0, failed: 0, skipped: 0 };
    this.byProject.set(project, tally);
    const final = result.retry === test.retries || result.status === "passed" || result.status === "skipped";
    if (!final) return;
    const outcome = test.outcome();
    if (outcome === "skipped") {
      tally.skipped++;
      this.skipped.push(test.titlePath().join(" › "));
    } else if (outcome === "flaky") {
      tally.flaky++;
    } else if (outcome === "expected") {
      tally.passed++;
    } else {
      tally.failed++;
      const first = result.attachments.find((a) => a.name === "first-failing-node-call.txt");
      const detail = first?.body ? `\n\n\`\`\`\n${first.body.toString().slice(0, 1500)}\n\`\`\`` : "";
      const message = (result.error?.message ?? "").split("\n").slice(0, 6).join("\n");
      this.failures.push(`**${test.title}**\n\n\`\`\`\n${message}\n\`\`\`${detail}`);
    }
  }

  async onEnd(result: FullResult): Promise<{ status?: FullResult["status"] } | undefined> {
    const totals = [...this.byProject.values()].reduce(
      (a, t) => ({
        passed: a.passed + t.passed,
        flaky: a.flaky + t.flaky,
        failed: a.failed + t.failed,
        skipped: a.skipped + t.skipped,
      }),
      { passed: 0, flaky: 0, failed: 0, skipped: 0 },
    );
    const ran = totals.passed + totals.flaky + totals.failed;
    const problems: string[] = [];
    if (ran === 0) problems.push("no journey test ran");
    if (totals.skipped > 0) problems.push(`${totals.skipped} journey test(s) were skipped: ${this.skipped.join("; ")}`);

    const summary = process.env["GITHUB_STEP_SUMMARY"];
    if (summary) {
      const rows = [...this.byProject.entries()]
        .map(([p, t]) => `| ${p} | ${t.passed} | ${t.flaky} | ${t.failed} | ${t.skipped} |`)
        .join("\n");
      const lines = [
        `### Journey: ${process.env["JOURNEY_APP"] ?? ""} on ${process.env["JOURNEY_MEROD_LABEL"] ?? "merod"}`,
        "",
        "| project | passed | flaky | failed | skipped |",
        "|---|---|---|---|---|",
        rows || "| — | 0 | 0 | 0 | 0 |",
        "",
        ...problems.map((p) => `- ❌ ${p}`),
        ...this.failures,
        "",
      ];
      try {
        appendFileSync(summary, `${lines.join("\n")}\n`);
      } catch {
        return undefined;
      }
    }

    for (const p of problems) console.error(`journey: ${p}`);
    if (problems.length > 0 && result.status === "passed") return { status: "failed" };
    return undefined;
  }

  printsToStdio(): boolean {
    return false;
  }
}
