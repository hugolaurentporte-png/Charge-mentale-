"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useReady } from "@/lib/store";
import { addDays } from "@/lib/dates";
import type { GiftStatus, ListItem, Task, UUID } from "@/lib/types";
import { Button, Input, Label, Segmented } from "./ui";

export type WhoChoice = "me" | "partner" | "none";

export function useWhoOptions(noneLabel = "À décider") {
  const { s, partner } = useReady();
  const me = s.profiles.find((p) => p.id === s.me);
  const opts: { value: WhoChoice; label: string; color?: string }[] = [
    { value: "me", label: "Toi", color: me?.color },
  ];
  if (partner) opts.push({ value: "partner", label: partner.display_name, color: partner.color });
  opts.push({ value: "none", label: noneLabel, color: "#ea580c" });
  return opts;
}

export function whoToId(w: WhoChoice, me: UUID, partner: UUID | undefined): UUID | null {
  return w === "me" ? me : w === "partner" ? partner ?? null : null;
}

export function idToWho(id: UUID | null, me: UUID): WhoChoice {
  return id === null ? "none" : id === me ? "me" : "partner";
}

function DateQuick({ value, onChange, today }: { value: string; onChange: (v: string) => void; today: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {[
        { l: "Aujourd’hui", v: today },
        { l: "Demain", v: addDays(today, 1) },
        { l: "Sans date", v: "" },
      ].map((o) => (
        <button
          key={o.l}
          type="button"
          onClick={() => onChange(o.v)}
          className={`min-h-9 rounded-full px-3 text-sm font-semibold ${
            value === o.v ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
          }`}
        >
          {o.l}
        </button>
      ))}
      <input
        type="date"
        aria-label="Choisir un jour"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-9 rounded-full border border-slate-300 px-3 text-sm"
      />
    </div>
  );
}

/** Nouvelle tâche (partagée ou privée) ; seul le titre est obligatoire. */
export function TaskForm({
  day,
  isPrivate = false,
  topicId,
  onDone,
}: {
  day?: string;
  isPrivate?: boolean;
  topicId?: UUID;
  onDone: () => void;
}) {
  const { s, partner, run, today } = useReady();
  const [title, setTitle] = useState("");
  const [who, setWho] = useState<WhoChoice>(isPrivate ? "me" : "none");
  const [date, setDate] = useState(day ?? "");
  const opts = useWhoOptions();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const ok = await run(() =>
      supabase().from("tasks").insert({
        couple_id: s.couple.id,
        title: title.trim(),
        due_date: date || null,
        is_private: isPrivate,
        assignee_id: isPrivate ? s.me : whoToId(who, s.me, partner?.id),
        topic_id: topicId ?? null,
      }),
    );
    if (ok !== null) onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <Label>Titre</Label>
        <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Appeler la banque" />
      </label>
      {!isPrivate && (
        <div>
          <Label>Qui s’en charge ?</Label>
          <Segmented name="Responsable" value={who} onChange={setWho} options={opts} />
        </div>
      )}
      <div>
        <Label>Quand ?</Label>
        <DateQuick value={date} onChange={setDate} today={today} />
      </div>
      <Button type="submit" className="w-full" disabled={!title.trim()}>
        Ajouter
      </Button>
    </form>
  );
}

/** Sujet partagé : seul le titre est obligatoire. */
export function TopicForm({ onDone }: { onDone: (id?: UUID) => void }) {
  const { s, run } = useReady();
  const [title, setTitle] = useState("");
  const [mine, setMine] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const row = await run(() =>
      supabase()
        .from("topics")
        .insert({ couple_id: s.couple.id, title: title.trim(), owner_id: mine ? s.me : null })
        .select("id")
        .single(),
    );
    if (row !== null) onDone((row as { id: UUID }).id);
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <Label>Sujet</Label>
        <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Banque" />
      </label>
      <label className="flex items-center gap-3 text-[15px]">
        <input type="checkbox" className="h-5 w-5" checked={mine} onChange={(e) => setMine(e.target.checked)} />
        Je m’en occupe
      </label>
      <p className="text-sm text-slate-500">Sinon, le sujet reste « À prendre en charge » jusqu’à ce que l’un de vous le prenne.</p>
      <Button type="submit" className="w-full" disabled={!title.trim()}>
        Créer le sujet
      </Button>
    </form>
  );
}

