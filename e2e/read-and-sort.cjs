// Parcours ciblé : pastille « non lu » qui part une fois le message vu, et tri d'un
// élément « Me le dire » en tâche avec rappel / rendez-vous / sujet.
// Même prérequis que two-accounts.cjs.
const { chromium, devices } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const APP = process.env.APP_URL || "http://localhost:3000";
const API = process.env.API_URL || "http://localhost:54321";
const ANON = process.env.ANON_KEY || "mock-anon-key";
const SHOTS = process.env.SHOTS_DIR || "e2e/captures";
fs.mkdirSync(SHOTS, { recursive: true });
const run = Date.now();
const HUGO = { email: `hugo.${run}@test.fr`, password: "motdepasse1", name: "Hugo" };
const CAM = { email: `camille.${run}@test.fr`, password: "motdepasse2", name: "Camille" };
const see = (p, t) => p.getByText(t, { exact: false }).first().waitFor({ state: "visible", timeout: 8000 });
const ok = (l) => console.log(`✓ ${l}`);
async function api(user, path) {
  const t = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email: user.email, password: user.password }),
  }).then((r) => r.json());
  return fetch(`${API}/rest/v1/${path}`, { headers: { apikey: ANON, authorization: `Bearer ${t.access_token}` } }).then((r) => r.json());
}
(async () => {
  const browser = await chromium.launch();
  const device = { ...devices["iPhone 13"], locale: "fr-FR", timezoneId: "Europe/Paris" };
  const h = await (await browser.newContext(device)).newPage();
  const c = await (await browser.newContext(device)).newPage();
  for (const p of [h, c]) p.on("pageerror", (e) => console.error("Erreur page:", e.message));
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
  await c.goto(link);
  await c.getByRole("link", { name: "Créer mon compte ou me connecter" }).click();
  await c.getByLabel("E-mail").fill(CAM.email);
  await c.getByLabel("Mot de passe").fill(CAM.password);
  await c.getByRole("button", { name: "Créer mon compte" }).click();
  await c.waitForURL(/invitation/);
  await c.getByLabel("Ton prénom").fill(CAM.name);
  await c.getByRole("button", { name: "Rejoindre l’espace" }).click();
  await c.waitForURL(/planning/);
  await h.goto(`${APP}/planning`);

  // Camille écrit ; Hugo voit la pastille, ouvre Échanges : elle part, et ne revient pas.
  await c.getByRole("link", { name: "Échanges" }).click();
  await c.getByPlaceholder("Écrire un message…").fill("Oui");
  await c.getByRole("button", { name: /envoyer/i }).click();
  const badge = h.getByLabel(/message.* non lu/);
  await badge.waitFor({ state: "visible", timeout: 8000 });
  ok("La pastille apparaît chez Hugo");
  await h.getByRole("link", { name: /Échanges/ }).click();
  await see(h, "Oui");
  await badge.waitFor({ state: "detached", timeout: 8000 });
  await h.getByRole("link", { name: "Planning" }).click({ force: true });
  await h.waitForTimeout(1500);
  assert.equal(await h.getByLabel(/message.* non lu/).count(), 0, "pastille revenue");
  ok("La pastille disparaît une fois le message vu et ne revient pas");

  // Me le dire → tâche avec rappel
  await h.getByRole("link", { name: "Pour moi" }).click();
  for (const txt of ["Rappeler le plombier", "Carte grise", "Banque"]) {
    await h.getByLabel("Me le dire", { exact: true }).fill(txt);
    await h.getByRole("button", { name: "Me le dire, envoyer" }).click();
    await see(h, `À trier (${["Rappeler le plombier", "Carte grise", "Banque"].indexOf(txt) + 1})`);
  }
  await h.getByRole("button", { name: "Trier" }).first().click();
  await h.getByLabel("Me le rappeler", { exact: false }).check().catch(async () => h.getByText("Me le rappeler").click());
  await h.getByLabel("Heure du rappel").fill("09:30");
  await h.screenshot({ path: `${SHOTS}/30-trier-rappel.png` });
  await h.getByRole("button", { name: "En faire une tâche" }).click();
  await see(h, "Tâche créée, rappel programmé");
  const mine = await api(HUGO, "tasks?title=eq.Rappeler le plombier&select=remind_at,inbox,is_private");
  assert.equal(mine.length, 1);
  assert.ok(mine[0].remind_at && !mine[0].inbox && mine[0].is_private);
  assert.match(mine[0].remind_at, / 0[78]:30:00/); // 9 h 30 à Paris = 8 h 30 ou 7 h 30 UTC
  assert.equal((await api(CAM, "tasks?title=eq.Rappeler le plombier&select=id")).length, 0);
  ok("Tâche créée avec rappel, invisible pour Camille");

  // → rendez-vous
  await h.getByRole("button", { name: "Trier" }).first().click();
  await h.getByRole("radio", { name: "Un RDV" }).click();
  await h.screenshot({ path: `${SHOTS}/31-trier-rdv.png` });
  await h.getByRole("button", { name: "En faire un rendez-vous" }).click();
  await see(h, "Rendez-vous créé");
  assert.equal((await api(CAM, "appointments?title=eq.Carte grise&select=id")).length, 1);
  assert.equal((await api(HUGO, "tasks?title=eq.Carte grise&select=id")).length, 0);
  ok("Un élément devient un rendez-vous (et quitte « à trier »)");

  // → sujet privé
  await h.getByRole("button", { name: "Trier" }).first().click();
  await h.getByRole("radio", { name: "Un sujet" }).click();
  await h.getByRole("button", { name: "En faire un sujet" }).click();
  await see(h, "Sujet créé");
  assert.equal((await api(HUGO, "topics?title=eq.Banque&select=is_private"))[0]?.is_private, true);
  assert.equal((await api(CAM, "topics?title=eq.Banque&select=id")).length, 0);
  ok("Un élément devient un sujet privé, invisible pour Camille");
  await browser.close();
})().catch((e) => { console.error("ÉCHEC :", e); process.exit(1); });
