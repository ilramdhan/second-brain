import { afterEach, describe, expect, it, vi } from "vitest";
import { describeError, reportError, setErrorReporter } from "./error-reporting";

afterEach(() => {
  setErrorReporter(undefined);
  vi.restoreAllMocks();
});

describe("error-reporting", () => {
  it("describes errors, responses and other values", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
    expect(describeError(new Response(null, { status: 404 }))).toBe("Response 404");
    expect(describeError("plain")).toBe("plain");
  });

  it("logs to the console and forwards to a registered reporter", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const sink = vi.fn();
    setErrorReporter(sink);
    const err = new Error("x");
    reportError(err, { boundary: "root" });
    expect(log).toHaveBeenCalled();
    expect(sink).toHaveBeenCalledWith(err, expect.objectContaining({ boundary: "root" }));
  });

  it("never throws when the reporter fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setErrorReporter(() => {
      throw new Error("sdk down");
    });
    expect(() => reportError(new Error("x"))).not.toThrow();
  });
});
