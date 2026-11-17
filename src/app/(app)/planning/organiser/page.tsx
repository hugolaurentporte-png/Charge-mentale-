"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useReady } from "@/lib/store";
import { capitalize, dayName, isoWeekday, shortTime, weekDays, weekLabel, weekStart } from "@/lib/dates";
import { pickupOn } from "@/lib/selectors";
import { Button, Input, Label, Segmented } from "@/components/ui";

type Who = "me" | "partner" | "undecided";
interface Row {
  day: string;
  on: boolean;
  time: string;
  who: Who;
  existing: boolean;
  initial: { on: boolean; time: string; who: Who };
}

const DAYS = ["L", "M", "M", "J", "V", "S", "D"];

function Organiser() {
  const { s, today, partner, run, who: nameOf } = useReady();
  const router = useRouter();
  const params = useSearchParams();
  const start = weekStart(params.get("semaine") || today);
  const topic = s.topics.find((t) => t.kind === "pickup_week" && t.week_start === start);
  const [usual, setUsual] = useState<number[]>(s.couple.usual_days);
  const [defTime, setDefTime] = useState(shortTime(s.couple.default_pickup_time));
  const [organize, setOrganize] = useState(!topic?.owner_id);
  const [saving, setSaving] = useState(false);

  const [rows, setRows] = useState<Row[]>(() =>
    weekDays(start).map((day) => {
      const p = pickupOn(s, day);
      const init = p
        ? {
            on: true,
            time: shortTime(p.time),
            who: (p.responsible_id === null ? "undecided" : p.responsible_id === s.me ? "me" : "partner") as Who,
          }
        : { on: s.couple.usual_days.includes(isoWeekday(day)) && day >= today, time: shortTime(s.couple.default_pickup_time), who: "undecided" as Who };
      return { day, existing: Boolean(p), initial: { ...init }, ...init };
    }),
  );
  const update = (day: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.day === day ? { ...r, ...patch } : r)));

  const opts = [
    { value: "me" as Who, label: "Moi", color: s.profiles.find((p) => p.id === s.me)?.color },
    ...(partner ? [{ value: "partner" as Who, label: "Mon partenaire", color: partner.color }] : []),
    { value: "undecided" as Who, label: "À décider", color: "#ea580c" },
  ];

  const save = async () => {
    const entries = rows
      .filter((r) => r.day >= today)
      .flatMap((r): { day: string; none?: boolean; time?: string; who?: Who }[] => {
        if (r.existing) {
          if (!r.on) return [{ day: r.day, none: true }];
          if (r.on && (r.time !== r.initial.time || r.who !== r.initial.who))
            return [{ day: r.day, time: r.time, who: r.who }];
          return [];
        }
        return r.on ? [{ day: r.day, time: r.time, who: r.who }] : [];
      });
    setSaving(true);
    const habitsChanged =
      JSON.stringify([...usual].sort()) !== JSON.stringify([...s.couple.usual_days].sort()) ||
      defTime !== shortTime(s.couple.default_pickup_time);
    if (habitsChanged) {
      await run(() =>
        supabase().from("couples").update({ usual_days: [...usual].sort(), default_pickup_time: defTime }).eq("id", s.couple.id),
      );
    }
    const ok = await run(
      () => supabase().rpc("save_pickups", { p_entries: entries, p_organize_week: organize ? start : null }),
      "Récupérations enregistrées",
    );
    setSaving(false);
    if (ok !== null) router.push("/planning");
  };

  const applyHabits = () =>
    setRows((rs) =>
      rs.map((r) =>
        r.existing || r.day < today ? r : { ...r, on: usual.includes(isoWeekday(r.day)), time: defTime },
      ),
    );

  return (
    <div className="pt-4">
      <button onClick={() => router.back()} className="text-sm font-semibold text-slate-500">
        ‹ Planning
      </button>
      <h1 className="mt-1 text-2xl font-extrabold">Organiser les récupérations</h1>
      <p className="text-slate-600">
        {s.couple.child_name} · semaine du {weekLabel(start)}
      </p>

      <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        {topic?.owner_id ? (
          <p className="text-[15px]">
            Organisation de la semaine : <b>{nameOf(topic.owner_id)}</b>
          </p>
        ) : (
          <label className="flex items-center gap-3 text-[15px]">
            <input type="checkbox" className="h-5 w-5" checked={organize} onChange={(e) => setOrganize(e.target.checked)} />
            Je prends en charge l’organisation de cette semaine
          </label>
        )}
        <p className="mt-1 text-sm text-slate-500">Les jours restés « À décider » remontent dans les suivis de l’organisateur.</p>
      </div>

      <div className="mt-4 space-y-3">
        {rows.map((r) => {
          const past = r.day < today;
          return (
            <div key={r.day} className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 ${past ? "opacity-50" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="font-bold">
                  {capitalize(dayName(r.day))} {Number(r.day.slice(8))}
                </div>
                {r.on ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="time"
                      aria-label={`Heure ${dayName(r.day)}`}
                      value={r.time}
                      disabled={past}
                      onChange={(e) => update(r.day, { time: e.target.value })}
                      className="!w-28"
                    />
                    <Button kind="ghost" disabled={past} className="!px-2 text-sm" onClick={() => update(r.day, { on: false })}>
                      Pas de crèche
                    </Button>
                  </div>
                ) : (
                  <Button kind="secondary" disabled={past} className="text-sm" onClick={() => update(r.day, { on: true })}>
                    Ajouter un créneau
                  </Button>
                )}
              </div>
              {r.on && (
                <div className="mt-3">
                  <Segmented
                    name={`Qui ${dayName(r.day)}`}
                    value={r.who}
                    onChange={(w) => !past && update(r.day, { who: w })}
                    options={opts}
                  />
                </div>
              )}
              {!r.on && <div className="mt-1 text-sm text-slate-400">Pas de crèche</div>}
            </div>
          );
        })}
      </div>

      <details className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <summary className="font-semibold">Jours habituels et heure par défaut</summary>
        <div className="mt-3 flex gap-1">
          {DAYS.map((d, i) => {
            const n = i + 1;
            const on = usual.includes(n);
            return (
              <button
                key={n}
                type="button"
                aria-pressed={on}
                aria-label={capitalize(["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"][i])}
                onClick={() => setUsual((u) => (on ? u.filter((x) => x !== n) : [...u, n]))}
                className={`h-10 flex-1 rounded-lg font-bold ${on ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}
              >
                {d}
              </button>
            );
          })}
        </div>
        <label className="mt-3 block">
          <Label>Heure par défaut</Label>
          <Input type="time" value={defTime} onChange={(e) => setDefTime(e.target.value)} />
        </label>
        <Button kind="secondary" className="mt-3 w-full" onClick={applyHabits}>
          Appliquer aux jours non enregistrés
        </Button>
      </details>

      <div className="sticky bottom-20 mt-6">
        <Button className="w-full shadow-lg" disabled={saving} onClick={() => void save()}>
          Enregistrer la semaine
        </Button>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Organiser />
    </Suspense>
  );
}
