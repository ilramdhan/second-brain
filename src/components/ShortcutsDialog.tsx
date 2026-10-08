import { Fragment } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePreferences } from "@/lib/preferences";
import {
  activeBindings,
  bindingKeys,
  isMacPlatform,
  SHORTCUTS,
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

/** `?` cheat-sheet, rendered from the same SHORTCUTS list the handlers use. */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, singleKeyShortcuts } = usePreferences();
  const mac = isMacPlatform();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("kbTitle")}</DialogTitle>
          <DialogDescription>{t("kbDescription")}</DialogDescription>
        </DialogHeader>
        {GROUPS.map((g) => (
          <section key={g.scope} className="space-y-2">
            <h3 className="text-sm font-semibold">{t(g.title)}</h3>
            <dl className="divide-y rounded-lg border text-sm">
              {SHORTCUTS.filter((s) => s.scope === g.scope).map((s) => ({
                s,
                bindings: activeBindings(s, singleKeyShortcuts),
              }))
                .filter(({ bindings }) => bindings.length > 0)
                .map(({ s, bindings }) => (
                <div key={s.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <dt>{t(s.label)}</dt>
                  <dd className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    {bindings.map((b, i) => (
                      <Fragment key={i}>
                        {i > 0 && (
                          <span className="text-xs text-muted-foreground">{t("kbOr")}</span>
                        )}
                        <span className="flex gap-0.5">
                          {bindingKeys(b, mac).map((k) => (
                            <kbd
                              key={k}
                              className="min-w-6 rounded border bg-muted px-1.5 py-0.5 text-center font-mono text-xs"
                            >
                              {k}
                            </kbd>
                          ))}
                        </span>
                      </Fragment>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <p className="text-xs text-muted-foreground">
          {singleKeyShortcuts ? t("kbHint") : t("kbSingleKeyOff")}
        </p>
      </DialogContent>
    </Dialog>
  );
}
