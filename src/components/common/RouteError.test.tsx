import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invalidate = vi.hoisted(() => vi.fn());
const reportErrorMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({
    invalidate,
    state: { matches: [{ routeId: "__root__" }, { routeId: "/_authenticated/tasks" }] },
  }),
  Link: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <a href="/today" onClick={onClick}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/error-reporting", () => ({
  reportError: reportErrorMock,
  describeError: (e: unknown) => String(e),
}));

import { RouteError } from "@/components/common/RouteError";
import { PreferencesProvider } from "@/lib/preferences";

function renderError(error: Error) {
  const reset = vi.fn();
  render(
    <PreferencesProvider>
      <RouteError error={error} reset={reset} info={{ componentStack: "" }} />
    </PreferencesProvider>,
  );
  return reset;
}

describe("RouteError", () => {
  beforeEach(() => {
    invalidate.mockClear();
    reportErrorMock.mockClear();
  });

  it("renders a friendly message and reports with the route id", () => {
    renderError(new Error("boom"));
    expect(screen.getByRole("alert")).toHaveTextContent("Halaman ini gagal dimuat");
    expect(reportErrorMock).toHaveBeenCalledWith(expect.any(Error), {
      boundary: "route_error_component",
      routeId: "/_authenticated/tasks",
    });
  });

  it("uses the mapped message for known errors", () => {
    renderError(new TypeError("Failed to fetch"));
    expect(screen.getByRole("alert")).toHaveTextContent(/Tidak dapat terhubung/);
  });

  it("retries by invalidating the router and resetting the boundary", () => {
    const reset = renderError(new Error("boom"));
    fireEvent.click(screen.getByRole("button", { name: /Coba lagi/ }));
    expect(invalidate).toHaveBeenCalled();
    expect(reset).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /Kembali ke Hari Ini/ })).toBeInTheDocument();
  });
});
