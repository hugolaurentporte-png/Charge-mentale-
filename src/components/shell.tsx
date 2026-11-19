"use client";
import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useApp, useReady } from "@/lib/store";
import { supabase, errorMessage } from "@/lib/supabase";
import type { UUID } from "@/lib/types";
import { BASE } from "@/lib/base";
import { AppointmentForm, GiftForm, GoalForm, ItemForm, TaskForm, TopicForm } from "./forms";
import { QuickCapture } from "./capture";
import { Avatar, Button, Input, Label, Segmented, Sheet } from "./ui";

/** Contexte du bouton + : chaque écran indique ce qu'il faut préremplir. */
export type FabContext =
  | { mode: "planning"; day: string }
  | { mode: "lists" }
  | { mode: "list"; listId: UUID }
  | { mode: "moi" }
  | { mode: "topic"; topicId: UUID };

const FabCtx = createContext<{ ctx: FabContext | null; set: (c: FabContext | null) => void } | null>(null);

export function useFab(c: FabContext) {
  const f = useContext(FabCtx);
  const key = JSON.stringify(c);
  useEffect(() => {
    f?.set(JSON.parse(key));
    return () => f?.set(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

function QuickAdd({ ctx, onClose }: { ctx: FabContext; onClose: () => void }) {
  const { s } = useReady();
  const router = useRouter();
  const [kind, setKind] = useState<string>(
    ctx.mode === "lists" ? "topic" : ctx.mode === "planning" || ctx.mode === "moi" ? "quick" : "task",
  );
  let title = "Ajouter";
  let body: React.ReactNode = null;
  if (ctx.mode === "planning") {
    body = (
      <>
        <div className="mb-4">
          <Segmented
            name="Type"
            value={kind}
            onChange={setKind}
            options={[
              { value: "quick", label: "Vite" },
              { value: "task", label: "Tâche" },
              { value: "topic", label: "Sujet" },
              { value: "appt", label: "RDV" },
            ]}
          />
        </div>
        {kind === "quick" && <QuickCapture onDone={onClose} />}
        {kind === "task" && <TaskForm day={ctx.day} onDone={onClose} />}
        {kind === "topic" && <TopicForm onDone={onClose} />}
        {kind === "appt" && <AppointmentForm day={ctx.day} onDone={onClose} />}
      </>
    );
  } else if (ctx.mode === "lists") {
    body = (
      <>
        <div className="mb-4">
          <Segmented
            name="Type"
            value={kind}
            onChange={setKind}
            options={[
              { value: "topic", label: "Sujet" },
              { value: "task", label: "À faire à deux" },
            ]}
          />
        </div>
        {kind === "topic" && <TopicForm onDone={(id) => (onClose(), id && router.push(`/sujets/voir?id=${id}`))} />}
        {kind === "task" && <TaskForm onDone={onClose} />}
      </>
    );
  } else if (ctx.mode === "list") {
    const list = s.lists.find((l) => l.id === ctx.listId);
    title = list ? `Ajouter à ${list.name}` : "Ajouter";
    body = list?.kind === "gifts" ? <GiftForm listId={ctx.listId} onDone={onClose} /> : <ItemForm listId={ctx.listId} onDone={() => {}} />;
  } else if (ctx.mode === "moi") {
    title = "Pour moi";
    body = (
      <>
        <div className="mb-4">
          <Segmented
            name="Type"
            value={kind}
            onChange={setKind}
            options={[
              { value: "quick", label: "Vite" },
              { value: "task", label: "Tâche perso" },
              { value: "goal", label: "Objectif" },
            ]}
          />
        </div>
        {kind === "quick" && <QuickCapture onDone={onClose} />}
        {kind === "task" && <TaskForm isPrivate onDone={onClose} />}
        {kind === "goal" && <GoalForm onDone={onClose} />}
      </>
    );
  } else if (ctx.mode === "topic") {
    title = "Nouvelle action du sujet";
    body = <TaskForm topicId={ctx.topicId} isPrivate={Boolean(s.topics.find((t) => t.id === ctx.topicId)?.is_private)} onDone={onClose} />;
  }
  return (
    <Sheet open onClose={onClose} title={title}>
      {body}
    </Sheet>
  );
}

const TABS = [
  { href: "/planning", label: "Planning", icon: "M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" },
  { href: "/listes", label: "Listes", icon: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" },
  { href: "/echanges", label: "Échanges", icon: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12Z" },
  { href: "/moi", label: "Pour moi", icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" },
];

function TabBar() {
  const path = usePathname();
  const { s } = useApp();
  const readAt = Date.parse(s?.profiles.find((p) => p.id === s.me)?.messages_read_at ?? "") || 0;
  const unread = (s?.messages ?? []).filter((m) => m.author_id !== s?.me && Date.parse(m.created_at) > readAt).length;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto flex max-w-md">
        {TABS.map((t) => {
          const active =
            path.startsWith(t.href) ||
            (t.href === "/listes" && path.startsWith("/sujets"));
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-semibold ${active ? "text-slate-900" : "text-slate-400"}`}
            >
              <span className="relative">
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d={t.icon} />
                </svg>
                {t.href === "/echanges" && unread > 0 && !active && (
                  <span
                    aria-label={`${unread} message${unread > 1 ? "s" : ""} non lu${unread > 1 ? "s" : ""}`}
                    className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white"
                  >
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </span>
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function Onboarding() {
  const { reload } = useApp();
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const create = async () => {
    const { error } = await supabase().rpc("create_couple", { p_display_name: name.trim() });
    if (error) setErr(errorMessage(error));
    else await reload();
  };
  const join = () => {
    const raw = link.trim();
    const token = raw.match(/[?&]t=([^&#]+)/)?.[1] ?? raw.split("/").pop();
    if (token) window.location.href = `${BASE}/invitation?t=${token}`;
  };
  return (
    <main className="mx-auto max-w-md space-y-6 p-5 pt-12">
      <h1 className="text-3xl font-extrabold">Bienvenue</h1>
      <section className="space-y-3 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-lg font-bold">Créer votre espace à deux</h2>
        <label className="block">
          <Label>Ton prénom</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Hugo" />
        </label>
        <Button className="w-full" disabled={!name.trim()} onClick={() => void create()}>
          Créer l’espace
        </Button>
      </section>
      <section className="space-y-3 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-lg font-bold">J’ai reçu un lien d’invitation</h2>
        <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Colle le lien ici" />
        <Button kind="secondary" className="w-full" disabled={!link.trim()} onClick={join}>
          Rejoindre
        </Button>
      </section>
      {err && <p className="text-sm font-semibold text-red-700">{err}</p>}
      <Button kind="ghost" onClick={() => void supabase().auth.signOut()}>
        Se déconnecter
      </Button>
    </main>
  );
}

export function Header({ title, right }: { title: string; right?: React.ReactNode }) {
  const { s } = useReady();
  return (
    <header className="flex items-center justify-between pb-2 pt-4">
      <h1 className="text-[28px] font-extrabold leading-tight">{title}</h1>
      <div className="flex items-center gap-2">
        {right}
        <Link href="/reglages" aria-label="Réglages" className="rounded-full">
          <Avatar id={s.me} size={36} />
        </Link>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { status, error, toastMsg, toastUndo, s } = useApp();
  const router = useRouter();
  const path = usePathname();
  const [ctx, setCtx] = useState<FabContext | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (status === "signedOut") router.replace(`/connexion?suite=${encodeURIComponent(path)}`);
  }, [status, router, path]);

  if (status === "loading" || status === "signedOut") {
    return <div className="p-8 text-center text-slate-400">Chargement…</div>;
  }
  if (status === "error") {
    return (
      <div className="p-8 text-center">
        <p className="font-semibold text-red-700">{error}</p>
        <Button className="mt-4" onClick={() => location.reload()}>
          Réessayer
        </Button>
      </div>
    );
  }
  if (status === "noCouple" || !s) return <Onboarding />;

  return (
    <FabCtx.Provider value={{ ctx, set: setCtx }}>
      {error === "Hors connexion" && (
        <div className="sticky top-0 z-40 bg-amber-100 px-4 py-1.5 text-center text-sm font-semibold text-amber-900">
          Hors connexion : tes saisies partiront au retour du réseau
        </div>
      )}
      <main className="mx-auto min-h-dvh max-w-md overflow-x-clip px-4 pb-32">{children}</main>
      {ctx && (
        <button
          aria-label="Ajouter"
          onClick={() => setAdding(true)}
          className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-[max(1rem,calc(50%-14rem+1rem))] z-40 flex h-16 w-16 items-center justify-center rounded-full bg-slate-900 text-4xl font-light text-white shadow-lg active:scale-95"
        >
          +
        </button>
      )}
      {adding && ctx && <QuickAdd ctx={ctx} onClose={() => setAdding(false)} />}
      <TabBar />
      {toastMsg && (
        <div role="status" className="fixed inset-x-4 top-4 z-[60] mx-auto flex max-w-sm items-center justify-center gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-center text-sm font-semibold text-white shadow-lg">
          <span>{toastMsg}</span>
          {toastUndo && (
            <button onClick={toastUndo} className="rounded-lg bg-white/15 px-3 py-1 font-bold text-amber-300">
              Annuler
            </button>
          )}
        </div>
      )}
    </FabCtx.Provider>
  );
}
