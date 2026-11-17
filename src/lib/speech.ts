// Comprend une phrase dictée : « Sortir les poubelles tous les mardis à 20 h »
// → titre « Sortir les poubelles », jour, heure, récurrence.
import { addDays, isoWeekday, nextWeekday } from "./dates.ts";

export type Recurrence = "daily" | "weekly" | "biweekly" | "monthly";
export interface Parsed {
  title: string;
  date: string | null;
  time: string | null;
  recurrence: Recurrence | null;
}

const DAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const NUM: Record<string, number> = {
  une: 1, un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
  onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16, "dix-sept": 17, "dix-huit": 18,
  "dix-neuf": 19, vingt: 20, "vingt-et-une": 21, "vingt-et-un": 21, "vingt-deux": 22, "vingt-trois": 23, midi: 12, minuit: 0,
};

export function parseSpoken(input: string, today: string): Parsed {
  let s = ` ${input.trim().replace(/\s+/g, " ")} `;
  let date: string | null = null;
  let time: string | null = null;
  let recurrence: Recurrence | null = null;
  const cut = (re: RegExp) => {
    s = s.replace(re, " ");
  };
  const d = "(" + DAYS.join("|") + ")";

  // Récurrence
  let m = s.match(new RegExp(`\\s(?:tous les|chaque)\\s${d}s?\\b`, "i"));
  if (m) {
    const wd = DAYS.indexOf(m[1].toLowerCase()) + 1;
    recurrence = "weekly";
    date = isoWeekday(today) === wd ? today : nextWeekday(today, wd);
    cut(new RegExp(`\\s(?:tous les|chaque)\\s${d}s?\\b`, "i"));
  } else if ((m = s.match(/\s(?:tous les jours|chaque jour)\b/i))) {
    recurrence = "daily";
    cut(/\s(?:tous les jours|chaque jour)\b/i);
  } else if ((m = s.match(/\s(?:toutes les deux semaines|toutes les 2 semaines)\b/i))) {
    recurrence = "biweekly";
    cut(/\s(?:toutes les deux semaines|toutes les 2 semaines)\b/i);
  } else if ((m = s.match(/\s(?:chaque semaine|toutes les semaines)\b/i))) {
    recurrence = "weekly";
    cut(/\s(?:chaque semaine|toutes les semaines)\b/i);
  } else if ((m = s.match(/\s(?:chaque mois|tous les mois)\b/i))) {
    recurrence = "monthly";
    cut(/\s(?:chaque mois|tous les mois)\b/i);
  }

  // Jour
  if (!date) {
    if (/\saprès-demain\b/i.test(s)) {
      date = addDays(today, 2);
      cut(/\saprès-demain\b/i);
    } else if (/\sdemain\b/i.test(s)) {
      date = addDays(today, 1);
      cut(/\sdemain\b/i);
    } else if (/\s(?:aujourd['’]hui|ce soir|ce matin|cet après-midi)\b/i.test(s)) {
      date = today;
      cut(/\saujourd['’]hui\b/i);
    } else if ((m = s.match(new RegExp(`\\s(?:ce |le |)${d}( prochain)?\\b`, "i")))) {
      date = nextWeekday(today, DAYS.indexOf(m[1].toLowerCase()) + 1);
      cut(new RegExp(`\\s(?:ce |le |)${d}( prochain)?\\b`, "i"));
    }
  }
  if (recurrence && !date) date = today;

  // Heure : « à 18 h 30 », « 18h », « 18:30 », « à neuf heures », « à midi »
  m = s.match(/\s(?:à |vers )?(\d{1,2})\s?(?:h|heures?|:)\s?(\d{2})?\b/i);
  if (m && Number(m[1]) < 24) {
    time = `${m[1].padStart(2, "0")}:${m[2] ?? "00"}`;
    cut(/\s(?:à |vers )?(\d{1,2})\s?(?:h|heures?|:)\s?(\d{2})?\b/i);
  } else {
    m = s.match(/\s(?:à |vers )([a-z-]+)(?: heures?)?(?: et demie)?\b/i);
    if (m && NUM[m[1].toLowerCase()] !== undefined && (/heure|midi|minuit/i.test(m[0]))) {
      const h = NUM[m[1].toLowerCase()];
      time = `${String(h).padStart(2, "0")}:${/et demie/i.test(m[0]) ? "30" : "00"}`;
      cut(/\s(?:à |vers )([a-z-]+)(?: heures?)?(?: et demie)?\b/i);
    }
  }
  if (/\sce soir\b/i.test(s)) {
    if (!time) time = "19:00";
    cut(/\sce soir\b/i);
  }
  cut(/\s(?:ce matin|cet après-midi)\b/i);
  if (time && !date) date = today;

  let title = s.replace(/\s+/g, " ").replace(/\s([,.])/g, "$1").trim().replace(/[,.]$/, "").trim();
  title = title.replace(/^(il faut|faut|penser à|rappelle-moi de|rappel)\s+/i, "");
  title = title.charAt(0).toUpperCase() + title.slice(1);
  return { title, date, time, recurrence };
}
