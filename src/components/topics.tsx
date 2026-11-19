"use client";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useReady } from "@/lib/store";
import { capitalize, formatDay, formatTime, relativeDay, weekLabel } from "@/lib/dates";
import { type Decision, type FollowUp, topicState, uncoveredDays } from "@/lib/selectors";
import type { Topic } from "@/lib/types";
import { Avatar, Badge, Button, ORANGE } from "./ui";
import { PickupCard, usePickupActions } from "./pickup";

/** Couleur des sujets « juste moi ». */
export const PRIVATE_COLOR = "#7c3aed";

export function topicTitle(t: Topic) {
  return t.kind === "pickup_week" && t.week_start ? `Crèche · ${weekLabel(t.week_start)}` : t.title;
}

export function useTopicActions() {
  const { run, toast, who } = useReady();
  return {
    claim: async (t: Topic) => {
      const r = (await run(() => supabase().rpc("claim_topic", { p_topic: t.id }))) as { ok: boolean; owner_id: string } | null;
      if (r && !r.ok) toast(`${who(r.owner_id)} s’en occupe déjà.`);
    },
    propose: (t: Topic) => run(() => supabase().rpc("propose_topic", { p_topic: t.id }), "Proposition envoyée"),
    respond: (t: Topic, accept: boolean) =>
      run(() => supabase().rpc("respond_topic", { p_topic: t.id, p_accept: accept }), accept ? "Tu t’en occupes" : "Proposition refusée"),
    release: (t: Topic) => run(() => supabase().rpc("release_topic", { p_topic: t.id }), "Tu ne suis plus ce sujet"),
    cancel: (t: Topic) => run(() => supabase().rpc("cancel_topic_proposal", { p_topic: t.id }), "Proposition annulée"),
    close: (t: Topic, closed: boolean) =>
      run(() => supabase().from("topics").update({ status: closed ? "closed" : "open" }).eq("id", t.id), closed ? "Sujet clôturé" : "Sujet rouvert"),
  };
}

export function TopicStateBadge({ t }: { t: Topic }) {
  const { who } = useReady();
  const st = topicState(t);
  if (st === "closed") return <Badge tone="green">Réglé</Badge>;
  if (t.is_private) return <Badge tone="violet">Privé 🔒</Badge>;
  if (st === "open_unowned") return <Badge tone="orange">À prendre en charge</Badge>;
  return <Badge>Suivi par {who(t.owner_id)}</Badge>;
}

/** Carte de la vue partagée : qui s'occupe, état, prochaine étape. */
export function TopicCard({ t }: { t: Topic }) {
  const { s, today, who, deferDelete } = useReady();
  const remove = () =>
    deferDelete(t.id, `« ${topicTitle(t)} » supprimé`, () => supabase().from("topics").delete().eq("id", t.id));
  const a = useTopicActions();
  const cover = uncoveredDays(s, t, today);
  const unowned = !t.owner_id && t.status === "open";
  return (
    <div
      className={`relative rounded-2xl p-4 pr-11 shadow-sm ring-1 ${t.is_private ? "bg-violet-50 ring-violet-200" : "bg-white ring-slate-200"}`}
      style={{ borderLeft: `6px solid ${t.is_private ? PRIVATE_COLOR : (s.profiles.find((p) => p.id === t.owner_id)?.color ?? ORANGE)}` }}
    >
      <button
        aria-label={`Supprimer ${topicTitle(t)}`}
        onClick={remove}
        className="absolute right-1 top-1 flex h-10 w-10 items-center justify-center text-xl text-slate-400"
      >
        ×
      </button>
      <Link href={`/sujets/voir?id=${t.id}`} className="block">
        <div className="flex items-center gap-3">
          <Avatar id={t.owner_id} size={32} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[16px] font-bold">{topicTitle(t)}</div>
            <div className="mt-1 flex flex-wrap gap-2">
              <TopicStateBadge t={t} />
              {t.proposed_to && <Badge tone="violet">Proposé à {who(t.proposed_to)}</Badge>}
            </div>
          </div>
        </div>
        {t.next_action && t.status === "open" && (
          <div className={`mt-2 text-sm ${t.next_action_date && t.next_action_date < today ? "font-semibold text-red-700" : "text-slate-600"}`}>
            {t.next_action}
            {t.next_action_date ? ` · ${relativeDay(t.next_action_date, today).toLowerCase()}` : ""}
          </div>
        )}
        {cover.length > 0 && t.status === "open" && (
          <div className="mt-2 text-sm font-semibold text-orange-700">
            À couvrir : {cover.map((p) => formatDay(p.day)).join(", ")}
          </div>
        )}
      </Link>
      {unowned && (
        <Button kind="orange" className="mt-3 w-full" onClick={() => void a.claim(t)}>
          Je m’en occupe
        </Button>
      )}
    </div>
  );
}

export function FollowUpRow({ f }: { f: FollowUp }) {
  const { s, today } = useReady();
  const pa = usePickupActions();
  if (f.kind === "cover" && f.pickup) {
    return (
      <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-orange-200">
        <div className="text-[15px] font-semibold">
          {capitalize(formatDay(f.pickup.day))} · {formatTime(f.pickup.time)} : personne pour {s.couple.child_name}
        </div>
        <div className="text-sm text-slate-500">Tu organises la crèche cette semaine</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button kind="orange" onClick={() => void pa.claim(f.pickup!)}>
            Je {s.couple.child_pronoun} récupère
          </Button>
          <Button kind="secondary" onClick={() => void pa.noCreche(f.pickup!)}>
            Pas de crèche
          </Button>
          <Link href={`/planning/organiser?semaine=${f.topic.week_start}`} className="px-1 text-sm font-semibold underline">
            Organiser
          </Link>
        </div>
      </div>
    );
  }
  return (
    <Link
      href={`/sujets/voir?id=${f.topic.id}`}
      className={`block rounded-2xl bg-white p-4 shadow-sm ring-1 ${f.overdue ? "ring-red-300" : "ring-slate-200"}`}
    >
      <div className="text-sm font-semibold text-slate-500">{topicTitle(f.topic)}</div>
      <div className="mt-1 text-[16px] font-bold">{f.topic.next_action || "Faire le point"}</div>
      <div className={`mt-1 text-sm ${f.overdue ? "font-semibold text-red-700" : "text-slate-600"}`}>
        {f.overdue ? `En retard · prévu ${relativeDay(f.date, today).toLowerCase()}` : "À relancer aujourd’hui"}
      </div>
    </Link>
  );
}

export function DecisionRow({ d }: { d: Decision }) {
  const { who } = useReady();
  const a = useTopicActions();
  if (d.kind === "relay" && d.pickup) return <PickupCard pickup={d.pickup} compact />;
  if (d.kind === "handover" && d.topic) {
    const t = d.topic;
    return (
      <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
        <div className="text-[15px]">
          <b>{who(t.proposed_by)}</b> te propose de suivre <b>{topicTitle(t)}</b>
        </div>
        {t.owner_id && t.owner_id !== t.proposed_by && (
          <div className="mt-1 text-sm text-slate-600">Actuellement suivi par {who(t.owner_id)}</div>
        )}
        <div className="mt-3 flex gap-2">
          <Button className="flex-1" onClick={() => void a.respond(t, true)}>
            J’accepte
          </Button>
          <Button kind="secondary" className="flex-1" onClick={() => void a.respond(t, false)}>
            Refuser
          </Button>
        </div>
      </div>
    );
  }
  return null;
}
