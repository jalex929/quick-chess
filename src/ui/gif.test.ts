import { describe, expect, it } from "vitest";
import { replayStart } from "./gifExport";

describe("GIF replay", () => {
  it("replays the last ten half-moves, or the whole of a short game", () => {
    expect(replayStart(40)).toBe(30);
    expect(replayStart(7)).toBe(0);
    expect(replayStart(10)).toBe(0);
  });
});
