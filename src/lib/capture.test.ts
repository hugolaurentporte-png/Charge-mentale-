// node --test src/lib/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, classify, findDuplicate, shoppingLabel } from "./capture.ts";

const TODAY = "2026-11-18"; // mercredi

test("Classement proposé par mots-clés", () => {
  assert.equal(classify("Acheter du lait"), "courses");
  assert.equal(classify("Rappeler la mutuelle"), "administratif");
  assert.equal(classify("Pédiatre pour Juliette"), "famille");
  assert.equal(classify("Réparer la fuite sous l'évier"), "maison");
  assert.equal(classify("Faire une lessive"), "maison");
  assert.equal(classify("Kiné"), "personnel");
  assert.equal(classify("Idée : week-end à Annecy"), "idees");
  assert.equal(classify("Truc machin"), null);
});

test("Dates sûres remplies, dates floues à confirmer", () => {
  const a = analyze("Appeler la banque jeudi à 10 h", TODAY);
  assert.equal(a.date, "2026-11-19");
  assert.equal(a.time, "10:00");
  assert.equal(a.fuzzy, null);
  assert.equal(a.title, "Appeler la banque");
  const b = analyze("Déclarer les impôts la semaine prochaine", TODAY);
  assert.equal(b.date, null);
  assert.deepEqual(b.fuzzy, { phrase: "la semaine prochaine", date: "2026-11-23" });
  assert.equal(b.title, "Déclarer les impôts");
  const c = analyze("Changer l'ampoule bientôt", TODAY);
  assert.equal(c.fuzzy?.date, null);
  assert.equal(c.title, "Changer l'ampoule");
  assert.equal(analyze("Payer la cantine fin du mois", TODAY).fuzzy?.date, "2026-11-30");
  assert.equal(analyze("Ranger le garage ce week-end", TODAY).fuzzy?.date, "2026-11-21");
});

test("Doublons et libellé de courses", () => {
  const items = [{ t: "Lait" }, { t: "Appeler la mutuelle" }];
  assert.equal(findDuplicate("lait", items, (x) => x.t)?.t, "Lait");
  assert.equal(findDuplicate("Appeler la Mutuelle !", items, (x) => x.t)?.t, "Appeler la mutuelle");
  assert.equal(findDuplicate("Mutuelle", items, (x) => x.t)?.t, "Appeler la mutuelle");
  assert.equal(findDuplicate("Pain", items, (x) => x.t), undefined);
  assert.equal(shoppingLabel("Acheter du lait"), "Lait");
  assert.equal(shoppingLabel("Couches"), "Couches");
});
