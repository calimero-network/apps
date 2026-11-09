import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import LinkPreview from "./LinkPreview";
import { extractYouTubeId, toLocalPreview } from "./linkPreviewModel";

afterEach(() => vi.restoreAllMocks());

describe("toLocalPreview", () => {
  it("shows the hostname and a tidy path", () => {
    expect(
      toLocalPreview("https://www.example.com/docs/guide/?a=1"),
    ).toMatchObject({
      host: "example.com",
      path: "/docs/guide/?a=1",
      youtubeId: null,
    });
    expect(toLocalPreview("https://example.com/")).toMatchObject({
      host: "example.com",
      path: "",
    });
    expect(toLocalPreview("https://example.com/a/b/")).toMatchObject({
      path: "/a/b",
    });
  });

  it("refuses what is not an http(s) link", () => {
    expect(toLocalPreview("javascript:alert(1)")).toBeNull();
    expect(toLocalPreview("not a url")).toBeNull();
  });
});

describe("extractYouTubeId", () => {
  it("recognises YouTube links by pattern", () => {
    expect(
      extractYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toBe("dQw4w9WgXcQ");
    expect(
      extractYouTubeId("https://youtube.com/watch?list=x&v=dQw4w9WgXcQ"),
    ).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeId("https://youtu.be/dQw4w9WgXcQ?t=3")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(extractYouTubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(
      extractYouTubeId("https://notyoutube.com/watch?v=dQw4w9WgXcQ"),
    ).toBeNull();
    expect(
      extractYouTubeId("https://example.com/youtu.be/dQw4w9WgXcQ"),
    ).toBeNull();
  });
});

describe("LinkPreview", () => {
  it("renders link cards without any network request or remote image", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { container } = render(
      <LinkPreview html='<p><a href="https://example.com/post/1">x</a> <a href="https://youtu.be/dQw4w9WgXcQ">y</a></p>' />,
    );
    const cards = screen.getAllByTestId("link-preview");
    expect(cards).toHaveLength(2);
    expect(cards[0].getAttribute("href")).toBe("https://example.com/post/1");
    expect(cards[0].textContent).toContain("example.com");
    expect(cards[0].textContent).toContain("/post/1");
    expect(cards[1].textContent).toContain("YouTube video");
    expect(cards[1].textContent).toContain("dQw4w9WgXcQ");
    expect(container.querySelector("img")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("renders nothing for text without links", () => {
    const { container } = render(<LinkPreview html="<p>hello</p>" />);
    expect(container.innerHTML).toBe("");
  });
});
