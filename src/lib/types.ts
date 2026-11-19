export type UUID = string;

export interface Couple {
  id: UUID;
  name: string;
  child_name: string;
  child_pronoun: "la" | "le";
  pickup_label: string;
  timezone: string;
  default_pickup_time: string; // "17:30:00"
  pickups_enabled?: boolean;
  default_start_time?: string | null;
  usual_days: number[]; // 1 = lundi … 7 = dimanche
  created_by: UUID;
}

export interface Profile {
  evening_summary?: boolean;
  inbox_reminder?: boolean;
  messages_read_at?: string | null;
  id: UUID;
  display_name: string;
  color: string;
}

export interface Pickup {
  id: UUID;
  couple_id: UUID;
  day: string; // YYYY-MM-DD
  time: string; // HH:MM:SS (fin de crèche = récupération)
  start_time?: string | null; // début de crèche
  responsible_id: UUID | null;
  updated_at: string;
}

export interface RelayRequest {
  id: UUID;
  pickup_id: UUID;
  from_user: UUID;
  to_user: UUID;
  status: "pending" | "accepted" | "declined" | "cancelled";
  created_at: string;
}

export interface Topic {
  id: UUID;
  couple_id: UUID;
  title: string;
  kind: "general" | "pickup_week";
  week_start: string | null;
  owner_id: UUID | null;
  proposed_to: UUID | null;
  proposed_by: UUID | null;
  next_action: string | null;
  next_action_date: string | null;
  status: "open" | "closed";
  closed_at: string | null;
  created_by: UUID;
  created_at: string;
  is_private?: boolean;
}

export interface Task {
  id: UUID;
  couple_id: UUID;
  title: string;
  assignee_id: UUID | null;
  due_date: string | null;
  due_time: string | null;
  note: string | null;
  recurrence: "daily" | "weekly" | "biweekly" | "monthly" | null;
  recur_from: UUID | null;
  done: boolean;
  done_at: string | null;
  is_private: boolean;
  owner_id: UUID;
  topic_id: UUID | null;
  created_at: string;
  /** « Vider ma tête » : élément privé pas encore trié. */
  inbox?: boolean;
  category?: string | null;
  snoozed_until?: string | null;
  message_id?: UUID | null;
  /** « Garder comme note » (dans Me le dire). */
  is_note?: boolean;
}

export interface Message {
  id: UUID;
  couple_id: UUID;
  author_id: UUID;
  body: string;
  created_at: string;
}

export interface Appointment {
  id: UUID;
  couple_id: UUID;
  title: string;
  day: string;
  time: string;
  participants: UUID[];
  task_id: UUID | null;
}

export interface List {
  id: UUID;
  couple_id: UUID;
  name: string;
  kind: "items" | "gifts";
  is_private: boolean;
  owner_id: UUID;
  created_at: string;
}

export type GiftStatus = "idea" | "chosen" | "bought";

export interface ListItem {
  id: UUID;
  list_id: UUID;
  label: string;
  quantity: string | null;
  checked: boolean;
  recipient: string | null;
  occasion: string | null;
  note: string | null;
  url: string | null;
  gift_status: GiftStatus | null;
  created_at: string;
}

export interface Goal {
  id: UUID;
  owner_id: UUID;
  title: string;
  due_date: string | null;
  achieved: boolean;
  created_at: string;
}

export interface Snapshot {
  me: UUID;
  couple: Couple;
  profiles: Profile[];
  pickups: Pickup[];
  relays: RelayRequest[];
  topics: Topic[];
  tasks: Task[];
  appointments: Appointment[];
  lists: List[];
  items: ListItem[];
  favorites: UUID[];
  goals: Goal[];
  reactions: TaskReaction[];
  /** Éléments « à trier » (privés, hors planning). */
  inbox?: Task[];
  messages?: Message[];
}

export interface TaskReaction {
  task_id: UUID;
  user_id: UUID;
  emoji: string;
  created_at: string;
}
