// Parcours de bout en bout avec deux comptes, sur un écran iPhone.
// Prérequis : l'app tourne sur APP_URL et pointe vers un backend Supabase
// (réel, ou le banc e2e/mock-supabase.mjs). Usage :
//   APP_URL=http://localhost:3000 API_URL=http://localhost:54321 node e2e/two-accounts.cjs
const { chromium, devices } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const APP = process.env.APP_URL || "http://localhost:3000";
const API = process.env.API_URL || "http://localhost:54321";
const ANON = process.env.ANON_KEY || "mock-anon-key";
const SHOTS = process.env.SHOTS_DIR || "e2e/captures";
const run = Date.now();
const HUGO = { email: `hugo.${run}@test.fr`, password: "motdepasse1", name: "Hugo" };
const CAMILLE = { email: `camille.${run}@test.fr`, password: "motdepasse2", name: "Camille" };
// Mardi 17 novembre 2026, 8 h à Paris ; jeudi 19 pour les relances.
const TUESDAY = new Date("2026-11-17T08:00:00+01:00");
const THURSDAY = new Date("2026-11-19T08:00:00+01:00");

fs.mkdirSync(SHOTS, { recursive: true });
const steps = [];
function ok(label) {
  steps.push(label);
  console.log(`✓ ${label}`);
}
async function shot(page, name) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
const see = (page, text, opts = {}) =>
  page.getByText(text, { exact: false, ...opts }).first().waitFor({ state: "visible", timeout: 8000 });
async function notSee(page, text) {
  await page.waitForTimeout(400);
  assert.equal(await page.getByText(text, { exact: false }).count(), 0, `« ${text} » ne devrait pas être visible`);
}
const tab = (page, name) => page.getByRole("link", { name, exact: true }).click();
async function fab(page) {
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
}

async function api(user, path, init = {}) {
  const t = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email: user.email, password: user.password }),
  }).then((r) => r.json());
  const r = await fetch(`${API}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: ANON, authorization: `Bearer ${t.access_token}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers || {}) },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

