import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Markdown, safeHref } from "./markdown";

const html = (text: string) => render(<Markdown text={text} />).container.firstElementChild!.innerHTML;

describe("markdown in a bubble", () => {
  it("numbers an ordered list from where it starts", () => {
    expect(html("3. three\n4. four")).toBe('<ol start="3"><li>three</li><li>four</li></ol>');
  });

  it("keeps a list going across a blank line, and a wrapped line in its item", () => {
    expect(html("- one\n  more\n\n- two\n\nafter")).toBe("<ul><li>one\nmore</li><li>two</li></ul><p>after</p>");
  });

  it("keeps a paragraph's line breaks", () => {
    expect(html("line one\nline two")).toBe("<p>line one\nline two</p>");
  });

  it("shows a heading as a bold line", () => {
    expect(html("## Status")).toBe('<p class="md-heading"><strong>Status</strong></p>');
  });

  it("runs an unclosed fence to the end, and marks nothing inside a fence", () => {
    const out = html("```\n**not bold** <b>\n");
    expect(out).toContain("<code>**not bold** &lt;b&gt;\n</code>");
    expect(out).not.toContain("<strong>");
  });

  it("leaves snake_case and lone stars alone", () => {
    expect(html("run my_test_name with 2 * 3")).toBe("<p>run my_test_name with 2 * 3</p>");
  });

  it("marks nothing inside inline code", () => {
    expect(html("`**x** <i>`")).toBe("<p><code>**x** &lt;i&gt;</code></p>");
  });

  it("takes only web and mail links", () => {
    expect(safeHref("https://github.com/a")).toBe("https://github.com/a");
    expect(safeHref("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,<script>")).toBeNull();
    expect(safeHref("/relative")).toBeNull();
  });
});
