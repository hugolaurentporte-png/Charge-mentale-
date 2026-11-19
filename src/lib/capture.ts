// « Vider ma tête » : analyse d'une saisie rapide, entièrement sur le téléphone.
// Propose une catégorie, une date (sûre ou à confirmer) et repère les doublons.
import { addDays, isoWeekday } from "./dates.ts";
import { parseSpoken, type Parsed } from "./speech.ts";

export type Category = "courses" | "famille" | "maison" | "administratif" | "personnel" | "idees";

export const CATEGORIES: { value: Category; label: string; emoji: string }[] = [
  { value: "courses", label: "Courses", emoji: "🛒" },
  { value: "famille", label: "Famille", emoji: "👨‍👩‍👧" },
  { value: "maison", label: "Maison", emoji: "🏠" },
  { value: "administratif", label: "Administratif", emoji: "📄" },
  { value: "personnel", label: "Personnel", emoji: "🙂" },
  { value: "idees", label: "Idées", emoji: "💡" },
];

export function categoryLabel(c: string | null | undefined): string {
  const x = CATEGORIES.find((k) => k.value === c);
  return x ? `${x.emoji} ${x.label}` : "";
}

/** Minuscules, sans accents ni ponctuation. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Mots-clés par catégorie (comparés sans accents, mot entier ou début de mot).
const KEYWORDS: Record<Category, string[]> = {
  courses: [
    "acheter", "racheter", "courses", "supermarche", "lait", "pain", "baguette", "oeufs", "oeuf", "beurre", "fromage",
    "yaourt", "yaourts", "couches", "lingettes", "pq", "papier toilette", "sopalin", "essuie tout", "fruits", "legumes",
    "pates", "riz", "cafe", "the", "sucre", "farine", "huile", "jambon", "poulet", "viande", "poisson", "pommes",
    "bananes", "tomates", "salade", "eau", "jus", "biscuits", "compotes", "liquide vaisselle", "dentifrice", "shampoing",
    "gel douche", "sacs poubelle", "croquettes", "lessive",
  ],
  famille: [
    "juliette", "creche", "nounou", "pediatre", "vaccin", "bebe", "enfant", "enfants", "mamie", "papi", "papy", "maman",
    "papa", "parents", "beaux parents", "belle mere", "beau pere", "soeur", "frere", "cousin", "cousine", "tata", "tonton",
    "anniversaire", "famille", "ecole", "gouter", "bain", "doudou",
  ],
  maison: [
    "menage", "aspirateur", "laver", "nettoyer", "ranger", "vaisselle", "linge", "machine", "faire une lessive",
    "repasser", "poubelle", "poubelles", "plombier", "electricien", "chaudiere", "reparer", "fuite", "ampoule", "jardin",
    "tondre", "travaux", "peinture", "bricolage", "meuble", "frigo", "four", "volet", "serrure", "cles", "chauffage",
  ],
  administratif: [
    "impots", "impot", "banque", "assurance", "mutuelle", "caf", "secu", "ameli", "urssaf", "papiers", "facture",
    "factures", "payer", "paiement", "virement", "declarer", "declaration", "passeport", "carte d identite", "rib",
    "contrat", "notaire", "formulaire", "dossier", "resilier", "abonnement", "credit", "pret", "taxe", "attestation",
    "certificat", "carte grise", "permis", "pole emploi", "retraite", "fiche de paie",
  ],
  personnel: [
    "sport", "courir", "running", "piscine", "yoga", "salle", "kine", "medecin", "dentiste", "ophtalmo", "osteo",
    "coiffeur", "lire", "livre", "mediter", "dormir", "moi", "perso", "acupuncture", "massage", "velo", "ami", "amis",
    "copains", "copines",
  ],
  idees: [
    "idee", "idees", "et si", "pourquoi pas", "peut etre", "un jour", "ce serait bien", "envie de", "projet", "voyage",
    "vacances", "week end a", "cadeau",
  ],
};

/** Catégorie la plus probable, ou null si rien ne ressort clairement. */
export function classify(text: string): Category | null {
  const n = ` ${normalize(text)} `;
  let best: Category | null = null;
  let bestScore = 0;
  let tie = false;
  for (const [cat, words] of Object.entries(KEYWORDS) as [Category, string[]][]) {
    let score = 0;
    for (const w of words) if (n.includes(` ${w} `) || n.includes(` ${w}s `)) score += w.includes(" ") ? 2 : 1;
    if (score > bestScore) {
      best = cat;
      bestScore = score;
      tie = false;
    } else if (score > 0 && score === bestScore) tie = true;
  }
  // « faire une lessive » est une tâche de maison, pas un achat.
  if (best === "courses" && / (faire|lancer|etendre) (une |la )?lessive /.test(n)) return "maison";
  return bestScore > 0 && !tie ? best : null;
}

