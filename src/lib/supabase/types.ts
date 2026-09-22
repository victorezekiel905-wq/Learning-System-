// Column-level schema lives in supabase/migrations/*.sql. The JS layer is
// intentionally permissive so every table is usable through the builder.
export type Json = string | number | boolean | null | { [k: string]: Json | undefined } | Json[];
export type Role = "student" | "teacher" | "school_admin" | "it_admin" | "parent" | "platform_admin";
export type DeliveryMode = "live_participation" | "student_paced" | "front_of_class";
export type ActivityKind = "multiple_choice" | "open_ended" | "poll" | "draw" | "fill_blank" | "matching" | "drag_drop" | "collab_board" | "code";
export type CommandKind = "open_tab" | "close_tab" | "redirect" | "focus" | "lock";
export type EventKind = "navigation" | "domain_blocked" | "tab_changed" | "idle" | "offline" | "focus_lost";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyRow = { [k: string]: any };
type TableT = { Row: AnyRow; Insert: AnyRow; Update: AnyRow };
type FnArgs = { [k: string]: any };

export interface Database {
  public: {
    Tables: Record<string, TableT>;
    Views: Record<string, never>;
    Functions: Record<string, { Args: FnArgs; Returns: any }>;
    Enums: Record<string, never>;
  };
}
