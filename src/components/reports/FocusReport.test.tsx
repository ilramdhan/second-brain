import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FocusBreakdown, FocusSummary, formatFocus } from "@/components/reports/FocusReport";

const monday = new Date(2026, 9, 5);
const days = Array.from({ length: 7 }, (_, i) => {
  const d = new Date(monday);
  d.setDate(d.getDate() + i);
  return { d, sec: [3600, 1800, 9000, 0, 0, 0, 0][i] ?? 0 };
});

describe("formatFocus", () => {
  it("formats hours and minutes", () => {
    expect(formatFocus(1500)).toBe("25 m");
    expect(formatFocus(3600 + 45 * 60)).toBe("1 j 45 m");
  });
});

describe("FocusSummary", () => {
  it("uses single-column grids on phones so cards never overflow", () => {
    const { container } = render(<FocusSummary total={14400} sessions={3} days={days} />);
    expect(container.firstElementChild).toHaveClass("grid-cols-1", "lg:grid-cols-3");
    expect(screen.getByText("4 j 0 m")).toBeInTheDocument();
  });

  it("labels the busiest day and exposes the values as a table", () => {
    render(<FocusSummary total={14400} sessions={3} days={days} />);
    expect(screen.getByTestId("focus-bars")).toHaveAttribute("aria-hidden", "true");
    const table = screen.getByRole("table", { name: "Waktu fokus per hari" });
    expect(within(table).getAllByRole("row")).toHaveLength(8);
    expect(within(table).getByText("2 j 30 m")).toBeInTheDocument();
  });
});

describe("FocusBreakdown", () => {
  it("truncates long names inside a min-w-0 row instead of widening the card", () => {
    const long = "Aplikasi Kasir dengan nama proyek yang cukup panjang sekali";
    render(
      <FocusBreakdown
        total={3600}
        byProject={[{ id: "p1", label: long, sec: 3600, color: "blue" }]}
        byTask={[{ id: "t1", label: "Tugas", sec: 1800, suffix: " / est. 30 m" }]}
      />,
    );
    expect(screen.getByText(long)).toHaveClass("truncate");
    expect(screen.getByText("1 j 0 m · 100%")).toHaveClass("shrink-0");
    expect(screen.getByText(/30 m \/ est\. 30 m/)).toBeInTheDocument();
  });
});
