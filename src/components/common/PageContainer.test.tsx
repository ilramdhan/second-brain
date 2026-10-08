import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageContainer } from "@/components/common/PageContainer";

function frameOf(container: HTMLElement) {
  const frame = container.querySelector("[data-page-frame]");
  if (!frame) throw new Error("frame missing");
  return frame;
}

describe("PageContainer", () => {
  it("uses the same centered standard frame for full and readable content", () => {
    const full = frameOf(render(<PageContainer>x</PageContainer>).container);
    const readable = frameOf(
      render(<PageContainer contentWidth="readable">x</PageContainer>).container,
    );
    expect(full.className).toBe(readable.className);
    expect(full.classList).toContain("max-w-6xl");
    expect(full.classList).toContain("mx-auto");
    expect(full.querySelector("[data-page-column]")).toBeNull();
  });

  it("wraps readable content in a left-aligned max-w-3xl column", () => {
    const { container, getByText } = render(
      <PageContainer contentWidth="readable">
        <span>body</span>
      </PageContainer>,
    );
    const column = container.querySelector('[data-page-column="readable"]');
    expect(column).not.toBeNull();
    expect(column?.classList).toContain("max-w-3xl");
    expect(column?.className).not.toMatch(/mx-auto|ml-auto|mr-auto/);
    expect(column?.contains(getByText("body"))).toBe(true);
  });
});
