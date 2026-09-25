import {
  Bell, BookOpen, Building2, ChartColumn, Check, ClipboardList, File, HelpCircle, Home, Image as ImageIcon, KeyRound,
  Laptop, Menu, MessageSquare, Presentation, Radio, Settings, Shield, Trophy, Users, Hand, Lock, ExternalLink,
  X, Monitor, Eye, EyeOff, Plus, Trash2, Upload, Play, Pause, SkipForward, Copy, Megaphone, Wifi, WifiOff, Star, TriangleAlert, Maximize, Paperclip, Award, Flame, Zap, Target, Clock, Lightbulb, PenLine, Users2
} from "lucide-react";

const ICONS = {
  bell: Bell, book: BookOpen, building: Building2, chart: ChartColumn, check: Check, clipboard: ClipboardList,
  file: File, question: HelpCircle, home: Home, image: ImageIcon, key: KeyRound, laptop: Laptop, menu: Menu,
  chat: MessageSquare, slides: Presentation, broadcast: Radio, settings: Settings, shield: Shield, trophy: Trophy,
  users: Users, hand: Hand, lock: Lock, external: ExternalLink, x: X, monitor: Monitor, eye: Eye, eyeOff: EyeOff,
  plus: Plus, trash: Trash2, upload: Upload, play: Play, pause: Pause, next: SkipForward, copy: Copy,
  megaphone: Megaphone, wifi: Wifi, wifiOff: WifiOff, star: Star, alert: TriangleAlert, maximize: Maximize,
  paperclip: Paperclip, award: Award, flame: Flame, zap: Zap, target: Target, clock: Clock, idea: Lightbulb,
  write: PenLine, together: Users2
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  const C = ICONS[name];
  return <C className={className} aria-hidden strokeWidth={2} />;
}
