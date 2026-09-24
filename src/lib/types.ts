export type Role = "student" | "teacher" | "school_admin" | "it_admin" | "parent" | "platform_admin";

export type Profile = {
  id: string;
  tenant_id: string;
  email: string;
  full_name: string;
  nickname: string | null;
  role: Role;
  status: "active" | "suspended";
};

export type TenantSettings = {
  allow_spotlight: boolean;
  allow_group_chat: boolean;
  allow_screen_capture: boolean;
  store_event_screenshots: boolean;
  require_monitoring_consent: boolean;
  parent_portal_enabled: boolean;
  email_alerts_enabled: boolean;
  nickname_mode: "first_name_initial" | "approved_nickname" | "anonymous";
  learning_retention_days: number;
  telemetry_retention_days: number;
  default_grace_seconds: number;
  default_idle_seconds: number;
  thumbnail_interval_seconds: number;
  monitoring_notice: string;
  monitoring_notice_version: number;
  support_access_until: string | null;
  brand_name: string | null;
  brand_logo_path: string | null;
  brand_primary: string | null;
  brand_accent: string | null;
  welcome_message: string | null;
};

export type Me = {
  profile: Profile | null;
  email?: string;
  tenant?: { id: string; name: string; slug: string; plan_code: string; timezone: string; status?: "active" | "suspended" };
  super_admin?: boolean;
  plan?: { code: string; name: string; limits: Record<string, number | null>; features: Record<string, boolean> };
  settings?: TenantSettings;
  monitoring_consent?: boolean;
  unread_notifications?: number;
};

export type DeliveryMode = "live_participation" | "student_paced" | "front_of_class";

export type SlideKind =
  | "title" | "text" | "image" | "video" | "audio" | "embed" | "link" | "attachment" | "shapes" | "whiteboard" | "activity";

export type Shape = { id: string; type: "rect" | "ellipse" | "arrow" | "text"; x: number; y: number; w: number; h: number; color: string; text?: string };
export type Stroke = { color: string; width: number; points: [number, number][] };

export type SlideContent = {
  heading?: string;
  body?: string;
  url?: string;
  media_path?: string;
  alt?: string;
  captions_path?: string;
  caption?: string;
  shapes?: Shape[];
  strokes?: Stroke[];
  label?: string;
};

export type ActivityKind =
  | "multiple_choice" | "poll" | "open_ended" | "quiz" | "draw" | "fill_blank" | "matching"
  | "drag_drop" | "collab_board" | "file_upload" | "short_answer" | "code";

export type QuestionKind =
  | "mcq" | "multi_select" | "true_false" | "poll" | "open" | "short" | "fill_blank"
  | "matching" | "ordering" | "categorize" | "draw" | "file" | "code";

export type ActivitySettings = {
  time_limit_seconds?: number;
  attempts_allowed?: number;
  shuffle_questions?: boolean;
  shuffle_options?: boolean;
  show_feedback?: "immediately" | "after_submit" | "never";
  rubric_id?: string;
};

export type Item = { id: string; label: string };

/** A question as students receive it (no answer key). */
export type PublicQuestion = {
  id: string;
  kind: QuestionKind;
  prompt: string;
  media: { url?: string; media_path?: string; alt?: string };
  config: {
    blanks?: number;
    left?: Item[];
    right?: Item[];
    items?: Item[];
    categories?: Item[];
    language?: "javascript" | "python" | "html";
    starter?: string;
    tests?: { name: string; input?: string; expected?: string }[];
    partial_credit?: boolean;
    case_sensitive?: boolean;
    max_chars?: number;
  };
  options: Item[];
  points: number;
};

export type GameSettings = {
  question_seconds: number;
  speed_bonus: boolean;
  streak_bonus: boolean;
  rank_visibility: "after_each" | "end_only" | "hidden";
  display_mode: "first_name_initial" | "nickname" | "anonymous";
  team_mode: boolean;
  team_count: number;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  podium_size: number;
  certificates: boolean;
};

export type EnvironmentPolicy = {
  id: string;
  name: string;
  description: string | null;
  allowed_domains: string[];
  blocked_domains: string[];
  blocked_categories: string[];
  required_urls: string[];
  lesson_url: string | null;
  focus_mode: boolean;
  lock_screen: boolean;
  tab_limit: number | null;
  grace_seconds: number;
  idle_seconds: number;
  subject: string | null;
  notify: { banner: boolean; sound: boolean; browser: boolean; email: boolean };
  is_template: boolean;
  owner_id: string;
};

export const ROLE_LABEL: Record<Role, string> = {
  student: "Student",
  teacher: "Teacher",
  school_admin: "School admin",
  it_admin: "IT admin",
  parent: "Parent",
  platform_admin: "Platform admin"
};

export const CATEGORIES = [
  "games", "social", "video", "streaming", "shopping", "chat", "gambling", "adult"
] as const;
