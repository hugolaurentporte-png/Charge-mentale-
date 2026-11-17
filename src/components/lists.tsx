"use client";
import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useReady } from "@/lib/store";
import type { List } from "@/lib/types";
import { Button, Input } from "./ui";

export function FavStar({ list }: { list: List }) {
  const { s, run } = useReady();
  const fav = s.favorites.includes(list.id);
  return (
    <button
      aria-label={fav ? `Retirer ${list.name} des favoris` : `Mettre ${list.name} en favori`}
      aria-pressed={fav}
      onClick={(e) => {
        e.preventDefault();
        void run(() =>
          fav
            ? supabase().from("list_favorites").delete().eq("list_id", list.id).eq("user_id", s.me)
            : supabase().from("list_favorites").insert({ list_id: list.id }),
        );
      }}
      className={`h-10 w-10 shrink-0 rounded-full text-xl ${fav ? "text-amber-500" : "text-slate-300"}`}
    >
      ★
    </button>
  );
}

export function ListLink({ list }: { list: List }) {
  const { s } = useReady();
  const items = s.items.filter((i) => i.list_id === list.id);
  const left = list.kind === "gifts" ? items.filter((i) => i.gift_status !== "bought").length : items.filter((i) => !i.checked).length;
  return (
    <Link href={`/listes/${list.id}`} className="flex items-center gap-2 rounded-2xl bg-white p-3 pl-4 shadow-sm ring-1 ring-slate-200">
      <div className="min-w-0 flex-1">
        <div className="text-[16px] font-bold">{list.name}</div>
        <div className="text-sm text-slate-500">
          {left} {list.kind === "gifts" ? (left > 1 ? "idées" : "idée") : left > 1 ? "articles à acheter" : "article à acheter"}
        </div>
      </div>
      <FavStar list={list} />
    </Link>
  );
}

export function NewListForm({ isPrivate = false }: { isPrivate?: boolean }) {
  const { s, run } = useReady();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [gifts, setGifts] = useState(false);
  if (!open)
    return (
      <Button kind="secondary" className="w-full" onClick={() => setOpen(true)}>
        {isPrivate ? "Nouvelle liste privée" : "Nouvelle liste"}
      </Button>
    );
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const ok = await run(() =>
      supabase().from("lists").insert({
        couple_id: s.couple.id,
        name: name.trim(),
        kind: gifts ? "gifts" : "items",
        is_private: isPrivate,
      }),
    );
    if (ok !== null) {
      setName("");
      setOpen(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={isPrivate ? "Surprises pour Camille" : "Pharmacie"} />
      <label className="flex items-center gap-3 text-[15px]">
        <input type="checkbox" className="h-5 w-5" checked={gifts} onChange={(e) => setGifts(e.target.checked)} />
        Liste d’idées cadeaux
      </label>
      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={!name.trim()}>
          Créer
        </Button>
        <Button kind="ghost" onClick={() => setOpen(false)}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

