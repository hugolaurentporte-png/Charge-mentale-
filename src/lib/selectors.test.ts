// node --test src/lib/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { myFollowUps, todayView } from "./selectors.ts";
import { formatTime, relativeDay, todayIn, weekStart } from "./dates.ts";
import type { Snapshot, Topic } from "./types.ts";

const HUGO = "h";
const CAMILLE = "c";

function snap(me: string, extra: Partial<Snapshot> = {}): Snapshot {
  return {
    me,
    couple: {
      id: "k", name: "", child_name: "Juliette", child_pronoun: "la",
      pickup_label: "Récupération crèche", timezone: "Europe/Paris",
      default_pickup_time: "17:30:00", usual_days: [1, 2, 3, 4, 5], created_by: HUGO,
    },
    profiles: [], pickups: [], relays: [], topics: [], tasks: [], appointments: [],
    lists: [], items: [], favorites: [], goals: [],
    ...extra,
  };
}

const topic = (o: Partial<Topic>): Topic => ({
  id: "t", couple_id: "k", title: "Banque", kind: "general", week_start: null,
  owner_id: null, proposed_to: null, proposed_by: null, next_action: null,
  next_action_date: null, status: "open", closed_at: null, created_by: HUGO,
  created_at: "", ...o,
});

test("Banque : jeudi, seule la responsable doit agir, et reste visible en retard", () => {
  const banque = topic({ owner_id: CAMILLE, next_action: "Relancer", next_action_date: "2026-11-19" });
  assert.equal(myFollowUps(snap(CAMILLE, { topics: [banque] }), "2026-11-18").length, 0);
  assert.equal(myFollowUps(snap(CAMILLE, { topics: [banque] }), "2026-11-19").length, 1);
  assert.equal(myFollowUps(snap(HUGO, { topics: [banque] }), "2026-11-19").length, 0);
  const late = myFollowUps(snap(CAMILLE, { topics: [banque] }), "2026-11-20");
  assert.equal(late.length, 1);
  assert.equal(late[0].overdue, true);
});

test("Crèche : vendredi non couvert remonte chez l'organisateur, pas chez l'autre", () => {
  const week = topic({ id: "w", kind: "pickup_week", week_start: "2026-11-16", owner_id: HUGO, title: "Organiser la crèche" });
  const pickups = [
    { id: "1", couple_id: "k", day: "2026-11-18", time: "18:00:00", responsible_id: CAMILLE, updated_at: "" },
    { id: "2", couple_id: "k", day: "2026-11-19", time: "17:30:00", responsible_id: HUGO, updated_at: "" },
    { id: "3", couple_id: "k", day: "2026-11-20", time: "17:30:00", responsible_id: null, updated_at: "" },
  ];
  const hugo = myFollowUps(snap(HUGO, { topics: [week], pickups }), "2026-11-17");
  assert.deepEqual(hugo.map((f) => f.date), ["2026-11-20"]);
  assert.equal(myFollowUps(snap(CAMILLE, { topics: [week], pickups }), "2026-11-17").length, 0);
  // Une fois vendredi couvert par Camille, le suivi disparaît.
  pickups[2].responsible_id = CAMILLE;
  assert.equal(myFollowUps(snap(HUGO, { topics: [week], pickups }), "2026-11-17").length, 0);
});

test("Accueil : tâches privées seulement pour leur propriétaire, retard trié", () => {
  const base = { couple_id: "k", done: false, done_at: null, due_time: null, note: null, recurrence: null, recur_from: null, topic_id: null, created_at: "" };
  const tasks = [
    { ...base, id: "a", title: "Surprise", assignee_id: null, due_date: "2026-11-17", is_private: true, owner_id: HUGO },
    { ...base, id: "b", title: "Pharmacie", assignee_id: null, due_date: "2026-11-17", is_private: false, owner_id: HUGO },
    { ...base, id: "c", title: "Banque", assignee_id: CAMILLE, due_date: "2026-11-15", is_private: false, owner_id: HUGO },
  ];
  const c = todayView(snap(CAMILLE, { tasks }), "2026-11-17");
  assert.deepEqual(c.tasks.map((t) => t.id), ["b"]);
  assert.deepEqual(c.overdue.map((t) => t.id), ["c"]);
  const h = todayView(snap(HUGO, { tasks }), "2026-11-17");
  assert.deepEqual(h.tasks.map((t) => t.id).sort(), ["a", "b"]);
  assert.equal(h.overdue.length, 0);
});

test("Dates en français et fuseau Europe/Paris", () => {
  assert.equal(formatTime("17:30:00"), "17 h 30");
  assert.equal(formatTime("18:00:00"), "18 h");
  assert.equal(weekStart("2026-11-22"), "2026-11-16");
  assert.equal(relativeDay("2026-11-18", "2026-11-17"), "Demain");
  // 23 h 30 UTC le 17/11 = 00 h 30 le 18/11 à Paris
  assert.equal(todayIn("Europe/Paris", new Date("2026-11-17T23:30:00Z")), "2026-11-18");
});

test("Accueil : pas de doublon entre la carte du jour/demain et les suivis, et plus rien à décider une fois l'heure passée", () => {
  const week = topic({ id: "w", kind: "pickup_week", week_start: "2026-11-16", owner_id: HUGO, title: "Organiser la crèche" });
  const pickups = [
    { id: "1", couple_id: "k", day: "2026-11-17", time: "17:30:00", responsible_id: null, updated_at: "" },
    { id: "2", couple_id: "k", day: "2026-11-18", time: "17:30:00", responsible_id: null, updated_at: "" },
    { id: "3", couple_id: "k", day: "2026-11-20", time: "17:30:00", responsible_id: null, updated_at: "" },
  ];
  const s = snap(HUGO, { topics: [week], pickups });
  const morning = todayView(s, "2026-11-17", "09:00");
  assert.equal(morning.pickup?.id, "1");
  assert.equal(morning.tomorrowToOrganize?.id, "2");
  assert.deepEqual(morning.followUps.map((f) => f.date), ["2026-11-20"]);
  const evening = todayView(s, "2026-11-17", "21:52");
  assert.equal(evening.pickup, undefined);
  assert.deepEqual(evening.followUps.map((f) => f.date), ["2026-11-20"]);
});