/** Échéance vague : une date proposée, à confirmer. */
export interface Fuzzy {
  phrase: string;
  date: string | null;
}

const FUZZY: { re: RegExp; date: (today: string) => string | null }[] = [
  { re: /\b(la )?semaine prochaine\b/i, date: (t) => addDays(t, 8 - isoWeekday(t)) },
  { re: /\bce week-?end\b/i, date: (t) => (isoWeekday(t) >= 6 ? t : addDays(t, 6 - isoWeekday(t))) },
  { re: /\b(le )?week-?end prochain\b/i, date: (t) => addDays(t, 13 - isoWeekday(t)) },
  { re: /\b(à la |a la )?fin (du|de ce) mois\b/i, date: endOfMonth },
  { re: /\b(le )?mois prochain\b/i, date: (t) => addDays(endOfMonth(t), 1) },
  { re: /\bdans (quelques|qq) jours\b/i, date: (t) => addDays(t, 3) },
  { re: /\bcette semaine\b/i, date: (t) => (isoWeekday(t) >= 5 ? t : addDays(t, 5 - isoWeekday(t))) },
  { re: /\b(bientôt|bientot|un de ces jours|rapidement|vite|asap|dès que possible|des que possible)\b/i, date: () => null },
];

function endOfMonth(t: string): string {
  const [y, m] = t.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${t.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

export interface Capture extends Parsed {
  category: Category | null;
  fuzzy: Fuzzy | null;
}

/** Analyse complète : titre nettoyé, date sûre, date floue à confirmer, catégorie. */
export function analyze(text: string, today: string): Capture {
  let rest = text;
  let fuzzy: Fuzzy | null = null;
  for (const f of FUZZY) {
    const m = rest.match(f.re);
    if (m) {
      fuzzy = { phrase: m[0].trim(), date: f.date(today) };
      rest = rest.replace(f.re, " ");
      break;
    }
  }
  const p = parseSpoken(rest, today);
  if (p.date) fuzzy = null; // une date précise l'emporte
  let title = p.title.replace(/\s+/g, " ").trim();
  if (!title) title = text.trim();
  return { ...p, title, category: classify(text), fuzzy };
}

/** Libellé d'article de courses : « Acheter du lait » → « Lait ». */
export function shoppingLabel(title: string): string {
  const t = title
    .replace(/^(acheter|racheter|prendre|il faut|faut|penser à acheter)\s+/i, "")
    .replace(/^(du|de la|de l'|de l’|des|un|une|le|la|les)\s+/i, "")
    .trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : title;
}

/** Doublon probable : même texte normalisé, ou l'un contient l'autre (4 lettres au moins). */
export function findDuplicate<T>(title: string, items: T[], label: (x: T) => string): T | undefined {
  const n = normalize(title);
  if (n.length < 3) return undefined;
  return items.find((x) => {
    const o = normalize(label(x));
    if (!o) return false;
    if (o === n) return true;
    const [short, long] = o.length < n.length ? [o, n] : [n, o];
    return short.length >= 4 && ` ${long} `.includes(` ${short} `);
  });
}
