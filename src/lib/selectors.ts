// Calculs purs de l'accueil et du planning (testés avec node --test).
import type { Appointment, Pickup, RelayRequest, Snapshot, Task, Topic, UUID } from "./types.ts";
import { addDays, weekDays } from "./dates.ts";

/** Une tâche est visible pour moi si elle est partagée ou si elle m'appartient. */
export function visibleTasks(s: Snapshot): Task[] {
  return s.tasks.filter((t) => !t.is_private || t.owner_id === s.me);
}

/** Tâches « à moi » : assignées à moi, privées à moi, ou partagées sans responsable. */
export function isMyTask(t: Task, me: UUID): boolean {
  if (t.is_private) return t.owner_id === me;
  return t.assignee_id === me || t.assignee_id === null;
}

export function pickupOn(s: Snapshot, day: string): Pickup | undefined {
  return s.pickups.find((p) => p.day === day);
}

export function pendingRelayFor(s: Snapshot, pickupId: UUID): RelayRequest | undefined {
  return s.relays.find((r) => r.pickup_id === pickupId && r.status === "pending");
}

export function appointmentsOn(s: Snapshot, day: string): Appointment[] {
  return s.appointments
    .filter((a) => a.day === day)
    .sort((a, b) => a.time.localeCompare(b.time));
}

export function tasksOn(s: Snapshot, day: string): Task[] {
  return visibleTasks(s).filter((t) => t.due_date === day);
}

export interface FollowUp {
  kind: "topic" | "cover";
  topic: Topic;
  /** date à laquelle l'action remonte (prochaine action ou jour à couvrir) */
  date: string;
  overdue: boolean;
  pickup?: Pickup;
}

/** Jours de la semaine organisée qui n'ont encore aucun responsable. */
export function uncoveredDays(s: Snapshot, topic: Topic, today: string): Pickup[] {
  if (topic.kind !== "pickup_week" || !topic.week_start) return [];
  const days = new Set(weekDays(topic.week_start));
  return s.pickups
    .filter((p) => days.has(p.day) && p.responsible_id === null && p.day >= today)
    .sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Suivis du responsable : prochaines actions arrivées à échéance (restent
 * visibles en retard) et jours de crèche à couvrir pour l'organisateur,
 * quel que soit le parent qui fera le trajet.
 */
export function myFollowUps(s: Snapshot, today: string): FollowUp[] {
  const out: FollowUp[] = [];
  for (const t of s.topics) {
    if (t.status !== "open" || t.owner_id !== s.me) continue;
    if (t.next_action_date && t.next_action_date <= today) {
      out.push({ kind: "topic", topic: t, date: t.next_action_date, overdue: t.next_action_date < today });
    }
    if (t.kind === "pickup_week") {
      for (const p of uncoveredDays(s, t, today)) {
        out.push({ kind: "cover", topic: t, date: p.day, overdue: false, pickup: p });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export interface Decision {
  kind: "relay" | "handover";
  relay?: RelayRequest;
  pickup?: Pickup;
  topic?: Topic;
}

/** Ce qui attend une réponse de ma part. */
export function myDecisions(s: Snapshot): Decision[] {
  const out: Decision[] = [];
  for (const r of s.relays) {
    if (r.status === "pending" && r.to_user === s.me) {
      out.push({ kind: "relay", relay: r, pickup: s.pickups.find((p) => p.id === r.pickup_id) });
    }
  }
  for (const t of s.topics) {
    if (t.status === "open" && t.proposed_to === s.me) out.push({ kind: "handover", topic: t });
  }
  return out;
}

export interface TodayView {
  pickup?: Pickup;
  appointments: Appointment[];
  tasks: Task[];
  overdue: Task[];
  followUps: FollowUp[];
  decisions: Decision[];
  tomorrowToOrganize?: Pickup;
}

export function todayView(s: Snapshot, today: string): TodayView {
  const mine = visibleTasks(s).filter((t) => !t.done && isMyTask(t, s.me));
  const tomorrow = pickupOn(s, addDays(today, 1));
  return {
    pickup: pickupOn(s, today),
    appointments: appointmentsOn(s, today),
    tasks: mine.filter((t) => t.due_date === today),
    overdue: mine
      .filter((t) => t.due_date !== null && t.due_date < today)
      .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")),
    followUps: myFollowUps(s, today),
    decisions: myDecisions(s),
    tomorrowToOrganize: tomorrow && tomorrow.responsible_id === null ? tomorrow : undefined,
  };
}

/** Libellé d'état d'un sujet, toujours textuel (jamais la couleur seule). */
export function topicState(t: Topic): "open_unowned" | "owned" | "closed" {
  if (t.status === "closed") return "closed";
  return t.owner_id ? "owned" : "open_unowned";
}
