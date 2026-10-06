/// <reference types="vite/client" />

/** App version from package.json, injected by `define` in vite.config.ts. */
declare const __APP_VERSION__: string;
/** Short git commit SHA of the build ("dev" when unknown), injected by vite.config.ts. */
declare const __GIT_SHA__: string;
/** ISO timestamp of the build, injected by vite.config.ts. */
declare const __BUILD_TIME__: string;
