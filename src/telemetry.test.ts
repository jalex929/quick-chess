import { afterEach, describe, expect, it } from "vitest";
import { arrivedFrom, endpointFor } from "./telemetry";

describe("usage counts", () => {
  it("send to the Lab receiver only from jayfox.design", () => {
    expect(endpointFor("jayfox.design", "")).toMatch(/\/functions\/v1\/lab-events$/);
    expect(endpointFor("www.jayfox.design", "")).toMatch(/lab-events$/);
    expect(endpointFor("localhost", "")).toBeUndefined();
    expect(endpointFor("notjayfox.design", "")).toBeUndefined();
    expect(endpointFor("jayfox.design.example.com", "")).toBeUndefined();
  });

  it("use the build-time address when one is set", () => {
    expect(endpointFor("localhost", "https://example.test/in")).toBe("https://example.test/in");
  });

  describe("where a visit came from", () => {
    const setReferrer = (value: string) =>
      Object.defineProperty(document, "referrer", { value, configurable: true });
    afterEach(() => setReferrer(""));

    it("is one coarse word, never the address", () => {
      setReferrer("");
      expect(arrivedFrom()).toBe("direct");
      setReferrer("https://jayfox.design/lab");
      expect(arrivedFrom()).toBe("lab");
      setReferrer("https://jayfox.design/lab/");
      expect(arrivedFrom()).toBe("lab");
      setReferrer("https://jayfox.design/work/case-study");
      expect(arrivedFrom()).toBe("site");
      setReferrer("https://www.example.com/post?id=1");
      expect(arrivedFrom()).toBe("other");
    });
  });
});
