import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSpoken } from "./speech.ts";

const today = "2026-11-17"; // mardi

test("tâche récurrente dictée", () => {
  assert.deepEqual(parseSpoken("Sortir les poubelles tous les mardis à 20h", today), {
    title: "Sortir les poubelles", date: "2026-11-17", time: "20:00", recurrence: "weekly",
  });
  assert.deepEqual(parseSpoken("payer la crèche chaque mois", today), {
    title: "Payer la crèche", date: "2026-11-17", time: null, recurrence: "monthly",
  });
});

test("jour et heure", () => {
  assert.deepEqual(parseSpoken("appeler la banque demain à 18 h 30", today), {
    title: "Appeler la banque", date: "2026-11-18", time: "18:30", recurrence: null,
  });
  assert.deepEqual(parseSpoken("Kiné jeudi à neuf heures", today), {
    title: "Kiné", date: "2026-11-19", time: "09:00", recurrence: null,
  });
  assert.deepEqual(parseSpoken("il faut acheter du pain", today), {
    title: "Acheter du pain", date: null, time: null, recurrence: null,
  });
  assert.equal(parseSpoken("Pharmacie à midi", today).time, "12:00");
});
