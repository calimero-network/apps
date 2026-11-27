import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeetingPage } from "./MeetingPage";
import { recordingFileName } from "./lib/transcript";
import { fakeWorkspace, meeting } from "./test/workspace";
import { sha256Hex } from "./useRecording";

afterEach(cleanup);

describe("Download recording", () => {
  it("fetches the recording and saves it under the meeting's title", async () => {
    const bytes = new Uint8Array([7, 8, 9, 10]);
    const id = await sha256Hex(bytes.slice().buffer);
    const fake = fakeWorkspace({
      getMeeting: () => meeting({ title: "Launch plan: Q4", platform: "upload", audio: { blob: id, mime: "audio/mpeg", size: 4, durationMs: 9_000 } }),
      listActions: () => [],
      transcript: () => ({ segments: [], next: null }),
    });
    fake.stored.set(id, bytes);
    const blobs: Blob[] = [];
    Object.assign(URL, {
      createObjectURL: vi.fn((b: Blob) => {
        blobs.push(b);
        return `blob:${blobs.length}`;
      }),
      revokeObjectURL: vi.fn(),
    });
    const saved: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
    render(<MeetingPage workspace={fake.workspace} meetingId="aa11" me="cy" isOwner={false} onBack={() => {}} />);
    // It is in the meeting's Export menu.
    fireEvent.click(await screen.findByTestId("export-menu"));
    fireEvent.click(await screen.findByTestId("download-recording"));
    await waitFor(() => expect(saved).toEqual(["launch-plan-q4.mp3"]));
    const file = blobs.at(-1)!;
    expect(file.type).toBe("audio/mpeg");
    const read = await new Promise<ArrayBuffer>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as ArrayBuffer);
      r.readAsArrayBuffer(file);
    });
    expect(Array.from(new Uint8Array(read))).toEqual(Array.from(bytes));
    click.mockRestore();
  });

  it("is not offered for a meeting without audio", async () => {
    const fake = fakeWorkspace({ getMeeting: () => meeting(), listActions: () => [], transcript: () => ({ segments: [], next: null }) });
    render(<MeetingPage workspace={fake.workspace} meetingId="aa11" me="cy" isOwner={false} onBack={() => {}} />);
    fireEvent.click(await screen.findByTestId("export-menu"));
    await screen.findByText(/Copy as Markdown/);
    expect(screen.queryByTestId("download-recording")).toBeNull();
  });

  it("names files by type", () => {
    expect(recordingFileName("Call", "audio/mp4")).toBe("call.m4a");
    expect(recordingFileName("", "audio/wav")).toBe("meeting.wav");
    expect(recordingFileName("x", "application/odd")).toBe("x.audio");
  });
});
