/**
 * Product areas switched off while SwiftCipher focuses on live sessions
 * (docs/LIVE_ENGINE.md). Code and data are kept; turning one back on is this file.
 */
export const FEATURES = {
  /** Direct, group and parent chat (Phase 3). */
  messaging: false,
  /** Parent portal: each linked child's progress (on since 2026-10-08; each school still switches it on). */
  parentPortal: true
} as const;
