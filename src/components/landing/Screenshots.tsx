import { cn } from "@/lib/utils";

/*
 * Real screenshots of the seeded demo (docs/screenshots, captured with Playwright; see the README
 * gallery). Vite hashes the imported files into `assets/`; the service worker precache only globs
 * js/css/woff2, so they are fetched on demand (and kept by the runtime `images` cache) instead of
 * growing every install.
 *
 * Theme: both variants are rendered and toggled with the `dark:` variant, which follows the
 * `.dark` class the app sets on <html> (the stored preference, or the system setting for
 * "system"). A `<source media="(prefers-color-scheme: dark)">` would ignore an explicit light or
 * dark choice. The images are `loading="lazy"` and browsers don't fetch lazy images that are
 * `display: none`, so normally only the active theme's file is downloaded.
 *
 * Format: WebP only. Every browser that can run this app (React 19, ES2022 bundles) decodes WebP,
 * so a PNG/JPEG fallback would only add bytes to the repo and deploy; AVIF saves little on these
 * flat UI captures and is slow to encode.
 */

// Only what the landing shows (hero + bento crops): a broader glob would copy all ~50 README shots
// into every deploy.
const FILES = import.meta.glob<string>(
  ["../../../docs/screenshots/landing/*.webp", "../../../docs/screenshots/today-*.webp"],
  {
    eager: true,
    import: "default",
    query: "?url",
  },
);

type Theme = "light" | "dark";

function fileUrl(name: string, theme: Theme): string | undefined {
  return FILES[`../../../docs/screenshots/${name}-${theme}.webp`];
}

const PHONE_QUERY = "(max-width: 639px)";

type Props = {
  /** Path below docs/screenshots without the `-light|-dark.webp` suffix, e.g. "landing/kanban". */
  name: string;
  width: number;
  height: number;
  /** Empty for decorative crops whose card text already says what they show. */
  alt: string;
  /** Optional phone variant (same naming) used below the `sm` breakpoint. */
  phone?: { name: string; width: number; height: number };
  className?: string;
};

function ThemeVariant({
  name,
  width,
  height,
  alt,
  phone,
  className,
  theme,
}: Props & { theme: Theme }) {
  const src = fileUrl(name, theme);
  const phoneSrc = phone && fileUrl(phone.name, theme);
  if (!src) return null;
  return (
    <picture className={theme === "light" ? "contents dark:hidden" : "hidden dark:contents"}>
      {phone && phoneSrc && (
        <source media={PHONE_QUERY} srcSet={phoneSrc} width={phone.width} height={phone.height} />
      )}
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        className={cn("block h-auto w-full", className)}
      />
    </picture>
  );
}

/** A light and a dark `<picture>`; the one matching the app's `.dark` class is shown. */
export function ThemedScreenshot(props: Props) {
  return (
    <>
      <ThemeVariant {...props} theme="light" />
      <ThemeVariant {...props} theme="dark" />
    </>
  );
}
