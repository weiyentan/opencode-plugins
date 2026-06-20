/**
 * Minimal Node.js built-in module declarations for the metrics module.
 *
 * These avoid requiring @types/node as a devDependency. The dynamic
 * import() calls in metrics.ts are guarded — they only execute when
 * persist() or load() is called, not at module import time.
 */

declare module "fs/promises" {
  export function mkdir(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<void>;
  export function readFile(
    path: string,
    encoding: "utf-8",
  ): Promise<string>;
  export function writeFile(
    path: string,
    data: string,
    encoding: "utf-8",
  ): Promise<void>;
  export function rename(
    oldPath: string,
    newPath: string,
  ): Promise<void>;
}

declare module "path" {
  export function dirname(p: string): string;
}
