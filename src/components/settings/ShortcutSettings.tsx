import { Fragment, useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";

import { Button, IconButton } from "@/components/ui/button";
import { useShortcuts } from "@/hooks/use-shortcuts";
import { usePreferences } from "@/lib/preferences";
import {
  bindingKeys,
  getShortcutOverrides,
  isAllowedShortcutKey,
  isMacPlatform,
  remappableBinding,
  resetAllShortcuts,
  resetShortcut,
  setShortcutKey,
  type ShortcutId,
  type ShortcutScope,
} from "@/lib/shortcuts";

const GROUPS: {
  scope: ShortcutScope;
  title: "kbGroupGlobal" | "kbGroupList" | "kbGroupCalendar";
}[] = [
  { scope: "global", title: "kbGroupGlobal" },
  { scope: "list", title: "kbGroupList" },
  { scope: "calendar", title: "kbGroupCalendar" },
];

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex gap-0.5">
      {keys.map((k) => (
        <kbd
          key={k}
          className="min-w-6 rounded border bg-muted px-1.5 py-0.5 text-center font-mono text-xs"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

/**
 * Settings → Pintasan: change the single-key shortcuts on this device (WCAG 2.1.4). "Ubah" waits
 * for the next key press (Esc cancels); keys used elsewhere in the same scope or in "global" are
 * refused with the action that has them, so there is no silent swap. Ctrl/⌘ combos and the
 * arrow/Enter/Esc keys of focused lists are listed read-only.
 */
export function ShortcutSettings() {
  const { t } = usePreferences();
  const shortcuts = useShortcuts();
  const mac = isMacPlatform();
  const [recording, setRecording] = useState<ShortcutId | null>(null);
  const [message, setMessage] = useState<{ id: ShortcutId; text: string; error: boolean } | null>(
    null,
  );
  const overrides = getShortcutOverrides();
  const hasOverrides = Object.keys(overrides).length > 0;

  useEffect(() => {
    if (!recording) return;
    const id = recording;
    const label = (sid: ShortcutId) => t(shortcuts.find((s) => s.id === sid)!.label);
    const onKey = (e: KeyboardEvent) => {
      // Lone modifiers: keep waiting for the real key (Shift+/ gives "?").
      if (["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock"].includes(e.key)) return;
      // Tab is never a shortcut; it leaves record mode and moves focus as usual (no keyboard trap).
      if (e.key === "Tab") {
        setRecording(null);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(null);
        return;
      }
      // Ctrl/⌘/Alt combos are refused here: setShortcutKey only sees the key itself.
      const r = isAllowedShortcutKey(e)
        ? setShortcutKey(id, e.key)
        : ({ ok: false, reason: "forbidden" } as const);
      if (r.ok) {
        setRecording(null);
        setMessage({
          id,
          error: false,
          text: t("kbRemapSaved", { action: label(id), key: bindingKeys({ key: e.key }, mac)[0]! }),
        });
      } else if (r.reason === "conflict") {
        setMessage({
          id,
          error: true,
          text: t("kbRemapConflict", { action: t(r.conflict.label) }),
        });
      } else {
        setMessage({ id, error: true, text: t("kbRemapForbidden") });
      }
    };
    // Capture phase, so the app's own shortcuts never see the key being recorded.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, shortcuts, t, mac]);

  return (
    <div className="mt-4 space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{t("kbRemapTitle")}</h3>
          <p className="text-xs text-muted-foreground">{t("kbRemapBody")}</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={!hasOverrides}
          onClick={() => {
            resetAllShortcuts();
            setRecording(null);
            setMessage(null);
          }}
        >
          <RotateCcw /> {t("kbRemapResetAll")}
        </Button>
      </div>
      {GROUPS.map((g) => (
        <section key={g.scope} className="space-y-1.5">
          <h4 className="text-xs font-semibold text-muted-foreground">{t(g.title)}</h4>
          <ul className="divide-y rounded-lg border text-sm">
            {shortcuts
              .filter((s) => s.scope === g.scope)
              .map((s) => {
                const remap = remappableBinding(s);
                const fixed = s.bindings.filter((b) => b !== remap);
                const isRecording = recording === s.id;
                const changed = s.id in overrides;
                const action = t(s.label);
                const msg = message?.id === s.id ? message : null;
                return (
                  <li key={s.id} className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1">{action}</span>
                      <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                        {remap &&
                          (isRecording ? (
                            <span className="text-xs text-primary" aria-hidden>
                              {t("kbRemapRecording")}
                            </span>
                          ) : (
                            <Keys keys={bindingKeys(remap, mac)} />
                          ))}
                        {fixed.map((b, i) => (
                          <Fragment key={i}>
                            {(remap || i > 0) && (
                              <span className="text-xs text-muted-foreground">{t("kbOr")}</span>
                            )}
                            <Keys keys={bindingKeys(b, mac)} />
                          </Fragment>
                        ))}
                      </span>
                      {remap ? (
                        <span className="flex shrink-0 items-center gap-1">
                          <Button
                            variant="tertiary"
                            size="sm"
                            aria-label={
                              isRecording ? t("kbRemapCancel") : t("kbRemapChangeLabel", { action })
                            }
                            aria-pressed={isRecording}
                            onClick={() => {
                              setMessage(null);
                              setRecording(isRecording ? null : s.id);
                            }}
                          >
                            {isRecording ? t("kbRemapCancel") : t("kbRemapChange")}
                          </Button>
                          <IconButton
                            label={t("kbRemapResetLabel", { action })}
                            size="icon-sm"
                            className="text-muted-foreground"
                            disabled={!changed}
                            onClick={() => {
                              resetShortcut(s.id);
                              setMessage(null);
                            }}
                          >
                            <RotateCcw />
                          </IconButton>
                        </span>
                      ) : (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {t("kbRemapFixed")}
                        </span>
                      )}
                    </div>
                    {isRecording && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("kbRemapRecordingHint", { action })}
                      </p>
                    )}
                    {msg && (
                      <p
                        role={msg.error ? "alert" : "status"}
                        className={msg.error ? "mt-1 text-xs text-destructive" : "mt-1 text-xs"}
                      >
                        {msg.text}
                      </p>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}
