"use client";
import { supabase } from "@/lib/supabase";
import { useReady } from "@/lib/store";
import { relativeDay } from "@/lib/dates";
import { Header, useFab } from "@/components/shell";
import { Badge, Empty, Section } from "@/components/ui";
import { TaskRow } from "@/components/tasks";
import { ListLink, NewListForm } from "@/components/lists";
import { InboxSection } from "@/components/capture";

export default function MoiPage() {
  const { s, run, today } = useReady();
  useFab({ mode: "moi" });
  const tasks = s.tasks
    .filter((t) => t.is_private && t.owner_id === s.me)
    .sort((a, b) => Number(a.done) - Number(b.done) || `${a.due_date ?? "9"}${a.due_time ?? "99"}`.localeCompare(`${b.due_date ?? "9"}${b.due_time ?? "99"}`));
  const goals = s.goals.slice().sort((a, b) => Number(a.achieved) - Number(b.achieved));
  const lists = s.lists.filter((l) => l.is_private && l.owner_id === s.me);
  return (
    <>
      <Header title="Pour moi" />
      <p className="px-1 text-sm text-slate-500">Tout ce qui est ici n’est visible que par toi.</p>
      <InboxSection />
      <Section title="Mes tâches">
        {tasks.length ? tasks.map((t) => <TaskRow key={t.id} task={t} showDate />) : <Empty>Aucune tâche perso.</Empty>}
      </Section>
      <Section title="Objectifs">
        {goals.length ? (
          goals.map((g) => (
            <div key={g.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
              <input
                type="checkbox"
                aria-label={`Objectif atteint : ${g.title}`}
                checked={g.achieved}
                onChange={(e) => void run(() => supabase().from("goals").update({ achieved: e.target.checked }).eq("id", g.id))}
                className="h-6 w-6 accent-emerald-600"
              />
              <div className="flex-1">
                <div className={`font-semibold ${g.achieved ? "text-slate-400 line-through" : ""}`}>{g.title}</div>
                {g.due_date && <div className="text-sm text-slate-500">Échéance : {relativeDay(g.due_date, today)}</div>}
              </div>
              <Badge tone={g.achieved ? "green" : "slate"}>{g.achieved ? "Atteint" : "En cours"}</Badge>
              <button
                aria-label={`Supprimer ${g.title}`}
                onClick={() => void run(() => supabase().from("goals").delete().eq("id", g.id))}
                className="h-9 w-9 text-xl text-slate-400"
              >
                ×
              </button>
            </div>
          ))
        ) : (
          <Empty>Aucun objectif.</Empty>
        )}
      </Section>
      <Section title="Mes listes privées">
        {lists.map((l) => (
          <ListLink key={l.id} list={l} />
        ))}
        <NewListForm isPrivate />
      </Section>
    </>
  );
}
