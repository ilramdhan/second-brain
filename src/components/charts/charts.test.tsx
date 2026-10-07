import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BarChart } from "@/components/charts/BarChart";
import { LineChart } from "@/components/charts/LineChart";
import type { ChartPoint, ChartSeries } from "@/components/charts/types";

const series: ChartSeries[] = [
  { key: "a", label: "Selesai", tone: "chart-1" },
  { key: "b", label: "Dibuat", tone: "chart-2" },
];
const points: ChartPoint[] = [
  { key: "1", label: "Sen", long: "Senin", values: { a: 2, b: 3 } },
  { key: "2", label: "Sel", long: "Selasa", values: { a: 5, b: 1 } },
  { key: "3", label: "Rab", long: "Rabu", values: { a: null, b: 0 } },
];

describe("BarChart", () => {
  it("has a legend for two series, a table twin and a keyboard readout", () => {
    render(<BarChart id="t" title="Throughput" series={series} points={points} format={String} />);
    const table = screen.getByRole("table", { name: "Throughput" });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByText("–")).toBeInTheDocument();
    expect(screen.getAllByText("Selesai").length).toBeGreaterThan(1); // legend + table header

    const plot = screen.getByTestId("t-plot");
    fireEvent.focus(plot); // focus lands on the last point
    expect(screen.getByText("Rabu", { selector: "p" })).toBeInTheDocument();
    fireEvent.keyDown(plot, { key: "ArrowLeft" });
    expect(screen.getByText("Selasa", { selector: "p" })).toBeInTheDocument();
    fireEvent.keyDown(plot, { key: "Escape" });
    expect(screen.getByText(/Arahkan atau ketuk/)).toBeInTheDocument();
  });

  it("labels only the peak directly and can show the table", () => {
    render(
      <BarChart
        id="t"
        title="Throughput"
        series={series.slice(0, 1)}
        points={points}
        format={(v) => `${v}x`}
      />,
    );
    const plot = screen.getByTestId("t-plot");
    expect(within(plot).getByText("5x")).toBeInTheDocument();
    expect(within(plot).queryByText("2x")).toBeNull();
    const toggle = screen.getByRole("button", { name: /Tabel/ });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });
});

describe("LineChart", () => {
  it("draws one path per series with gaps for missing values", () => {
    const { container } = render(
      <LineChart
        id="b"
        title="Burndown"
        series={[
          { key: "a", label: "Terbuka", tone: "chart-1" },
          { key: "b", label: "Ideal", tone: "muted", dashed: true },
        ]}
        points={points}
        format={String}
      />,
    );
    const paths = container.querySelectorAll("[data-testid=b-plot] path");
    expect(paths).toHaveLength(2);
    expect(paths[0]!.getAttribute("d")).toMatch(/^M[\d.]+,[\d.]+L[\d.]+,[\d.]+$/); // 2 of 3 points
    expect(paths[1]!.getAttribute("stroke-dasharray")).toBe("6 5");
    // The last known value of the lead series is labelled.
    expect(within(screen.getByTestId("b-plot")).getByText("5")).toBeInTheDocument();
  });
});
