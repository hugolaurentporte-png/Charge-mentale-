"use client";
import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useReady } from "@/lib/store";
import { addDays, formatTime, relativeDay } from "@/lib/dates";
import type { Task } from "@/lib/types";
import { AppointmentForm, idToWho, recurrenceLabel, TimeAndRepeat, useWhoOptions, whoToId, type RecurrenceChoice, type WhoChoice } from "./forms";
import { audienceStyle, Badge, Button, Input, Label, Person, Segmented, Sheet, Textarea, useAudienceColor, useOptimistic } from "./ui";

function origin(t: Task, topicTitle?: string) {
  if (t.is_private) return <Badge tone="violet">Juste moi</Badge>;
  if (topicTitle) return <Badge>{topicTitle}</Badge>;
  return null;
}

const EMOJIS = ["👍", "😊", "❤️", "🙏", "💪", "🎉", "😅"];

/** Réactions sur une tâche partagée : une par personne, touche à nouveau pour la retirer. */
function Reactions({ task }: { task: Task }) {
  const { s, run, who } = useReady();
  const [picking, setPicking] = useState(false);
  const list = s.reactions.filter((r) => r.task_id === task.id);
  const mine = list.find((r) => r.user_id === s.me);
  const react = async (emoji: string) => {
    setPicking(false);
    if (mine?.emoji === emoji) {
      await run(() => supabase().from("task_reactions").delete().eq("task_id", task.id).eq("user_id", s.me));
    } else {
      await run(() =>
        supabase().from("task_reactions").upsert({ task_id: task.id, user_id: s.me, emoji }, { onConflict: "task_id,user_id" }),
      );
    }
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-9">
      {list.map((r) => (
        <button
          key={r.user_id}
          onClick={() => r.user_id === s.me && void react(r.emoji)}
          aria-label={`${r.emoji} de ${who(r.user_id)}`}
          className={`flex h-8 items-center gap-1 rounded-full px-2 text-sm ${
            r.user_id === s.me ? "bg-violet-100 ring-1 ring-violet-300" : "bg-slate-100"
          }`}
        >
          <span>{r.emoji}</span>
          <span className="text-xs font-semibold text-slate-600">{who(r.user_id)}</span>
        </button>
      ))}
      {picking ? (
        <div className="flex flex-wrap gap-1 rounded-full bg-slate-100 px-1 py-0.5" role="group" aria-label="Choisir une réaction">
          {EMOJIS.map((e) => (
            <button key={e} onClick={() => void react(e)} aria-label={`Réagir ${e}`} className="h-8 w-8 rounded-full text-lg active:scale-90">
              {e}
            </button>
          ))}
        </div>
      ) : (
        <button
          onClick={() => setPicking(true)}
          aria-label="Ajouter une réaction"
          className="flex h-8 items-center rounded-full bg-slate-50 px-2 text-sm text-slate-500 ring-1 ring-slate-200"
        >
          {mine ? "Changer" : "☺︎ +"}
        </button>
      )}
    </div>
  );
}

/** Ligne de tâche : case à cocher, titre, provenance, responsable. */
export function TaskRow({ task, overdue = false, showDate = false }: { task: Task; overdue?: boolean; showDate?: boolean }) {
  const { s, run, today, toast } = useReady();
  const [open, setOpen] = useState(false);
  const color = useAudienceColor()({ isPrivate: task.is_private, people: [task.assignee_id] });
  // Tâche à deux sans responsable : un appui pour la prendre (l'autre est prévenu).
  const claimable = !task.is_private && !task.done && !task.assignee_id;
  const claim = async () => {
    const rows = (await run(() =>
      supabase().from("tasks").update({ assignee_id: s.me }).eq("id", task.id).is("assignee_id", null).select("id"),
    )) as { id: string }[] | null;
    if (rows && rows.length) toast(`Tu t’occupes de « ${task.title} »`);
    else if (rows) toast("Quelqu’un s’en occupe déjà.");
  };
  const [pick, setPick] = useState(false);
  const topic = s.topics.find((t) => t.id === task.topic_id);
  const [done, setLocalDone] = useOptimistic(task.done);
  const setDone = async (d: boolean, undoable = true) => {
    setLocalDone(d);
    const ok = await run(() => supabase().from("tasks").update({ done: d }).eq("id", task.id));
    if (ok !== null && d && undoable) toast(`« ${task.title} » terminée`, () => void setDone(false, false));
    return ok;
  };
  const move = (d: string) => run(() => supabase().from("tasks").update({ due_date: d }).eq("id", task.id));
  return (
    <div
      className={`rounded-2xl bg-white p-3 shadow-sm ring-1 ${overdue ? "ring-red-200" : "ring-slate-200"}`}
      style={audienceStyle(color)}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          aria-label={`Terminer ${task.title}`}
          checked={done}
          onChange={(e) => void setDone(e.target.checked)}
          className="mt-1 h-6 w-6 shrink-0 accent-slate-900"
        />
        <button onClick={() => setOpen(true)} className="min-w-0 flex-1 text-left">
          <div className={`text-[16px] font-semibold ${task.done ? "text-slate-400 line-through" : ""}`}>{task.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            {origin(task, topic?.title)}
            {!task.is_private && <Person id={task.assignee_id} empty="À deux" />}
            {(showDate || overdue) && task.due_date && (
              <span className={overdue ? "font-semibold text-red-700" : "text-slate-500"}>
                {overdue ? "En retard · " : ""}
                {relativeDay(task.due_date, today)}
              </span>
            )}
            {task.due_time && <span className="font-semibold text-slate-700">{formatTime(task.due_time)}</span>}
            {task.recurrence && <span className="text-slate-500">↻ {recurrenceLabel(task.recurrence)}</span>}
          </div>
          {task.note && <p className="mt-1 line-clamp-2 text-sm italic text-slate-600">« {task.note} »</p>}
        </button>
      </div>
      {claimable && (
        <Button kind="orange" className="mt-3 w-full !min-h-10" onClick={() => void claim()}>
          Je m’en occupe
        </Button>
      )}
      {!task.is_private && <Reactions task={task} />}
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
  const { s, partner, run, deferDelete } = useReady();
  const [title, setTitle] = useState(task.title);
  const [who, setWho] = useState<WhoChoice>(idToWho(task.assignee_id, s.me));
  const [date, setDate] = useState(task.due_date ?? "");
  const [time, setTime] = useState(task.due_time?.slice(0, 5) ?? "");
  const [repeat, setRepeat] = useState<RecurrenceChoice>(task.recurrence ?? "");
  const [note, setNote] = useState(task.note ?? "");
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
          due_time: date && time ? time : null,
          recurrence: date && repeat ? repeat : null,
          note: note.trim() || null,
          assignee_id: task.is_private ? task.owner_id : whoToId(who, s.me, partner?.id),
        })
        .eq("id", task.id),
    );
    if (ok !== null) onClose();
  };
  const remove = () => {
    onClose();
    deferDelete(task.id, `« ${task.title} » supprimée`, () => supabase().from("tasks").delete().eq("id", task.id));
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
        {date && <TimeAndRepeat time={time} setTime={setTime} repeat={repeat} setRepeat={setRepeat} />}
        <label className="block">
          <Label>Petit mot</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ajouter un mot pour l’autre" />
        </label>
        {topic && (
          <Link href={`/sujets/voir?id=${topic.id}`} className="block text-sm font-semibold text-slate-600 underline">
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
