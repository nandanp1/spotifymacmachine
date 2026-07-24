import type { AuraDesktopApi } from "../shared/types";

declare global {
  interface Window {
    readonly aura: AuraDesktopApi;
  }
}

export {};
