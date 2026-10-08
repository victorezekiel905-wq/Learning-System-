import type { LiveTimer } from "@/components/game/LiveGame";
export type RosterEntry = {
  student_id: string;
  name: string;
  presence: "not_joined" | "online" | "idle" | "offline" | "connecting";
  last_seen_at: string | null;
  current_slide: number | null;
  device: null | {
    device_id: string; url: string | null; domain: string | null; title: string | null; tab_count: number | null;
    idle_state: string; online: boolean; last_heartbeat_at: string; focus_locked: boolean;
    violation: string | null; violation_since: string | null; snapshot_at: string | null;
  };
  /** What the lesson page itself reports (screen share + focus), no extension needed. */
  web: null | {
    sharing: boolean; unsupported: boolean; surface: string | null; visible: boolean; fullscreen: boolean;
    away_since: string | null; away_reason: string | null;
  };
  open_alerts: number;
  hand_raised: boolean;
  /** Joined with the code and a name, no account (0860). */
  guest?: boolean;
  avatar?: string | null;
  score?: number;
  streak?: number;
};

export type AlertRow = {
  id: string; kind: string; severity: "info" | "warning" | "critical"; rule: string; domain: string | null; confidence: number | null;
  status: string; student_id: string; student: string; created_at: string; resolved_at: string | null; has_evidence?: boolean;
};

export type ActivityResults = {
  activity: { id: string; title: string; kind: string };
  attempts: number;
  submitted: number;
  /** Live engine (0900): students who answered, people in the lesson, and whether answers were revealed. */
  answered?: number; joined?: number; revealed?: boolean;
  questions: {
    question_id: string; prompt: string; kind: string; points: number; responses: number; correct: number; avg_elapsed_ms: number | null;
    options: { id: string; label: string; is_correct: boolean; count: number }[];
    text_responses: { student: string; response: Record<string, unknown>; status: string; answer_id: string }[];
  }[];
};

export type SessionState = {
  session: {
    id: string; title: string; status: string; mode: string; join_code: string; class_id: string; lesson_id: string | null;
    current_slide: number; active_activity_id: string | null; environment_id: string | null; environment_active: boolean;
    group_chat_enabled: boolean; responses_visible: boolean; class_name: string; lesson_title: string | null; environment_name: string | null;
    tenant_id: string; started_at: string; lockdown: boolean;
    guest_monitoring?: boolean; guests_closed?: boolean;
    /** Live engine (0880). Missing on older databases (treated as active). */
    phase?: "lobby" | "active" | "paused" | "ended";
    settings?: { leaderboard?: boolean; anonymous_names?: boolean; late_join?: boolean; speed_bonus?: boolean; timer?: boolean; auto_reveal?: boolean };
    show_leaderboard?: boolean;
    leaderboard?: { at: string; top: { name: string; avatar: string | null; score: number; rank: number; delta: number }[] } | null;
  };
  /** Points (0890): the live top 10, for the teacher only. */
  ranking?: { user_id: string; name: string; avatar: string | null; score: number; rank: number; streak: number }[];
  settings: {
    monitoring_enabled?: boolean;
    allow_spotlight: boolean; allow_group_chat: boolean; allow_screen_capture: boolean; thumbnail_interval_seconds: number;
    store_event_screenshots?: boolean;
  };
  server_now: string;
  roster: RosterEntry[];
  alerts: AlertRow[];
  hands: { id: string; student_id: string; student: string; message: string; created_at: string }[];
  commands: { id: string; kind: string; status: string; error: string | null; student: string; created_at: string }[];
  spotlight: { id: string; student_id: string; anonymized: boolean; show_to_class: boolean; started_at: string } | null;
  activity: ActivityResults | null;
  /** Countdown on the activity on screen (0940). */
  timer?: LiveTimer | null;
};

export const ALERT_LABEL: Record<string, string> = {
  environment_left: "Left class",
  domain_blocked: "Blocked site",
  off_task: "Possibly off-task",
  idle: "Idle",
  connection_lost: "Connection lost",
  tab_limit: "Too many tabs"
};
