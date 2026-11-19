"use client";
// « Vider ma tête » : saisir une pensée en quelques secondes, puis la trier.
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useReady } from "@/lib/store";
import { addDays, formatDay, formatTime } from "@/lib/dates";
import { analyze, CATEGORIES, categoryLabel, findDuplicate, normalize, shoppingLabel, type Category } from "@/lib/capture";
import { newId, onOutboxChange, pending, submit } from "@/lib/outbox";
import type { Task, UUID } from "@/lib/types";
import { Badge, Button, Empty, Input, Label, Section, Segmented, Sheet } from "./ui";
import { VoiceButton } from "./voice";

type Dest = "courses" | "inbox" | "me" | "partner" | "both";

function useShoppingList() {
  const { s } = useReady();
  return s.lists.find((l) => l.kind !== "gifts" && !l.is_private && normalize(l.name) === "courses");
}

function CategoryChips({ value, proposed, onChange }: { value: Category | null; proposed?: Category | null; onChange: (c: Category | null) => void }) {
  return (
    <div role="radiogroup" aria-label="Catégorie" className="flex flex-wrap gap-2">
      {CATEGORIES.map((c) => {
        const on = value === c.value;
        return (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(on ? null : c.value)}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ${
              on ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-200"
            }`}
          >
            {c.emoji} {c.label}
            {proposed === c.value && !on ? " ?" : ""}
          </button>
        );
      })}
    </div>
  );
}

function usePending() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const up = () => setN(pending().length);
    up();
    return onOutboxChange(up);
  }, []);
  return n;
}

/** Onglet « Vite » du bouton + : une phrase, et c'est noté. */
export function QuickCapture({ onDone }: { onDone: () => void }) {
  const { s, today, partner, toast, reload, run } = useReady();
  const shopping = useShoppingList();
  const [text, setText] = useState("");
  const [cat, setCat] = useState<Category | null | undefined>(undefined); // undefined = proposition
  const [fuzzyOk, setFuzzyOk] = useState<boolean | null>(null);
  const [dest, setDest] = useState<Dest | null>(null); // null = choix par défaut
  const [dupIgnored, setDupIgnored] = useState(false);
  const [added, setAdded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const waiting = usePending();

  const a = useMemo(() => analyze(text, today), [text, today]);
  const category = cat === undefined ? a.category : cat;
  const date = a.date ?? (a.fuzzy && fuzzyOk ? a.fuzzy.date : null);
  const time = date ? a.time : null;
  const toShopping = category === "courses" && Boolean(shopping);
  const destination: Dest = dest ?? (toShopping ? "courses" : "inbox");
  const label = destination === "courses" ? shoppingLabel(a.title) : a.title;

  // Doublons : tâches ouvertes, éléments à trier, articles de courses non cochés.
  const dup = useMemo(() => {
    if (!text.trim() || dupIgnored) return null;
    if (destination === "courses" && shopping) {
      const it = findDuplicate(label, s.items.filter((i) => i.list_id === shopping.id && !i.checked), (i) => i.label);
      return it ? { kind: "item" as const, label: it.label, id: it.id, where: shopping.name } : null;
    }
    const open = [...(s.inbox ?? []), ...s.tasks.filter((t) => !t.done)];
    const t = findDuplicate(a.title, open, (x) => x.title);
    return t ? { kind: "task" as const, label: t.title, id: t.id, where: t.inbox ? "À trier" : "Tâches", task: t } : null;
  }, [text, dupIgnored, destination, shopping, label, s.items, s.inbox, s.tasks, a.title]);

  const reset = () => {
    setText("");
    setCat(undefined);
    setFuzzyOk(null);
    setDest(null);
    setDupIgnored(false);
    input.current?.focus();
  };

  const merge = async () => {
    if (!dup) return;
    if (dup.kind === "task" && date && !dup.task.due_date) {
      await run(() => supabase().from("tasks").update({ due_date: date, due_time: time }).eq("id", dup.id));
    }
    toast(`Déjà noté : « ${dup.label} »`);
    setAdded((x) => [`${dup.label} (fusionné)`, ...x]);
    reset();
  };

  const add = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!a.title.trim() || busy) return;
    setBusy(true);
    let r: Awaited<ReturnType<typeof submit>>;
    if (destination === "courses" && shopping) {
      r = await submit("list_items", { id: newId(), list_id: shopping.id, label });
    } else {
      const shared = destination !== "inbox";
      r = await submit("tasks", {
        id: newId(),
        couple_id: s.couple.id,
        owner_id: s.me,
        title: a.title.slice(0, 200),
        category,
        due_date: date,
        due_time: time,
        inbox: !shared,
        is_private: !shared,
        assignee_id: destination === "me" ? s.me : destination === "partner" ? (partner?.id ?? null) : null,
      });
    }
    setBusy(false);
    if (typeof r === "object") {
      toast("Impossible d’ajouter : " + String((r.error as { message?: string })?.message ?? "erreur"));
      return;
    }
    const where = destination === "courses" ? shopping?.name : destination === "inbox" ? "À trier" : "Tâches";
    toast(r === "queued" ? "Hors connexion : envoyé dès le retour du réseau" : `Noté · ${where}`);
    setAdded((x) => [`${label} → ${where}`, ...x]);
    if (r === "sent") void reload();
    reset();
  };

  const destOptions: { value: Dest; label: string }[] = [
    ...(toShopping && shopping ? [{ value: "courses" as Dest, label: shopping.name }] : []),
    { value: "inbox", label: "À trier" },
    { value: "me", label: "Moi" },
    ...(partner ? [{ value: "partner" as Dest, label: partner.display_name }] : []),
    { value: "both", label: "À deux" },
  ];

  return (
    <form onSubmit={add} className="space-y-4">
      <div>
        <Label>Qu’est-ce qui te passe par la tête ?</Label>
        <div className="flex gap-2">
          <Input
            ref={input}
            autoFocus
            aria-label="Pensée"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setDupIgnored(false);
            }}
            placeholder="Rappeler la mutuelle jeudi"
            enterKeyHint="done"
          />
          <VoiceButton onText={(t) => setText((x) => (x.trim() ? `${x.trim()} ${t}` : t))} />
        </div>
      </div>

      {text.trim() && (
        <>
          <div>
            <Label>Catégorie {a.category && cat === undefined ? "(proposée)" : ""}</Label>
            <CategoryChips value={category} proposed={a.category} onChange={(c) => setCat(c)} />
          </div>

          {a.date && (
            <p className="text-sm text-slate-600">
              📅 {formatDay(a.date)}
              {a.time ? ` à ${formatTime(a.time)}` : ""}
            </p>
          )}
          {a.fuzzy && !a.date && (
            <div className="rounded-xl bg-amber-50 p-3 text-sm">
              {a.fuzzy.date ? (
                <>
                  « {a.fuzzy.phrase} » : <b>{formatDay(a.fuzzy.date)}</b> ?
                  <div className="mt-2 flex gap-2">
                    <Button type="button" kind={fuzzyOk ? "primary" : "secondary"} className="!min-h-9 flex-1" onClick={() => setFuzzyOk(true)}>
                      Oui, cette date
                    </Button>
                    <Button type="button" kind={fuzzyOk === false ? "primary" : "secondary"} className="!min-h-9 flex-1" onClick={() => setFuzzyOk(false)}>
                      Sans date
                    </Button>
                  </div>
                </>
              ) : (
                <>« {a.fuzzy.phrase} » : pas de date précise, à voir au tri.</>
              )}
            </div>
          )}

          <div>
            <Label>Où ça va ?</Label>
            <Segmented name="Destination" value={destination} onChange={(v) => setDest(v)} options={destOptions} />
            <p className="mt-1 text-xs text-slate-500">
              {destination === "inbox"
                ? "Visible par toi seul, jusqu’à ce que tu le tries."
                : destination === "courses"
                  ? `Ajouté à la liste ${shopping?.name} : « ${label} ».`
                  : "Tâche partagée, visible par vous deux."}
            </p>
          </div>

          {dup && (
            <div className="rounded-xl bg-orange-50 p-3 text-sm" role="alert">
              Déjà présent dans {dup.where} : <b>« {dup.label} »</b>. Fusionner ?
              <div className="mt-2 flex gap-2">
                <Button type="button" kind="orange" className="!min-h-9 flex-1" onClick={() => void merge()}>
                  Fusionner
                </Button>
                <Button type="button" kind="secondary" className="!min-h-9 flex-1" onClick={() => setDupIgnored(true)}>
                  Ajouter quand même
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <Button type="submit" className="w-full" disabled={!text.trim() || busy || Boolean(dup)}>
        Noter
      </Button>
      {waiting > 0 && <p className="text-center text-sm text-amber-700">{waiting} en attente d’envoi (hors connexion)</p>}
      {added.length > 0 && (
        <div className="text-sm text-slate-500">
          {added.slice(0, 4).map((x, i) => (
            <div key={i}>✓ {x}</div>
          ))}
          <button type="button" onClick={onDone} className="mt-2 font-semibold text-slate-700 underline">
            Terminé
          </button>
        </div>
      )}
    </form>
  );
}

type SortWho = "private" | "me" | "partner" | "both";

/** Trier un élément : en faire une tâche (perso ou partagée), ou l'envoyer aux courses. */
function SortSheet({ task, onClose }: { task: Task; onClose: () => void }) {
  const { s, partner, run, toast } = useReady();
  const shopping = useShoppingList();
  const [title, setTitle] = useState(task.title);
  const [cat, setCat] = useState<Category | null>((task.category as Category) ?? null);
  const [date, setDate] = useState(task.due_date ?? "");
  const [time, setTime] = useState(task.due_time?.slice(0, 5) ?? "");
  const [who, setWho] = useState<SortWho>("private");
  const save = async () => {
    const shared = who !== "private";
    const ok = await run(
      () =>
        supabase()
          .from("tasks")
          .update({
            title: title.trim() || task.title,
            category: cat,
            due_date: date || null,
            due_time: date && time ? time : null,
            inbox: false,
            is_note: false,
            is_private: !shared,
            snoozed_until: null,
            assignee_id: who === "me" ? s.me : who === "partner" ? (partner?.id ?? null) : who === "private" ? s.me : null,
          })
          .eq("id", task.id),
      shared ? "Tâche partagée" : "Rangé dans Mes tâches",
    );
    if (ok !== null) onClose();
  };
  const toCourses = async () => {
    if (!shopping) return;
    const ok = await run(() => supabase().from("list_items").insert({ list_id: shopping.id, label: shoppingLabel(title) }));
    if (ok === null) return;
    await run(() => supabase().from("tasks").delete().eq("id", task.id));
    toast(`Ajouté à ${shopping.name}`);
    onClose();
  };
  const opts: { value: SortWho; label: string }[] = [
    { value: "private", label: "Privé 🔒" },
    { value: "me", label: "Moi" },
    ...(partner ? [{ value: "partner" as SortWho, label: partner.display_name }] : []),
    { value: "both", label: "À deux" },
  ];
  return (
    <Sheet open onClose={onClose} title="Trier">
      <div className="space-y-4">
        <label className="block">
          <Label>Titre</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div>
          <Label>Catégorie</Label>
          <CategoryChips value={cat} onChange={setCat} />
        </div>
        {cat === "courses" && shopping ? (
          <Button className="w-full" onClick={() => void toCourses()}>
            Mettre « {shoppingLabel(title)} » dans {shopping.name}
          </Button>
        ) : (
          <>
            <div className="flex gap-3">
              <label className="block min-w-0 flex-1">
                <Label>Jour (facultatif)</Label>
                <Input type="date" aria-label="Jour" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label className="block w-32">
                <Label>Heure</Label>
                <Input type="time" aria-label="Heure du tri" value={time} disabled={!date} onChange={(e) => setTime(e.target.value)} />
              </label>
            </div>
            <div>
              <Label>Pour qui ?</Label>
              <Segmented name="Pour qui" value={who} onChange={setWho} options={opts} />
              <p className="mt-1 text-xs text-slate-500">
                {who === "private" ? "Reste visible par toi seul." : "Devient visible par vous deux."}
                {who === "partner" && partner ? ` ${partner.display_name} sera prévenue.` : ""}
              </p>
            </div>
            <Button className="w-full" onClick={() => void save()}>
              En faire une tâche
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** « Me le dire » : se parler à soi-même. Chaque note est un élément « à trier »
 *  (même système), qu'on trie, reporte, supprime ou garde comme simple note. */
export function InboxSection() {
  const { s, today, run, deferDelete, toast, reload } = useReady();
  const [sorting, setSorting] = useState<Task | null>(null);
  const [showLater, setShowLater] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const waiting = usePending();
  const all = (s.inbox ?? []).filter((t) => !t.done).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const later = all.filter((t) => !t.is_note && t.snoozed_until && t.snoozed_until > today);
  const shown = all.filter((t) => !later.includes(t));
  const toSort = shown.filter((t) => !t.is_note).length;

  const say = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    const a = analyze(body, today);
    const r = await submit("tasks", {
      id: newId(),
      couple_id: s.couple.id,
      owner_id: s.me,
      title: (a.title || body).slice(0, 200),
      note: body.length > 200 ? body.slice(0, 2000) : null,
      category: a.category,
      due_date: a.date,
      due_time: a.date ? a.time : null,
      inbox: true,
      is_private: true,
    });
    setBusy(false);
    if (typeof r === "object") {
      toast("Impossible d’enregistrer : " + String((r.error as { message?: string })?.message ?? "erreur"));
      return;
    }
    if (r === "queued") toast("Hors connexion : enregistré dès le retour du réseau");
    else void reload();
    setText("");
  };
  const snooze = (id: UUID) =>
    run(() => supabase().from("tasks").update({ snoozed_until: addDays(today, 1) }).eq("id", id), "Reporté à demain");
  const keep = (id: UUID) => run(() => supabase().from("tasks").update({ is_note: true }).eq("id", id), "Gardé comme note");
  const remove = (t: Task) =>
    deferDelete(t.id, `« ${t.title} » supprimé`, () => supabase().from("tasks").delete().eq("id", t.id));

  const bubble = (t: Task) => (
    <div key={t.id} className="flex justify-end">
      <div className={`w-[88%] rounded-2xl rounded-br-sm p-3 shadow-sm ring-1 ${t.is_note ? "bg-violet-50 ring-violet-200" : "bg-white ring-slate-200"}`}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="whitespace-pre-wrap break-words font-semibold">
              {t.is_note ? "📝 " : ""}
              {t.note ?? t.title}
            </div>
            <div className="mt-1 flex flex-wrap gap-2 text-sm text-slate-500">
              {t.category && <Badge>{categoryLabel(t.category)}</Badge>}
              {t.due_date && <span>📅 {formatDay(t.due_date)}</span>}
              {t.snoozed_until && t.snoozed_until > today && <span>Reporté au {formatDay(t.snoozed_until)}</span>}
            </div>
          </div>
          <button aria-label={`Supprimer ${t.title}`} onClick={() => remove(t)} className="h-9 w-9 text-xl text-slate-400">
            ×
          </button>
        </div>
        <div className="mt-2 flex gap-2">
          <Button className="!min-h-9 flex-1 text-sm" onClick={() => setSorting(t)}>
            Trier
          </Button>
          {!t.is_note && (
            <>
              <Button kind="secondary" className="!min-h-9 flex-1 text-sm" onClick={() => void snooze(t.id)}>
                Plus tard
              </Button>
              <Button kind="secondary" className="!min-h-9 flex-1 text-sm" onClick={() => void keep(t.id)}>
                Garder
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <Section title={`Me le dire · À trier (${toSort})`}>
      <p className="px-1 text-sm text-slate-500">Dis-toi ce que tu ne veux pas oublier. Personne d’autre ne le voit.</p>
      {shown.length ? shown.map(bubble) : <Empty>Rien à trier. Écris ci-dessous pour vider ta tête.</Empty>}
      {later.length > 0 && (
        <button onClick={() => setShowLater((x) => !x)} className="text-sm font-semibold text-slate-500 underline">
          {showLater ? "Masquer" : "Voir"} les reportés ({later.length})
        </button>
      )}
      {showLater && later.map(bubble)}
      <form onSubmit={say} className="flex gap-2">
        <Input aria-label="Me le dire" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ne pas oublier de…" enterKeyHint="send" />
        <Button type="submit" disabled={!text.trim() || busy} aria-label="Me le dire, envoyer">
          ➤
        </Button>
      </form>
      {waiting > 0 && <p className="text-sm text-amber-700">{waiting} en attente d’envoi (hors connexion)</p>}
      {sorting && <SortSheet task={sorting} onClose={() => setSorting(null)} />}
    </Section>
  );
}