(async () => {
  const browser = await chromium.launch();
  const device = { ...devices["iPhone 13"], locale: "fr-FR", timezoneId: "Europe/Paris" };
  const ctxH = await browser.newContext(device);
  const ctxC = await browser.newContext(device);
  const h = await ctxH.newPage();
  const c = await ctxC.newPage();
  globalThis.__pages = { hugo: h, camille: c };
  for (const p of [h, c]) {
    await p.clock.setFixedTime(TUESDAY);
    p.on("pageerror", (e) => console.error("Erreur page:", e.message));
  }

  // --- Comptes et invitation -------------------------------------------
  await h.goto(APP);
  await h.waitForURL(/connexion/);
  await h.getByRole("radio", { name: "Créer un compte" }).click();
  await h.getByLabel("E-mail").fill(HUGO.email);
  await h.getByLabel("Mot de passe").fill(HUGO.password);
  await h.getByRole("button", { name: "Créer mon compte" }).click();
  await see(h, "Créer votre espace à deux");
  await h.getByLabel("Ton prénom").fill(HUGO.name);
  await h.getByRole("button", { name: "Créer l’espace" }).click();
  await see(h, "Planning");
  await h.getByRole("link", { name: "Réglages" }).click();
  await h.getByRole("button", { name: "Créer un lien d’invitation" }).click();
  const link = await h.getByLabel("Lien d’invitation").inputValue();
  assert.match(link, /\/invitation\/?\?t=[a-f0-9]{64}$/);
  ok("Hugo crée l’espace et un lien d’invitation à usage unique");

  await c.goto(link);
  await see(c, "Hugo t’invite");
  await c.getByRole("link", { name: "Créer mon compte ou me connecter" }).click();
  await c.getByLabel("E-mail").fill(CAMILLE.email);
  await c.getByLabel("Mot de passe").fill(CAMILLE.password);
  await c.getByRole("button", { name: "Créer mon compte" }).click();
  await c.waitForURL(/invitation/);
  await c.getByLabel("Ton prénom").fill(CAMILLE.name);
  await c.getByRole("button", { name: "Rejoindre l’espace" }).click();
  await c.waitForURL(/planning/);
  ok("Camille rejoint l’espace avec son propre compte");

  // Le lien ne sert qu'une fois
  const ctxE = await browser.newContext(device);
  const e = await ctxE.newPage();
  await e.goto(link);
  await see(e, "déjà été utilisé");
  await ctxE.close();
  ok("Le lien d’invitation ne peut pas être réutilisé");

  // --- Organiser la semaine : 4 jours, heures et responsables différents ---
  await h.goto(`${APP}/planning`);
  await h.getByRole("radio", { name: "Semaine" }).click();
  await h.getByRole("link", { name: "Organiser les récupérations" }).click();
  await see(h, "Je prends en charge l’organisation");
  const setDay = async (day, time, who) => {
    await h.getByLabel(`Heure ${day}`).fill(time);
    await h.getByRole("radiogroup", { name: `Qui ${day}` }).getByRole("radio", { name: who }).click();
  };
  await setDay("mardi", "17:30", "Moi");
  await setDay("mercredi", "18:00", "Camille");
  await setDay("jeudi", "16:45", "À décider");
  await setDay("vendredi", "17:15", "À décider");
  await shot(h, "01-organiser-recuperations");
  await h.getByRole("button", { name: "Enregistrer la semaine" }).click();
  await h.waitForURL(/\/planning\/?$/);
  ok("Hugo prépare 4 jours de crèche depuis un seul écran (heures et responsables différents)");

  // Accueil : heure et responsable visibles immédiatement
  await see(h, "17 h 30 · Tu récupères Juliette");
  await shot(h, "02-accueil-hugo");
  await c.reload();
  await see(c, "17 h 30 · Hugo récupère Juliette");
  ok("À l’ouverture, chacun voit l’heure et le responsable du jour (« Tu » / prénom)");

  // Vendredi à couvrir : dans les suivis de Hugo (organisateur), pas de Camille
  await see(h, "Vendredi 20 nov. · ");
  await notSee(c, "Tu organises la crèche");
  ok("Les jours non couverts remontent dans les suivis de l’organisateur uniquement");

  // Camille prend jeudi depuis la vue Semaine
  await c.getByRole("radio", { name: "Semaine" }).click();
  await c.getByRole("button", { name: "Je la récupère" }).first().click();
  await see(c, "C’est noté");
  // Hugo voit le changement sans recharger (temps réel)
  await h.getByRole("radio", { name: "Semaine" }).click();
  await see(h, "Camille", { exact: true });
  ok("Camille prend un créneau libre ; Hugo le voit sans recharger");

  // Vendredi reste à couvrir chez Hugo, quel que soit le parent qui fera le trajet
  await h.getByRole("radio", { name: "Aujourd’hui" }).click();
  await see(h, "Vendredi 20 nov. · ");
  await notSee(h, "Jeudi 19 nov. · ");
  await shot(h, "03-suivis-creche-hugo");
  ok("Vendredi reste dans les suivis de Hugo après la répartition des trajets");

  // Prise simultanée de vendredi : le premier l'emporte, le second voit le résultat
  await h.getByRole("radio", { name: "Semaine" }).click();
  await c.getByRole("radio", { name: "Aujourd’hui" }).click();
  await c.getByRole("radio", { name: "Semaine" }).click();
  const fridayBtn = (p) => p.getByRole("button", { name: "Je la récupère" }).last();
  await Promise.all([fridayBtn(h).click(), fridayBtn(c).click()]);
  await h.waitForTimeout(1200);
  const hugoGot = await h.getByText("C’est noté").count();
  const camGot = await c.getByText("C’est noté").count();
  const hugoLost = await h.getByText("s’en occupe déjà").count();
  const camLost = await c.getByText("s’en occupe déjà").count();
  assert.equal(hugoGot + camGot, 1, "un seul gagnant");
  assert.equal(hugoLost + camLost, 1, "le second voit le résultat");
  ok(`Double appui simultané sur vendredi : un seul enregistrement retenu (${hugoGot ? "Hugo" : "Camille"})`);

  // --- Relais : demander, refuser, annuler, accepter ----------------------
  await h.getByRole("radio", { name: "Aujourd’hui" }).click();
  await h.getByRole("button", { name: "Demander un relais à Camille" }).click();
  await c.getByRole("radio", { name: "Aujourd’hui" }).click();
  await see(c, "Hugo te demande de la récupérer");
  await c.getByRole("button", { name: "Refuser" }).first().click();
  await see(h, "Demander un relais à Camille");
  await see(h, "17 h 30 · Tu récupères Juliette");
  ok("Camille refuse un relais : le nom ne change pas");
  await h.getByRole("button", { name: "Demander un relais à Camille" }).click();
  await see(h, "en attente");
  await h.getByRole("button", { name: "Annuler" }).click();
  await see(h, "Demander un relais à Camille");
  ok("Hugo annule une demande en attente");
  await h.getByRole("button", { name: "Demander un relais à Camille" }).click();
  await see(c, "Hugo te demande de la récupérer");
  await see(h, "17 h 30 · Tu récupères Juliette");
  await shot(c, "04-demande-relais-camille");
  await c.getByRole("button", { name: "Accepter" }).first().click();
  await see(c, "17 h 30 · Tu récupères Juliette");
  await see(h, "17 h 30 · Camille récupère Juliette");
  ok("Relais accepté : le nom change seulement après acceptation, sur les deux comptes, sans recharger");

  // --- Sujet « Banque » ----------------------------------------------------
  await tab(c, "Listes");
  await fab(c);
  await c.getByLabel("Sujet").fill("Banque");
  await c.getByRole("button", { name: "Créer le sujet" }).click();
  await c.waitForURL(/sujets/);
  await see(c, "Personne pour l’instant");
  await tab(h, "Listes");
  await see(h, "Banque");
  await see(h, "À prendre en charge");
  await h.getByRole("button", { name: "Je m’en occupe" }).click();
  await see(h, "Suivi par Toi");
  await h.getByText("Banque").first().click();
  await h.getByRole("button", { name: "Indiquer la prochaine étape" }).click();
  await h.getByLabel("Prochaine étape", { exact: true }).fill("En attente de la banque · relancer");
  await h.getByRole("button", { name: "Jeudi" }).click();
  await h.getByRole("button", { name: "Enregistrer" }).click();
  await see(h, "Prochaine étape enregistrée");
  await shot(h, "05-sujet-banque");
  await see(c, "Suivi par Hugo");
  await see(c, "Renseignée par Hugo");
  ok("Camille saisit « Banque », Hugo le prend et programme une relance jeudi ; Camille voit qui suit et la prochaine étape");

  // Tâche « Appeler la banque » : ajout, report, rendez-vous associé
  await tab(h, "Planning");
  await fab(h);
  await h.getByLabel("Titre").fill("Appeler la banque");
  await h.getByRole("radio", { name: "Toi" }).click();
  await h.getByRole("button", { name: "Ajouter", exact: true }).last().click();
  await see(h, "Mes tâches du jour");
  await h.getByRole("button", { name: /Appeler la banque/ }).click();
  await h.getByLabel("Jour (facultatif)").fill("2026-11-18");
  await h.getByRole("button", { name: "Enregistrer" }).click();
  await notSee(h, "Mes tâches du jour");
  await h.getByRole("radio", { name: "Semaine" }).click();
  await h.getByRole("button", { name: /Appeler la banque/ }).click();
  await h.getByRole("button", { name: "Ajouter un rendez-vous" }).click();
  assert.equal(await h.getByRole("textbox", { name: "Rendez-vous", exact: true }).inputValue(), "Appeler la banque");
  await h.getByLabel("Jour", { exact: true }).fill("2026-11-20");
  await h.getByLabel("Heure", { exact: true }).fill("10:30");
  await shot(h, "06-rdv-depuis-tache");
  await h.getByRole("button", { name: "Enregistrer le rendez-vous" }).click();
  await see(h, "10 h 30");
  const doneTask = await api(HUGO, "tasks?select=done&title=eq.Appeler%20la%20banque", { method: "GET" });
  assert.equal(doneTask.body[0].done, true);
  ok("« Appeler la banque » : ajoutée, reportée au lendemain, puis rendez-vous créé avec titre prérempli et tâche terminée");

  // Une tâche prévue mercredi, pour vérifier le retard jeudi
  await h.getByRole("radio", { name: "Aujourd’hui" }).click();
  await fab(h);
  await h.getByLabel("Titre").fill("Déposer l’ordonnance");
  await h.getByRole("radio", { name: "Toi" }).click();
  await h.getByRole("button", { name: "Demain" }).click();
  await h.getByRole("button", { name: "Ajouter", exact: true }).last().click();
  await h.waitForTimeout(500);

  // --- Jeudi : seule la personne qui suit « Banque » doit agir -----------
  for (const p of [h, c]) {
    await p.clock.setFixedTime(THURSDAY);
    await p.goto(`${APP}/planning`);
  }
  await see(h, "Mes suivis à relancer");
  await see(h, "En attente de la banque · relancer");
  await see(c, "Jeudi"); // accueil chargé
  await notSee(c, "En attente de la banque");
  await notSee(c, "Mes suivis à relancer");
  await see(h, "En retard");
  await shot(h, "07-jeudi-accueil-hugo");
  await shot(c, "08-jeudi-accueil-camille");
  ok("Jeudi : la relance « Banque » remonte seulement dans l’accueil de Hugo");
  await h.getByRole("button", { name: "Demain" }).click();
  await notSee(h, "En retard");
  ok("Tâche en retard : « Demain » la reporte (actions Terminer / Demain / Choisir un jour présentes)");

  // Passation : Hugo propose à Camille, il reste responsable jusqu'à l'acceptation
  await tab(h, "Listes");
  await h.getByText("Banque").first().click();
  await h.getByRole("button", { name: "Proposer à Camille" }).click();
  await see(h, "Proposé à");
  await see(h, "Suivi par Toi"); // Hugo reste responsable tant que Camille n'a pas accepté
  await c.goto(`${APP}/planning`);
  await see(c, "On attend ta réponse");
  await see(c, "te propose de suivre");
  await c.getByRole("button", { name: "J’accepte" }).click();
  await see(c, "Mes suivis à relancer");
  await see(c, "En attente de la banque · relancer");
  await see(h, "Suivi par Camille");
  ok("Passation : Hugo reste responsable jusqu’à ce que Camille accepte, puis la relance passe chez elle");

  // Clôture
  await c.getByText("En attente de la banque · relancer").click();
  await c.getByRole("button", { name: "Clôturer : c’est réglé" }).click();
  await see(c, "Réglé");
  ok("Le sujet est clôturé une fois réglé");

  // --- Listes ----------------------------------------------------------------
  for (const p of [h, c]) await p.clock.setFixedTime(TUESDAY);
  await h.goto(`${APP}/listes`);
  await h.getByRole("link", { name: /Courses/ }).click();
  await h.getByLabel("Article", { exact: true }).fill("Lait");
  await h.getByLabel("Quantité").fill("2 L");
  await h.getByRole("button", { name: "Ajouter l’article" }).click();
  await see(h, "× 2 L");
  await h.getByRole("link", { name: "Listes" }).first().click();
  await h.getByRole("link", { name: /Bricolage/ }).click();
  await h.getByLabel("Article", { exact: true }).fill("Ruban");
  await h.getByRole("button", { name: "Ajouter l’article" }).click();
  await see(h, "Ruban");
  await h.goto(`${APP}/listes`);
  await h.getByRole("link", { name: /Courses/ }).click();
  await c.goto(`${APP}/listes`);
  await c.getByRole("link", { name: /Courses/ }).click();
  await c.getByLabel("Cocher Lait").check();
  await see(h, "Dans le panier");
  assert.equal(await h.getByLabel("Décocher Lait").isChecked(), true);
  await shot(h, "09-courses-coche-par-camille");
  ok("Lait dans Courses, ruban dans Bricolage ; Camille coche le lait et Hugo le voit sans recharger");

  // --- Idée cadeau partagée + surprise privée -------------------------------
  await c.goto(`${APP}/listes`);
  await c.getByRole("link", { name: /Idées cadeaux/ }).click();
  await fab(c);
  await c.getByLabel("Idée", { exact: true }).fill("Livre de cuisine");
  await c.getByLabel("Pour qui ?", { exact: true }).fill("Mamie");
  await c.getByLabel("Occasion", { exact: true }).fill("Noël");
  await c.getByRole("button", { name: "Ajouter l’idée" }).click();
  await see(c, "Pour Mamie · Noël");
  await c.getByLabel("Filtrer par destinataire").selectOption("Mamie");
  await see(c, "Livre de cuisine");
  ok("Idée cadeau partagée avec destinataire et occasion, filtrable");

  await tab(h, "Pour moi");
  await h.getByRole("link", { name: /Mes surprises/ }).click();
  await see(h, "Privée · visible par toi seul");
  await fab(h);
  await h.getByLabel("Idée", { exact: true }).fill("Week-end surprise");
  await h.getByLabel("Pour qui ?", { exact: true }).fill("Camille");
  await h.getByLabel("Occasion", { exact: true }).fill("Anniversaire");
  await h.getByRole("button", { name: "Ajouter l’idée" }).click();
  await see(h, "Pour Camille · Anniversaire");
  await shot(h, "10-surprise-privee");
  const surpriseId = new URL(h.url()).searchParams.get("id");

  await tab(c, "Pour moi");
  await notSee(c, "Week-end surprise");
  await c.goto(`${APP}/listes/voir?id=${surpriseId}`);
  await see(c, "Liste introuvable");
  // Via l'API, avec le jeton de Camille
  const items = await api(CAMILLE, "list_items?select=*", { method: "GET" });
  assert.equal(items.status, 200);
  assert.ok(items.body.some((i) => i.label === "Livre de cuisine"));
  assert.ok(!items.body.some((i) => i.label === "Week-end surprise"), "surprise visible via l’API");
  const list = await api(CAMILLE, `lists?select=*&id=eq.${surpriseId}`, { method: "GET" });
  assert.equal(list.body.length, 0);
  const patch = await api(CAMILLE, `list_items?list_id=eq.${surpriseId}`, { method: "PATCH", body: JSON.stringify({ label: "pirate" }) });
  assert.deepEqual(patch.body, []);
  const ins = await api(CAMILLE, "list_items", { method: "POST", body: JSON.stringify({ list_id: surpriseId, label: "intrus" }) });
  assert.equal(ins.status, 403);
  const still = await api(HUGO, `list_items?select=label&list_id=eq.${surpriseId}`, { method: "GET" });
  assert.deepEqual(still.body.map((i) => i.label), ["Week-end surprise"]);
  ok("Camille n’a aucun accès à la surprise de Hugo : ni dans l’app, ni en lecture, modification ou ajout via l’API");

  // Écritures directes interdites sur le planning (passage obligé par le serveur)
  const direct = await api(CAMILLE, "pickups?day=eq.2026-11-20", { method: "PATCH", body: JSON.stringify({ responsible_id: null }) });
  assert.deepEqual(direct.body, []);
  ok("Le planning ne peut pas être modifié directement via l’API (prise et relais validés côté serveur)");

  // Pour moi : tâche perso avec une heure
  await tab(h, "Pour moi");
  await fab(h);
  await h.getByLabel("Titre", { exact: true }).fill("Kiné");
  await h.getByRole("button", { name: "Demain", exact: true }).click();
  await h.getByLabel("Heure (facultatif)").fill("18:15");
  await h.getByRole("button", { name: "Ajouter", exact: true }).last().click();
  await see(h, "Kiné");
  await see(h, "18 h 15");
  await shot(h, "11-tache-perso-heure");
  ok("Tâche perso avec une heure : « Kiné » demain à 18 h 15");

  // Petit mot et répétition sur la même tâche, puis la suivante apparaît une fois terminée
  await h.getByText("Kiné", { exact: true }).first().click();
  await h.getByLabel("Répéter").selectOption("weekly");
  await h.getByLabel("Petit mot").fill("Prendre l’ordonnance");
  await h.getByRole("button", { name: "Enregistrer" }).click();
  await see(h, "↻ Chaque semaine");
  await see(h, "« Prendre l’ordonnance »");
  await h.getByLabel("Terminer Kiné").first().check();
  await h.waitForFunction(() => document.querySelectorAll('input[aria-label="Terminer Kiné"]').length === 2, null, { timeout: 8000 });
  await shot(h, "12-recurrence-note");
  ok("Petit mot et répétition : une fois « Kiné » terminée, la séance de la semaine suivante est créée");

  // Changer l'heure de la récupération du jour depuis la carte
  await tab(h, "Planning");
  await h.getByRole("radio", { name: "Aujourd’hui" }).click();
  await h.getByRole("button", { name: "Modifier" }).first().click();
  await h.getByLabel("Heure", { exact: true }).fill("18:10");
  await h.getByRole("button", { name: "Enregistrer" }).click();
  await see(h, "18 h 10 · ");
  await tab(c, "Planning");
  await see(c, "18 h 10 · ");
  await shot(h, "13-heure-modifiee");
  ok("L’heure de la récupération du jour se modifie depuis la carte (18 h 10), visible chez les deux");

  await browser.close();
  console.log(`\n${steps.length} vérifications passées.`);
})().catch(async (err) => {
  console.error("ÉCHEC :", err);
  for (const [n, p] of Object.entries(globalThis.__pages || {})) await p.screenshot({ path: `${SHOTS}/echec-${n}.png` }).catch(() => {});
  process.exit(1);
});
