// Dates manipulées comme chaînes « YYYY-MM-DD » dans le fuseau du couple
// (Europe/Paris par défaut). L'arithmétique se fait en UTC pour éviter les
// décalages d'heure d'été.

export const DEFAULT_TZ = "Europe/Paris";

export function todayIn(tz: string = DEFAULT_TZ, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Heure locale « HH:MM » dans le fuseau du couple. */
export function nowTimeIn(tz: string = DEFAULT_TZ, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

function toUTC(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function addDays(iso: string, n: number): string {
  const d = toUTC(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 1 = lundi … 7 = dimanche */
export function isoWeekday(iso: string): number {
  const w = toUTC(iso).getUTCDay();
  return w === 0 ? 7 : w;
}

export function weekStart(iso: string): string {
  return addDays(iso, 1 - isoWeekday(iso));
}

export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

const DAY_NAMES = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const DAY_SHORT = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
const MONTHS = [
  "janv.", "févr.", "mars", "avr.", "mai", "juin",
  "juil.", "août", "sept.", "oct.", "nov.", "déc.",
];

export function dayName(iso: string): string {
  return DAY_NAMES[isoWeekday(iso) - 1];
}

export function dayShort(iso: string): string {
  return DAY_SHORT[isoWeekday(iso) - 1];
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** « mardi 17 nov. » */
export function formatDay(iso: string): string {
  const d = toUTC(iso);
  return `${dayName(iso)} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** « Aujourd'hui », « Demain », « Hier » ou « jeudi 19 nov. » */
export function relativeDay(iso: string, today: string): string {
  if (iso === today) return "Aujourd’hui";
  if (iso === addDays(today, 1)) return "Demain";
  if (iso === addDays(today, -1)) return "Hier";
  const diff = (toUTC(iso).getTime() - toUTC(today).getTime()) / 86400000;
  if (diff > 1 && diff < 7) return capitalize(dayName(iso));
  return capitalize(formatDay(iso));
}

/** « 17:30:00 » → « 17 h 30 », « 18:00 » → « 18 h » */
export function formatTime(t: string): string {
  const [h, m] = t.split(":");
  const hh = String(Number(h));
  return m === "00" ? `${hh} h` : `${hh} h ${m}`;
}

export function shortTime(t: string): string {
  return t.slice(0, 5);
}

export function weekLabel(start: string): string {
  const end = addDays(start, 6);
  const s = toUTC(start);
  const e = toUTC(end);
  if (s.getUTCMonth() === e.getUTCMonth()) {
    return `${s.getUTCDate()} – ${e.getUTCDate()} ${MONTHS[e.getUTCMonth()]}`;
  }
  return `${s.getUTCDate()} ${MONTHS[s.getUTCMonth()]} – ${e.getUTCDate()} ${MONTHS[e.getUTCMonth()]}`;
}

/** Prochaine occurrence d'un jour ISO (1–7) strictement après aujourd'hui. */
export function nextWeekday(today: string, weekday: number): string {
  const delta = ((weekday - isoWeekday(today) + 7) % 7) || 7;
  return addDays(today, delta);
}
