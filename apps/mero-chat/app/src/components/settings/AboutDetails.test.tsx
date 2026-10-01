import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AboutDetails from "./AboutDetails";

describe("AboutDetails", () => {
  it("shows Delete Channel button for owners", () => {
    render(
      <AboutDetails
        channelName="general"
        dateCreated=""
        manager="Owner"
        isOwner={true}
      />,
    );

    expect(screen.getByText(/delete channel/i)).toBeTruthy();
  });

  it("shows no action button for non-owners", () => {
    render(
      <AboutDetails
        channelName="general"
        dateCreated=""
        manager="Owner"
        isOwner={false}
      />,
    );

    expect(screen.queryByText(/leave channel/i)).toBeNull();
    expect(screen.queryByText(/delete channel/i)).toBeNull();
  });
});
