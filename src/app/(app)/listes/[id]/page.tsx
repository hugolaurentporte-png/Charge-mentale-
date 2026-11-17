"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useReady } from "@/lib/store";
import type { GiftStatus, ListItem } from "@/lib/types";
import { useFab } from "@/components/shell";
import { GIFT_STATUS, GiftForm, ItemForm } from "@/components/forms";
import { FavStar } from "@/components/lists";
import { Badge, Button, Empty, Sheet, useOptimistic } from "@/components/ui";

function ItemRow({ item }: { item: ListItem }) {
  const { run } = useReady();
  const [checked, setChecked] = useOptimistic(item.checked);
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <input
        type="checkbox"
        aria-label={`${item.checked ? "Décocher" : "Cocher"} ${item.label}`}
        checked={checked}
        onChange={(e) => {
          setChecked(e.target.checked);
          void run(() => supabase().from("list_items").update({ checked: e.target.checked }).eq("id", item.id));
        }}
        className="h-6 w-6 shrink-0 accent-slate-900"
      />
      <div className={`min-w-0 flex-1 text-[16px] ${item.checked ? "text-slate-400 line-through" : "font-semibold"}`}>
        {item.label}
        {item.quantity && <span className="ml-2 font-normal text-slate-500">× {item.quantity}</span>}
      </div>
      <button
        aria-label={`Supprimer ${item.label}`}
        onClick={() => void run(() => supabase().from("list_items").delete().eq("id", item.id))}
        className="h-9 w-9 rounded-full text-xl text-slate-400"
      >
        ×
      </button>
    </div>
  );
}

function GiftCard({ item, onEdit }: { item: ListItem; onEdit: () => void }) {
  const { run } = useReady();
  const setStatus = (st: GiftStatus) =>
    run(() => supabase().from("list_items").update({ gift_status: st, checked: st === "bought" }).eq("id", item.id));
  const tone = item.gift_status === "bought" ? "green" : item.gift_status === "chosen" ? "violet" : "slate";
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <button onClick={onEdit} className="block w-full text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="text-[16px] font-bold">{item.label}</div>
          <Badge tone={tone}>{GIFT_STATUS[item.gift_status ?? "idea"]}</Badge>
        </div>
        <div className="mt-1 text-sm text-slate-600">
          {[item.recipient && `Pour ${item.recipient}`, item.occasion].filter(Boolean).join(" · ") || "Destinataire à préciser"}
        </div>
        {item.note && <div className="mt-1 text-sm text-slate-500">{item.note}</div>}
      </button>
      {item.url && (
        <a href={item.url} target="_blank" rel="noreferrer noopener" className="mt-1 block truncate text-sm font-semibold text-indigo-700 underline">
          {item.url}
        </a>
      )}
      <div className="mt-3 flex gap-2">
        {(Object.keys(GIFT_STATUS) as GiftStatus[]).map((st) => (
          <button
            key={st}
            aria-pressed={item.gift_status === st}
            onClick={() => void setStatus(st)}
            className={`min-h-9 flex-1 rounded-lg text-sm font-semibold ${
              item.gift_status === st ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            {GIFT_STATUS[st]}
          </button>
        ))}
      </div>
    </div>
  );
}

function Gifts({ listId, items }: { listId: string; items: ListItem[] }) {
  const [recipient, setRecipient] = useState("");
  const [occasion, setOccasion] = useState("");
  const [editing, setEditing] = useState<ListItem | null>(null);
  const { run } = useReady();
  const recipients = Array.from(new Set(items.map((i) => i.recipient).filter(Boolean))) as string[];
  const occasions = Array.from(new Set(items.map((i) => i.occasion).filter(Boolean))) as string[];
  const shown = items
    .filter((i) => (!recipient || i.recipient === recipient) && (!occasion || i.occasion === occasion))
    .sort((a, b) => Number(a.gift_status === "bought") - Number(b.gift_status === "bought"));
  return (
    <>
      <div className="mt-4 flex gap-2">
        <select aria-label="Filtrer par destinataire" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="min-h-11 w-0 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-2 text-sm">
          <option value="">Tous les destinataires</option>
          {recipients.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <select aria-label="Filtrer par occasion" value={occasion} onChange={(e) => setOccasion(e.target.value)} className="min-h-11 w-0 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-2 text-sm">
          <option value="">Toutes les occasions</option>
          {occasions.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </div>
      <div className="mt-4 space-y-2">
        {shown.length ? shown.map((i) => <GiftCard key={i.id} item={i} onEdit={() => setEditing(i)} />) : <Empty>Aucune idée pour l’instant. Appuie sur +.</Empty>}
      </div>
      {editing && (
        <Sheet open onClose={() => setEditing(null)} title="Idée cadeau">
          <GiftForm listId={listId} item={editing} onDone={() => setEditing(null)} />
          <Button
            kind="danger"
            className="mt-3 w-full"
            onClick={() => void run(() => supabase().from("list_items").delete().eq("id", editing.id)).then(() => setEditing(null))}
          >
            Supprimer
          </Button>
        </Sheet>
      )}
    </>
  );
}

export default function ListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { s, run } = useReady();
  const router = useRouter();
  useFab({ mode: "list", listId: id });
  const list = s.lists.find((l) => l.id === id);
  if (!list) return <Empty>Liste introuvable.</Empty>;
  const items = s.items.filter((i) => i.list_id === id);
  const todo = items.filter((i) => !i.checked);
  const done = items.filter((i) => i.checked);
  const removeList = async () => {
    if (!window.confirm(`Supprimer la liste « ${list.name} » ?`)) return;
    const ok = await run(() => supabase().from("lists").delete().eq("id", list.id), "Liste supprimée");
    if (ok !== null) router.push(list.is_private ? "/moi" : "/listes");
  };
  return (
    <div className="pt-4">
      <button onClick={() => router.push(list.is_private ? "/moi" : "/listes")} className="text-sm font-semibold text-slate-500">
        ‹ {list.is_private ? "Pour moi" : "Listes"}
      </button>
      <div className="mt-1 flex items-center justify-between">
        <h1 className="text-[28px] font-extrabold">{list.name}</h1>
        <FavStar list={list} />
      </div>
      {list.is_private && <Badge tone="violet">Privée · visible par toi seul</Badge>}
      {list.kind === "gifts" ? (
        <Gifts listId={id} items={items} />
      ) : (
        <>
          <div className="mt-4">
            <ItemForm listId={id} onDone={() => {}} />
          </div>
          <div className="mt-4 space-y-2">
            {todo.map((i) => (
              <ItemRow key={i.id} item={i} />
            ))}
            {!todo.length && <Empty>Tout est pris.</Empty>}
          </div>
          {done.length > 0 && (
            <div className="mt-6 space-y-2">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Dans le panier</h2>
                <button
                  className="text-sm font-semibold text-slate-500 underline"
                  onClick={() => void run(() => supabase().from("list_items").delete().in("id", done.map((d) => d.id)))}
                >
                  Vider
                </button>
              </div>
              {done.map((i) => (
                <ItemRow key={i.id} item={i} />
              ))}
            </div>
          )}
        </>
      )}
      <Button kind="ghost" className="mt-8 w-full text-red-700" onClick={() => void removeList()}>
        Supprimer la liste
      </Button>
    </div>
  );
}
