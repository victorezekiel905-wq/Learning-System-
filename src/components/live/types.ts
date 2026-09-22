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
  open_alerts: number;
  hand_raised: boolean;
};

export type AlertRow = {
  id: string; kind: string; severity: "info" | "warning" | "critical"; rule: string; domain: string | null; confidence: number | null;
  status: string; student_id: string; student: string; created_at: string; resolved_at: string | null;
};

export type ActivityResults = {
  activity: { id: string; title: string; kind: string };
  attempts: number;
  submitted: number;
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
    tenant_id: string; started_at: string;
  };
  settings: { allow_spotlight: boolean; allow_group_chat: boolean; allow_screen_capture: boolean; thumbnail_interval_seconds: number };
  server_now: string;
  roster: RosterEntry[];
  alerts: AlertRow[];
  hands: { id: string; student_id: string; student: string; message: string; created_at: string }[];
  commands: { id: string; kind: string; status: string; error: string | null; student: string; created_at: string }[];
  spotlight: { id: string; student_id: string; anonymized: boolean; show_to_class: boolean; started_at: string } | null;
  activity: ActivityResults | null;
};

export const ALERT_LABEL: Record<string, string> = {
  environment_left: "Left environment",
  domain_blocked: "Blocked site",
  off_task: "Possibly off-task",
  idle: "Idle",
  connection_lost: "Connection lost",
  tab_limit: "Too many tabs"
};
