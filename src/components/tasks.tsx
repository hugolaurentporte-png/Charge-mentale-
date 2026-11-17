"use client";
import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useReady } from "@/lib/store";
import { addDays, relativeDay } from "@/lib/dates";
import type { Task } from "@/lib/types";
import { AppointmentForm, idToWho, useWhoOptions, whoToId, type WhoChoice } from "./forms";
import { Badge, Button, Input, Label, Person, Segmented, Sheet } from "./ui";

function origin(t: Task, topicTitle?: string) {
  if (t.is_private) return <Badge tone="violet">Pour moi</Badge>;
  if (topicTitle) return <Badge>{topicTitle}</Badge>;
  return <Badge>À deux</Badge>;
}

/** Ligne de tâche : case à cocher, titre, provenance, responsable. */
export function TaskRow({ task, overdue = false, showDate = false }: { task: Task; overdue?: boolean; showDate?: boolean }) {
  const { s, run, today } = useReady();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(false);
  const topic = s.topics.find((t) => t.id === task.topic_id);
  const setDone = (done: boolean) => run(() => supabase().from("tasks").update({ done }).eq("id", task.id));
  const move = (d: string) => run(() => supabase().from("tasks").update({ due_date: d }).eq("id", task.id));
  return (
    <div className={`rounded-2xl bg-white p-3 shadow-sm ring-1 ${overdue ? "ring-red-200" : "ring-slate-200"}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          aria-label={`Terminer ${task.title}`}
          checked={task.done}
          onChange={(e) => void setDone(e.target.checked)}
          className="mt-1 h-6 w-6 shrink-0 accent-slate-900"
        />
        <button onClick={() => setOpen(true)} className="min-w-0 flex-1 text-left">
          <div className={`text-[16px] font-semibold ${task.done ? "text-slate-400 line-through" : ""}`}>{task.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            {origin(task, topic?.title)}
            {!task.is_private && <Person id={task.assignee_id} />}
            {(showDate || overdue) && task.due_date && (
              <span className={overdue ? "font-semibold text-red-700" : "text-slate-500"}>
                {overdue ? "En retard · " : ""}
                {relativeDay(task.due_date, today)}
              </span>
            )}
          </div>
        </button>
      </div>
      {overdue && (
        <div className="mt-3 flex gap-2">
          <Button kind="secondary" className="flex-1" onClick={() => void setDone(true)}>
            Terminer
          </Button>
          <Button kind="secondary" className="flex-1" onClick={() => void move(addDays(today, 1))}>
            Demain
          </Button>
          <Button kind="secondary" className="flex-1" onClick={() => setPick((p) => !p)}>
            Choisir un jour
          </Button>
        </div>
      )}
      {pick && (
        <input
          type="date"
          aria-label="Nouveau jour"
          min={today}
          className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3"
          onChange={(e) => e.target.value && void move(e.target.value).then(() => setPick(false))}
        />
      )}
      {open && <TaskSheet task={task} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function TaskSheet({ task, onClose }: { task: Task; onClose: () => void }) {
  const { s, partner, run } = useReady();
  const [title, setTitle] = useState(task.title);
  const [who, setWho] = useState<WhoChoice>(idToWho(task.assignee_id, s.me));
  const [date, setDate] = useState(task.due_date ?? "");
  const [appt, setAppt] = useState(false);
  const opts = useWhoOptions();
  const topic = s.topics.find((t) => t.id === task.topic_id);
  const save = async () => {
    const ok = await run(() =>
      supabase()
        .from("tasks")
        .update({
          title: title.trim() || task.title,
          due_date: date || null,
          assignee_id: task.is_private ? task.owner_id : whoToId(who, s.me, partner?.id),
        })
        .eq("id", task.id),
    );
    if (ok !== null) onClose();
  };
  const remove = async () => {
    const ok = await run(() => supabase().from("tasks").delete().eq("id", task.id), "Tâche supprimée");
    if (ok !== null) onClose();
  };
  if (appt) {
    return (
      <Sheet open onClose={onClose} title="Ajouter un rendez-vous">
        <AppointmentForm fromTask={task} onDone={onClose} />
      </Sheet>
    );
  }
  return (
    <Sheet open onClose={onClose} title="Tâche">
      <div className="space-y-4">
        <label className="block">
          <Label>Titre</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        {!task.is_private && (
          <div>
            <Label>Qui s’en charge ?</Label>
            <Segmented name="Responsable" value={who} onChange={setWho} options={opts} />
          </div>
        )}
        <label className="block">
          <Label>Jour (facultatif)</Label>
          <div className="flex gap-2">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            {date && (
              <Button kind="ghost" onClick={() => setDate("")}>
                Sans date
              </Button>
            )}
          </div>
        </label>
        {topic && (
          <Link href={`/sujets/${topic.id}`} className="block text-sm font-semibold text-slate-600 underline">
            Sujet : {topic.title}
          </Link>
        )}
        <Button className="w-full" onClick={() => void save()}>
          Enregistrer
        </Button>
        <Button kind="secondary" className="w-full" onClick={() => setAppt(true)}>
          Ajouter un rendez-vous
        </Button>
        <Button kind="danger" className="w-full" onClick={() => void remove()}>
          Supprimer
        </Button>
      </div>
    </Sheet>
  );
}
