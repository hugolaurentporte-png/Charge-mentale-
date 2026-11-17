"use client";
import { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useReady } from "@/lib/store";
import { addDays, nextWeekday, relativeDay, weekDays } from "@/lib/dates";
import { pickupOn } from "@/lib/selectors";
import type { Topic } from "@/lib/types";
import { useFab } from "@/components/shell";
import { Avatar, Button, Empty, Input, Label, Person, Section } from "@/components/ui";
import { TaskRow } from "@/components/tasks";
import { PickupCard } from "@/components/pickup";
import { TopicStateBadge, topicTitle, useTopicActions } from "@/components/topics";

function NextAction({ t }: { t: Topic }) {
  const { s, run, today, who } = useReady();
  const [text, setText] = useState(t.next_action ?? "");
  const [date, setDate] = useState(t.next_action_date ?? "");
  const [editing, setEditing] = useState(false);
  const mine = t.owner_id === s.me;
  const save = async () => {
    const ok = await run(
      () =>
        supabase()
          .from("topics")
          .update({ next_action: text.trim() || null, next_action_date: date || null })
          .eq("id", t.id),
      "Prochaine étape enregistrée",
    );
    if (ok !== null) setEditing(false);
  };
  if (!mine || !editing) {
    return (
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="text-sm font-semibold text-slate-500">Prochaine étape</div>
        {t.next_action || t.next_action_date ? (
          <div className="mt-1 text-[17px] font-bold">
            {t.next_action || "Faire le point"}
            {t.next_action_date && (
              <span className={t.next_action_date < today ? " text-red-700" : " text-slate-600"}>
                {" "}
                · {relativeDay(t.next_action_date, today).toLowerCase()}
              </span>
            )}
          </div>
        ) : (
          <div className="mt-1 text-slate-500">Non renseignée</div>
        )}
        {mine ? (
          <Button kind="secondary" className="mt-3 w-full" onClick={() => setEditing(true)}>
            {t.next_action ? "Modifier" : "Indiquer la prochaine étape"}
          </Button>
        ) : (
          t.owner_id && <div className="mt-2 text-sm text-slate-500">Renseignée par {who(t.owner_id)}, qui suit le sujet.</div>
        )}
      </div>
    );
  }
  const quick = [
    { l: "Demain", v: addDays(today, 1) },
    { l: "Jeudi", v: nextWeekday(today, 4) },
    { l: "Lundi", v: nextWeekday(today, 1) },
    { l: "Dans 1 sem.", v: addDays(today, 7) },
  ];
  return (
    <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <label className="block">
        <Label>Prochaine étape</Label>
        <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="En attente de la banque · relancer" />
      </label>
      <div>
        <Label>À quelle date ?</Label>
        <div className="flex flex-wrap gap-2">
          {quick.map((q) => (
            <button
              key={q.l}
              type="button"
              onClick={() => setDate(q.v)}
              className={`min-h-9 rounded-full px-3 text-sm font-semibold ${date === q.v ? "bg-slate-900 text-white" : "bg-slate-100"}`}
            >
              {q.l}
            </button>
          ))}
          <input
            type="date"
            aria-label="Date de la prochaine étape"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="min-h-9 rounded-full border border-slate-300 px-3 text-sm"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => void save()}>
          Enregistrer
        </Button>
        <Button kind="ghost" onClick={() => setEditing(false)}>
          Annuler
        </Button>
      </div>
    </div>
  );
}

function WeekPickups({ t }: { t: Topic }) {
  const { s, today } = useReady();
  if (!t.week_start) return null;
  const days = weekDays(t.week_start).filter((d) => pickupOn(s, d));
  return (
    <Section
      title="Trajets de la semaine"
      action={
        <Link href={`/planning/organiser?semaine=${t.week_start}`} className="text-sm font-semibold underline">
          Modifier
        </Link>
      }
    >
      {days.length ? (
        days.map((d) => {
          const p = pickupOn(s, d)!;
          return d >= today ? (
            <PickupCard key={d} pickup={p} compact />
          ) : (
            <div key={d} className="flex items-center gap-2 px-2 text-sm text-slate-400">
              {relativeDay(d, today)} · <Person id={p.responsible_id} />
            </div>
          );
        })
      ) : (
        <Empty>Aucun jour enregistré.</Empty>
      )}
    </Section>
  );
}

