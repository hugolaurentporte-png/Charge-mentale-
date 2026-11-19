"use client";
// Envois en attente : une saisie faite sans réseau est gardée sur le téléphone
// puis envoyée au retour de la connexion. Chaque ligne a son identifiant fixé
// à l'avance, donc un renvoi ne crée jamais de doublon.
import { supabase } from "./supabase";

type Table = "tasks" | "list_items";
interface Op {
  table: Table;
  row: Record<string, unknown> & { id: string };
  at: number;
}

const KEY = "a-deux-outbox";
const EVENT = "a-deux-outbox";

function read(): Op[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]") as Op[];
  } catch {
    return [];
  }
}
function write(ops: Op[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ops));
  } catch {
    /* stockage indisponible : on garde ce qui peut l'être */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16),
  );
}

export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const m = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e ?? "");
  return /failed to fetch|load failed|network|fetch failed|timed? ?out/i.test(m);
}

function isDuplicate(e: unknown): boolean {
  return Boolean(e && typeof e === "object" && "code" in e && (e as { code: unknown }).code === "23505");
}

async function send(op: Op): Promise<"ok" | "network" | { error: unknown }> {
  try {
    const { error } = await supabase().from(op.table).insert(op.row);
    if (!error || isDuplicate(error)) return "ok";
    return isNetworkError(error) ? "network" : { error };
  } catch (e) {
    return isNetworkError(e) ? "network" : { error: e };
  }
}

/** Envoie tout de suite, ou garde pour plus tard sans réseau. */
export async function submit(table: Table, row: Op["row"]): Promise<"sent" | "queued" | { error: unknown }> {
  const op: Op = { table, row, at: Date.now() };
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    write([...read(), op]);
    return "queued";
  }
  const r = await send(op);
  if (r === "ok") return "sent";
  if (r === "network") {
    write([...read(), op]);
    return "queued";
  }
  return r;
}

let flushing = false;
/** Renvoie les saisies en attente. Retourne le nombre envoyé. */
export async function flush(): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const op of read()) {
      const r = await send(op);
      if (r === "network") break;
      // Envoyé, ou refusé définitivement : on le retire de la file.
      write(read().filter((o) => o.row.id !== op.row.id));
      if (r === "ok") sent += 1;
    }
  } finally {
    flushing = false;
  }
  return sent;
}

export function pending(): Op[] {
  return typeof window === "undefined" ? [] : read();
}

export function onOutboxChange(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
