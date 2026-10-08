import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageContainer } from "@/components/common/PageContainer";

function frameOf(container: HTMLElement) {
  const frame = container.querySelector("[data-page-frame]");
  if (!frame) throw new Error("frame missing");
  return frame;
}

describe("PageContainer", () => {
  it("gives every page the same centered max-w-6xl frame", () => {
    const a = frameOf(render(<PageContainer>a</PageContainer>).container);
    const b = frameOf(render(<PageContainer>b</PageContainer>).container);
    expect(a.className).toBe(b.className);
    expect(a.classList).toContain("max-w-6xl");
    expect(a.classList).toContain("mx-auto");
    expect(a.classList).toContain("w-full");
  });

  it("renders children directly in the frame without an inner width column", () => {
    const { container, getByText } = render(
      <PageContainer>
        <span>body</span>
      </PageContainer>,
    );
    const frame = frameOf(container);
    expect(getByText("body").parentElement).toBe(frame);
    expect(frame.querySelector("[data-page-column]")).toBeNull();
    expect(frame.querySelector('[class*="max-w-"]')).toBeNull();
  });
});
