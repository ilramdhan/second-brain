import { useState } from "react";
import { X } from "lucide-react";

export function TagInput({
  value,
  onChange,
  placeholder = "Tambah tag, tekan Enter",
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string | undefined;
}) {
  const [draft, setDraft] = useState("");
  function commit() {
    const t = draft.trim().replace(/,$/, "").toLowerCase();
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft("");
  }
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-2 py-1.5 focus-within:ring-1 focus-within:ring-ring">
      {value.map((t) => (
        <span
          key={t}
          className="flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
        >
          {t}
          <button
            type="button"
            onClick={() => onChange(value.filter((x) => x !== t))}
            aria-label={`Hapus tag ${t}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={commit}
        placeholder={value.length ? "" : placeholder}
        className="min-w-[8rem] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string | undefined;
}) {
  return (
    <label className={"block space-y-1.5 " + (className ?? "")}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