/** Rendez-vous ; depuis une tâche, titre prérempli et option « Terminer la tâche ». */
export function AppointmentForm({ day, fromTask, onDone }: { day?: string; fromTask?: Task; onDone: () => void }) {
  const { s, partner, run, today } = useReady();
  const [title, setTitle] = useState(fromTask?.title ?? "");
  const [date, setDate] = useState(day ?? fromTask?.due_date ?? today);
  const [time, setTime] = useState("10:00");
  const [people, setPeople] = useState<UUID[]>([fromTask?.assignee_id ?? s.me]);
  const [finish, setFinish] = useState(Boolean(fromTask));
  const toggle = (id: UUID) =>
    setPeople((p) => (p.includes(id) ? (p.length > 1 ? p.filter((x) => x !== id) : p) : [...p, id]));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date || !time) return;
    const ok = await run(() =>
      supabase().from("appointments").insert({
        couple_id: s.couple.id,
        title: title.trim(),
        day: date,
        time,
        participants: people,
        task_id: fromTask && !fromTask.is_private ? fromTask.id : null,
      }),
    );
    if (ok === null) return;
    if (fromTask && finish) await run(() => supabase().from("tasks").update({ done: true }).eq("id", fromTask.id));
    onDone();
  };
  const members = [s.me, ...(partner ? [partner.id] : [])];
  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <Label>Rendez-vous</Label>
        <Input autoFocus={!fromTask} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Pédiatre" />
      </label>
      <div className="flex gap-3">
        <label className="block min-w-0 flex-1">
          <Label>Jour</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="block w-32">
          <Label>Heure</Label>
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        </label>
      </div>
      <div>
        <Label>Participants</Label>
        <div className="flex gap-2">
          {members.map((id) => {
            const p = s.profiles.find((x) => x.id === id);
            const on = people.includes(id);
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(id)}
                style={on ? { background: p?.color, color: "white" } : undefined}
                className={`min-h-10 flex-1 rounded-xl px-3 text-sm font-semibold ${on ? "" : "bg-slate-100 text-slate-600"}`}
              >
                {id === s.me ? "Toi" : p?.display_name}
              </button>
            );
          })}
        </div>
      </div>
      {fromTask && (
        <label className="flex items-center gap-3 text-[15px]">
          <input type="checkbox" className="h-5 w-5" checked={finish} onChange={(e) => setFinish(e.target.checked)} />
          Terminer « {fromTask.title} »
        </label>
      )}
      <Button type="submit" className="w-full" disabled={!title.trim()}>
        Enregistrer le rendez-vous
      </Button>
    </form>
  );
}

export function GoalForm({ onDone }: { onDone: () => void }) {
  const { run } = useReady();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const ok = await run(() => supabase().from("goals").insert({ title: title.trim(), due_date: due || null }));
    if (ok !== null) onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <Label>Objectif</Label>
        <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Courir 10 km" />
      </label>
      <label className="block">
        <Label>Échéance (facultatif)</Label>
        <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </label>
      <Button type="submit" className="w-full" disabled={!title.trim()}>
        Ajouter l’objectif
      </Button>
    </form>
  );
}

export const OCCASIONS = ["Noël", "Anniversaire", "Fête des mères", "Fête des pères", "Saint-Valentin", "Naissance"];
export const GIFT_STATUS: Record<GiftStatus, string> = { idea: "Idée", chosen: "Choisie", bought: "Achetée" };

export function GiftForm({ listId, item, onDone }: { listId: UUID; item?: ListItem; onDone: () => void }) {
  const { s, run } = useReady();
  const [label, setLabel] = useState(item?.label ?? "");
  const [recipient, setRecipient] = useState(item?.recipient ?? "");
  const [occasion, setOccasion] = useState(item?.occasion ?? "");
  const [note, setNote] = useState(item?.note ?? item?.url ?? "");
  const [status, setStatus] = useState<GiftStatus>(item?.gift_status ?? "idea");
  const known = Array.from(new Set(s.items.map((i) => i.recipient).filter(Boolean))) as string[];
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    const isUrl = /^https?:\/\//i.test(note.trim());
    const row = {
      list_id: listId,
      label: label.trim(),
      recipient: recipient.trim() || null,
      occasion: occasion.trim() || null,
      note: isUrl ? null : note.trim() || null,
      url: isUrl ? note.trim() : null,
      gift_status: status,
    };
    const db = supabase().from("list_items");
    const ok = await run(() => (item ? db.update(row).eq("id", item.id) : db.insert(row)));
    if (ok !== null) onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <Label>Idée</Label>
        <Input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Livre de cuisine" />
      </label>
      <div className="flex gap-3">
        <label className="block min-w-0 flex-1">
          <Label>Pour qui ?</Label>
          <Input list="recipients" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Mamie" />
          <datalist id="recipients">
            {known.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </label>
        <label className="block min-w-0 flex-1">
          <Label>Occasion</Label>
          <Input list="occasions" value={occasion} onChange={(e) => setOccasion(e.target.value)} placeholder="Noël" />
          <datalist id="occasions">
            {OCCASIONS.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </label>
      </div>
      <label className="block">
        <Label>Note ou lien</Label>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="https://… ou taille 38" />
      </label>
      <div>
        <Label>Statut</Label>
        <Segmented
          name="Statut"
          value={status}
          onChange={setStatus}
          options={(Object.keys(GIFT_STATUS) as GiftStatus[]).map((k) => ({ value: k, label: GIFT_STATUS[k] }))}
        />
      </div>
      <Button type="submit" className="w-full" disabled={!label.trim()}>
        {item ? "Enregistrer" : "Ajouter l’idée"}
      </Button>
    </form>
  );
}

export function ItemForm({ listId, onDone }: { listId: UUID; onDone: () => void }) {
  const { run } = useReady();
  const [label, setLabel] = useState("");
  const [qty, setQty] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    const ok = await run(() =>
      supabase().from("list_items").insert({ list_id: listId, label: label.trim(), quantity: qty.trim() || null }),
    );
    if (ok !== null) {
      setLabel("");
      setQty("");
      onDone();
    }
  };
  return (
    <form onSubmit={submit} className="flex gap-2">
      <Input
        autoFocus
        aria-label="Article"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Ajouter un article"
        className="flex-1"
      />
      <Input aria-label="Quantité" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Qté" className="!w-20" />
      <Button type="submit" disabled={!label.trim()} aria-label="Ajouter l’article">
        +
      </Button>
    </form>
  );
}
