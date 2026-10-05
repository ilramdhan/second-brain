import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Timer } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getUid, type Task } from "@/lib/data";

export function FocusTimer({ task }: { task: Task }) {
  const qc = useQueryClient();
  const total = Math.max(1, task.estimate_minutes) * 60;
  const [seconds, setSeconds] = useState(total);
  const [running, setRunning] = useState(false);
  const startedAt = useRef<string | null>(null);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(
      () =>
        setSeconds((value) => {
          if (value > 1) return value - 1;
          setRunning(false);
          void finish(total);
          return 0;
        }),
      1000,
    );
    return () => window.clearInterval(id);
  }, [running, total]);

  async function finish(duration = total - seconds) {
    if (!startedAt.current || duration <= 0) return;
    const user_id = await getUid();
    const { error } = await supabase.from("time_entries").insert({
      user_id,
      task_id: task.id,
      project_id: task.project_id,
      mode: "focus",
      started_at: startedAt.current,
      ended_at: new Date().toISOString(),
      duration_seconds: duration,
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Sesi fokus tersimpan");
      void qc.invalidateQueries({ queryKey: ["time-entries"] });
    }
    startedAt.current = null;
  }

  function toggle() {
    if (!running && !startedAt.current) startedAt.current = new Date().toISOString();
    setRunning((value) => !value);
  }

  async function reset() {
    if (startedAt.current) await finish();
    setRunning(false);
    setSeconds(total);
  }

  const mins = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const secs = (seconds % 60).toString().padStart(2, "0");
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-secondary/40 p-3">
      <div className="flex min-w-0 items-center gap-2">
        <Timer className="h-4 w-4 shrink-0 text-primary" />
        <div>
          <p className="text-xs text-muted-foreground">Pomodoro</p>
          <p className="font-mono text-lg font-semibold tabular-nums">
            {mins}:{secs}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={toggle}
          aria-label={running ? "Jeda" : "Mulai"}
        >
          {running ? <Pause /> : <Play />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={reset}
          aria-label="Simpan dan reset"
        >
          <RotateCcw />
        </Button>
      </div>
    </div>
  );
}
