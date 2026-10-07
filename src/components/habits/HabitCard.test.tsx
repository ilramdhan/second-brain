import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HabitCard } from "@/components/habits/HabitCard";
import type { Habit, HabitLog } from "@/lib/data";
import { weekDays } from "@/lib/habits";

const TODAY = "2026-10-07";
const habit: Habit = {
  id: "h1",
  user_id: "u",
  project_id: null,
  name: "Jalan kaki",
  description: null,
  color: "green",
  icon: null,
  schedule_type: "daily",
  weekdays_mask: 127,
  times_per_week: 3,
  target: 1,
  position: 0,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};
const log = (date: string, count = 1): HabitLog => ({
  id: date,
  habit_id: "h1",
  date,
  count,
  note: null,
});

function setup(logs: HabitLog[], h: Habit = habit) {
  const onToggle = vi.fn();
  render(
    <ul>
      <HabitCard
        habit={h}
        logs={logs}
        today={TODAY}
        since="2026-09-01"
        week={weekDays(TODAY)}
        projectName="Kesehatan"
        onToggle={onToggle}
        onEdit={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
      />
    </ul>,
  );
  return onToggle;
}

describe("HabitCard", () => {
  it("checks in today with a large, labelled toggle", () => {
    const onToggle = setup([log("2026-10-06"), log("2026-10-05")]);
    const btn = screen.getByRole("button", { name: /check-in hari ini/ });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    expect(btn.className).toContain("h-12");
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledWith(TODAY);
    expect(screen.getByText("Setiap hari · Kesehatan")).toBeInTheDocument();
  });

  it("shows streaks and the week grid; future days are disabled", () => {
    setup([log(TODAY), log("2026-10-06"), log("2026-10-05")]);
    expect(screen.getByRole("button", { name: /selesai hari ini/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getAllByText("3")[0]).toBeInTheDocument(); // current streak
    const grid = screen.getByRole("list", { name: "Jalan kaki: minggu ini" });
    const days = grid.querySelectorAll("button");
    expect(days).toHaveLength(7);
    expect(days[6]).toBeDisabled(); // Sunday 11 Oct is in the future
    expect(days[0]).toHaveAttribute("aria-pressed", "true");
  });

  it("shows progress toward a target above one", () => {
    setup([log(TODAY, 3)], { ...habit, target: 8 });
    expect(screen.getByRole("button", { name: /check-in hari ini \(3\/8\)/ })).toBeInTheDocument();
  });
});
