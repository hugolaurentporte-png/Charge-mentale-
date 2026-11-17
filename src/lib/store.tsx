"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { errorMessage, supabase } from "./supabase";
import { todayIn } from "./dates";
import type { Profile, Snapshot, UUID } from "./types";

type Status = "loading" | "signedOut" | "noCouple" | "ready" | "error";

interface Ctx {
  status: Status;
  error: string | null;
  s: Snapshot | null;
  today: string;
  reload: () => Promise<void>;
  /** Exécute une écriture, affiche l'erreur éventuelle, puis resynchronise. */
  run: <T>(fn: () => PromiseLike<{ data: T; error: unknown }>, ok?: string) => Promise<T | null>;
  toast: (msg: string) => void;
  toastMsg: string | null;
  partner: Profile | null;
  profile: (id: UUID | null | undefined) => Profile | undefined;
  /** « Toi » pour le compte connecté, sinon le prénom. */
  who: (id: UUID | null | undefined) => string;
}

const AppCtx = createContext<Ctx | null>(null);

const TABLES = [
  "couples", "profiles", "couple_members", "topics", "pickups", "relay_requests",
  "tasks", "appointments", "lists", "list_items",
] as const;

async function fetchSnapshot(me: UUID, coupleId: UUID): Promise<Snapshot> {
  const db = supabase();
  const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const [couple, members, pickups, relays, topics, tasks, appts, lists, items, favs, goals] =
    await Promise.all([
      db.from("couples").select("*").eq("id", coupleId).single(),
      db.from("couple_members").select("user_id").eq("couple_id", coupleId),
      db.from("pickups").select("*").gte("day", since).order("day"),
      db.from("relay_requests").select("*").eq("status", "pending"),
      db.from("topics").select("*").order("created_at", { ascending: false }),
      db.from("tasks").select("*").order("created_at"),
      db.from("appointments").select("*").gte("day", since).order("day"),
      db.from("lists").select("*").order("created_at"),
      db.from("list_items").select("*").order("created_at"),
      db.from("list_favorites").select("list_id"),
      db.from("goals").select("*").order("created_at"),
    ]);
  const firstError = [couple, members, pickups, relays, topics, tasks, appts, lists, items, favs, goals]
    .find((r) => r.error)?.error;
  if (firstError) throw firstError;
  const ids = (members.data ?? []).map((m: { user_id: UUID }) => m.user_id);
  const profiles = await db.from("profiles").select("*").in("id", ids);
  if (profiles.error) throw profiles.error;
  // Récupérations crèche désactivées : rien n'en apparaît dans l'app.
  const creche = couple.data?.pickups_enabled !== false;
  return {
    me,
    couple: couple.data,
    profiles: profiles.data ?? [],
    pickups: creche ? (pickups.data ?? []) : [],
    relays: creche ? (relays.data ?? []) : [],
    topics: (topics.data ?? []).filter((t: { kind: string }) => creche || t.kind !== "pickup_week"),
    tasks: tasks.data ?? [],
    appointments: appts.data ?? [],
    lists: lists.data ?? [],
    items: items.data ?? [],
    favorites: (favs.data ?? []).map((f: { list_id: UUID }) => f.list_id),
    goals: goals.data ?? [],
  };
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [s, setS] = useState<Snapshot | null>(null);
  const [toastMsg, setToast] = useState<string | null>(null);
  const [today, setToday] = useState(() => todayIn());
  const coupleRef = useRef<UUID | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((m) => (m === msg ? null : m)), 3500);
  }, []);

  const reload = useCallback(async () => {
    try {
      const db = supabase();
      const { data: auth } = await db.auth.getUser();
      if (!auth.user) {
        setStatus("signedOut");
        setS(null);
        return;
      }
      const { data: m, error: mErr } = await db
        .from("couple_members").select("couple_id").eq("user_id", auth.user.id).maybeSingle();
      if (mErr) throw mErr;
      if (!m) {
        coupleRef.current = null;
        setStatus("noCouple");
        setS(null);
        return;
      }
      coupleRef.current = m.couple_id;
      const snap = await fetchSnapshot(auth.user.id, m.couple_id);
      setS(snap);
      setToday(todayIn(snap.couple.timezone));
      setStatus("ready");
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
      setStatus((st) => (st === "ready" ? st : "error"));
    }
  }, []);

  const scheduleReload = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void reload(), 120);
  }, [reload]);

  // Chargement initial, changements de session, retour au premier plan.
  useEffect(() => {
    void reload();
    const { data: sub } = supabase().auth.onAuthStateChange((evt) => {
      if (evt === "SIGNED_IN" || evt === "SIGNED_OUT" || evt === "USER_UPDATED") scheduleReload();
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") scheduleReload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      sub.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload, scheduleReload]);

  // Synchronisation temps réel entre les deux comptes (RLS appliquée par Supabase).
  const coupleId = s?.couple.id;
  useEffect(() => {
    if (!coupleId) return;
    const db = supabase();
    let ch = db.channel(`couple-${coupleId}`);
    for (const table of TABLES) {
      ch = ch.on("postgres_changes", { event: "*", schema: "public", table }, scheduleReload);
    }
    ch.subscribe();
    channelRef.current = ch;
    return () => {
      void db.removeChannel(ch);
      channelRef.current = null;
    };
  }, [coupleId, scheduleReload]);

  const run = useCallback(
    async <T,>(fn: () => PromiseLike<{ data: T; error: unknown }>, ok?: string) => {
      const { data, error: err } = await fn();
      if (err) {
        toast(errorMessage(err));
        await reload();
        return null;
      }
      if (ok) toast(ok);
      await reload();
      // Une écriture réussie sans contenu renvoyé (RPC « void », insert sans
      // select) ne doit pas être confondue avec un échec (null).
      return data === null ? (true as unknown as T) : data;
    },
    [reload, toast],
  );

  const value = useMemo<Ctx>(() => {
    const profile = (id: UUID | null | undefined) => s?.profiles.find((p) => p.id === id);
    return {
      status, error, s, today, reload, run, toast, toastMsg,
      partner: s?.profiles.find((p) => p.id !== s.me) ?? null,
      profile,
      who: (id) => (id && id === s?.me ? "Toi" : profile(id)?.display_name ?? "?"),
    };
  }, [status, error, s, today, reload, run, toast, toastMsg]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp hors AppProvider");
  return c;
}

/** Pour les écrans qui ne s'affichent qu'une fois l'espace chargé. */
export function useReady() {
  const c = useApp();
  if (!c.s) throw new Error("Snapshot indisponible");
  return { ...c, s: c.s };
}