export default function TopicPage() {
  return (
    <Suspense>
      <TopicPageInner />
    </Suspense>
  );
}

function TopicPageInner() {
  const id = useSearchParams().get("id") ?? "";
  const { s, who, partner, run } = useReady();
  const router = useRouter();
  const a = useTopicActions();
  useFab({ mode: "topic", topicId: id });
  const t = s.topics.find((x) => x.id === id);
  if (!t) return <Empty>Sujet introuvable.</Empty>;
  const tasks = s.tasks.filter((x) => x.topic_id === t.id);
  const open = t.status === "open";
  const canPropose = open && partner && (t.owner_id === null || t.owner_id === s.me) && !t.proposed_to;
  return (
    <div className="pt-4">
      <button onClick={() => router.push("/listes")} className="text-sm font-semibold text-slate-500">
        ‹ Listes
      </button>
      <h1 className="mt-1 text-[26px] font-extrabold leading-tight">{topicTitle(t)}</h1>

      <div className="mt-3 flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <Avatar id={t.owner_id} size={44} />
        <div className="flex-1">
          <div className="text-sm text-slate-500">Qui s’en occupe</div>
          <div className="text-[17px] font-bold">{t.owner_id ? who(t.owner_id) : "Personne pour l’instant"}</div>
        </div>
        <TopicStateBadge t={t} />
      </div>

      {t.proposed_to && open && (
        <div className="mt-3 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
          {t.proposed_to === s.me ? (
            <>
              <div className="text-[15px]">
                <b>{who(t.proposed_by)}</b> te propose de suivre ce sujet.
              </div>
              <div className="mt-3 flex gap-2">
                <Button className="flex-1" onClick={() => void a.respond(t, true)}>
                  J’accepte
                </Button>
                <Button kind="secondary" className="flex-1" onClick={() => void a.respond(t, false)}>
                  Refuser
                </Button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[15px]">
                Proposé à <b>{who(t.proposed_to)}</b>, en attente
              </span>
              {t.proposed_by === s.me && (
                <Button kind="secondary" onClick={() => void a.cancel(t)}>
                  Annuler
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {open && (
        <div className="mt-3 flex gap-2">
          {!t.owner_id && (
            <Button kind="orange" className="flex-1" onClick={() => void a.claim(t)}>
              Je m’en occupe
            </Button>
          )}
          {canPropose && (
            <Button kind="secondary" className="flex-1" onClick={() => void a.propose(t)}>
              Proposer à {partner.display_name}
            </Button>
          )}
        </div>
      )}

      {open && (
        <div className="mt-3">
          <NextAction key={`${t.next_action}-${t.next_action_date}-${t.owner_id}`} t={t} />
        </div>
      )}

      {t.kind === "pickup_week" && <WeekPickups t={t} />}

      <Section title="Actions">
        {tasks.length ? tasks.map((x) => <TaskRow key={x.id} task={x} showDate />) : <Empty>Ajoute une action avec +.</Empty>}
      </Section>

      <div className="mt-8 space-y-2">
        <Button kind={open ? "primary" : "secondary"} className="w-full" onClick={() => void a.close(t, open)}>
          {open ? "Clôturer : c’est réglé" : "Rouvrir le sujet"}
        </Button>
        {t.kind === "general" && (
          <Button
            kind="ghost"
            className="w-full text-red-700"
            onClick={() => void run(() => supabase().from("topics").delete().eq("id", t.id)).then((ok) => ok !== null && router.push("/listes"))}
          >
            Supprimer
          </Button>
        )}
      </div>
    </div>
  );
}
