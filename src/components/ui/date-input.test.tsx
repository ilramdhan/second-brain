import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StartField } from "@/components/tasks/StartField";
import { PreferencesProvider } from "@/lib/preferences";

import { DateInput, DateTimeInput, TimeInput } from "./date-input";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockShowPicker(impl?: () => void) {
  const fn = vi.fn(impl);
  Object.defineProperty(HTMLInputElement.prototype, "showPicker", {
    configurable: true,
    writable: true,
    value: fn,
  });
  return fn;
}

describe("DateInput / TimeInput / DateTimeInput", () => {
  it.each([
    [DateInput, "date"],
    [TimeInput, "time"],
    [DateTimeInput, "datetime-local"],
  ] as const)("renders a native %s field with the icon at the right edge", (Comp, type) => {
    render(<Comp aria-label="Tanggal" value="" onChange={() => {}} />);
    const input = screen.getByLabelText("Tanggal");
    expect(input).toHaveAttribute("type", type);
    // Room for the icon, and the native indicator is hidden.
    expect(input).toHaveClass("pr-9", "[&::-webkit-calendar-picker-indicator]:hidden");
    const icon = input.parentElement!.querySelector("[data-slot=date-input-icon]")!;
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveClass("absolute", "right-3", "pointer-events-none");
    // The icon comes after the input inside the same positioned wrapper.
    expect(input.parentElement).toHaveClass("relative");
    expect(input.nextElementSibling).toBe(icon);
  });

  it("opens the native picker when the field is clicked", () => {
    const showPicker = mockShowPicker();
    render(<DateInput aria-label="Mulai" value="" onChange={() => {}} />);
    fireEvent.click(screen.getByLabelText("Mulai"));
    expect(showPicker).toHaveBeenCalledTimes(1);
  });

  it("falls back to focus when showPicker throws, and skips disabled fields", () => {
    const showPicker = mockShowPicker(() => {
      throw new DOMException("not allowed", "NotAllowedError");
    });
    render(
      <>
        <TimeInput aria-label="Jam" value="" onChange={() => {}} />
        <TimeInput aria-label="Mati" value="" onChange={() => {}} disabled />
      </>,
    );
    const input = screen.getByLabelText("Jam");
    fireEvent.click(input);
    expect(input).toHaveFocus();
    showPicker.mockClear();
    fireEvent.click(screen.getByLabelText("Mati"));
    expect(showPicker).not.toHaveBeenCalled();
  });
});

describe("StartField (task editor start)", () => {
  function Harness() {
    const [date, setDate] = useState("2026-10-08");
    const [time, setTime] = useState("09:30");
    const [useTime, setUseTime] = useState(true);
    return (
      <PreferencesProvider initialLocale="id">
        <StartField
          date={date}
          time={time}
          useTime={useTime}
          onDateChange={setDate}
          onTimeChange={setTime}
          onUseTimeChange={setUseTime}
        />
        <output data-testid="model">{`${date}|${time}|${useTime}`}</output>
      </PreferencesProvider>
    );
  }

  it("keeps the start value when the time switch is toggled", () => {
    render(<Harness />);
    const start = screen.getByLabelText("Mulai");
    expect(start).toHaveAttribute("type", "datetime-local");
    expect(start).toHaveValue("2026-10-08T09:30");

    fireEvent.click(screen.getByRole("switch", { name: "Pakai jam" }));
    const dateOnly = screen.getByLabelText("Mulai");
    expect(dateOnly).toHaveAttribute("type", "date");
    expect(dateOnly).toHaveValue("2026-10-08");
    expect(screen.getByTestId("model")).toHaveTextContent("2026-10-08|09:30|false");

    fireEvent.click(screen.getByRole("switch", { name: "Pakai jam" }));
    expect(screen.getByLabelText("Mulai")).toHaveValue("2026-10-08T09:30");
  });

  it("splits a datetime-local change into date and time", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Mulai"), { target: { value: "2026-11-02T14:15" } });
    expect(screen.getByTestId("model")).toHaveTextContent("2026-11-02|14:15|true");
  });
});
