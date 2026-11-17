"use client";
import { PushNudge } from "@/components/push";
import { useState } from "react";
import Link from "next/link";
import { useReady } from "@/lib/store";
import { addDays, capitalize, dayName, formatTime, weekDays, weekLabel, weekStart, nowTimeIn } from "@/lib/dates";
import { appointmentsOn, pendingRelayFor, pickupOn, tasksOn, todayView } from "@/lib/selectors";
import type { Appointment, Pickup } from "@/lib/types";
import { Header, useFab } from "@/components/shell";
import { Avatar, Badge, Button, Empty, ORANGE, Person, Section, Segmented } from "@/components/ui";
import { PickupCard, PickupEditSheet, usePickupActions } from "@/components/pickup";
import { TaskRow } from "@/components/tasks";
import { DecisionRow, FollowUpRow } from "@/components/topics";

function ApptRow({ a }: { a: Appointment }) {
  const { who } = useReady();
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <div className="w-16 shrink-0 text-lg font-extrabold">{formatTime(a.time)}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[16px] font-semibold">{a.title}</div>
        <div className="text-sm text-slate-600">{a.participants.map((p) => who(p)).join(" et ")}</div>
      </div>
      <div className="flex -space-x-2">
        {a.participants.map((p) => (
          <Avatar key={p} id={p} size={28} />
        ))}
      </div>
    </div>
  );
}

function Today() {
  const { s, today } = useReady();
  useFab({ mode: "planning", day: today });
  const v = todayView(s, today, nowTimeIn(s.couple.timezone));
  const favs = s.lists.filter((l) => s.favorites.includes(l.id));
  const nothing =
    !v.appointments.length && !v.tasks.length && !v.overdue.length && !v.followUps.length && !v.decisions.length;
  return (
    <div>
      <p className="px-1 text-slate-500">{capitalize(dayName(today))}</p>
      {v.pickup ? (
        <div className="mt-2">
          <PickupCard pickup={v.pickup} />
        </div>
      ) : null}
      <PushNudge />

      {v.appointments.length > 0 && (
        <Section title="Rendez-vous">
          {v.appointments.map((a) => (
            <ApptRow key={a.id} a={a} />
          ))}
        </Section>
      )}

      {v.tasks.length > 0 && (
        <Section title="Mes tâches du jour">
          {v.tasks.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </Section>
      )}

      {v.overdue.length > 0 && (
        <Section title="En retard">
          {v.overdue.map((t) => (
            <TaskRow key={t.id} task={t} overdue />
          ))}
        </Section>
      )}

      {v.followUps.length > 0 && (
        <Section title="Mes suivis à relancer">
          {v.followUps.map((f) => (
            <FollowUpRow key={`${f.kind}-${f.topic.id}-${f.date}`} f={f} />
          ))}
        </Section>
      )}

      {v.decisions.length > 0 && (
        <Section title="On attend ta réponse">
          {v.decisions.map((d) => (
            <DecisionRow key={d.relay?.id ?? d.topic?.id} d={d} />
          ))}
        </Section>
      )}

      {nothing && (
        <div className="mt-6">
          <Empty>Rien d’autre à faire aujourd’hui.</Empty>
        </div>
      )}

      {v.tomorrowToOrganize && (
        <Section title="Demain">
          <PickupCard pickup={v.tomorrowToOrganize} compact />
        </Section>
      )}

      {favs.length > 0 && (
        <Section title="Listes favorites">
          <div className="flex flex-wrap gap-2">
            {favs.map((l) => {
              const left = s.items.filter((i) => i.list_id === l.id && !i.checked && i.gift_status !== "bought").length;
              return (
                <Link
                  key={l.id}
                  href={`/listes/voir?id=${l.id}`}
                  className="rounded-2xl bg-white px-4 py-3 font-semibold shadow-sm ring-1 ring-slate-200"
                >
                  {l.name} <span className="text-slate-400">· {left}</span>
                </Link>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}

function Week({ onToday }: { onToday: () => void }) {
  const { s, today } = useReady();
  const [start, setStart] = useState(() => weekStart(today));
  const [selected, setSelected] = useState(today);
  const a = usePickupActions();
  const [editing, setEditing] = useState<Pickup | null>(null);
  useFab({ mode: "planning", day: selected });
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <Button kind="secondary" aria-label="Semaine précédente" onClick={() => setStart(addDays(start, -7))}>
          ‹
        </Button>
        <div className="text-center font-bold">{weekLabel(start)}</div>
        <Button kind="secondary" aria-label="Semaine suivante" onClick={() => setStart(addDays(start, 7))}>
          ›
        </Button>
      </div>
      <div className="mt-3 flex gap-2">
        {s.couple.pickups_enabled !== false && (
        <Link
          href={`/planning/organiser?semaine=${start}`}
          className="flex min-h-11 flex-1 items-center justify-center rounded-xl bg-slate-900 px-3 text-[15px] font-semibold text-white"
        >
          Organiser les récupérations
        </Link>
        )}
        {start !== weekStart(today) && (
          <Button
            kind="secondary"
            onClick={() => {
              setStart(weekStart(today));
              setSelected(today);
              onToday();
            }}
          >
            Aujourd’hui
          </Button>
        )}
      </div>
      <div className="mt-4 space-y-2">
        {weekDays(start).map((d) => {
          const p = pickupOn(s, d);
          const appts = appointmentsOn(s, d);
          const tasks = tasksOn(s, d);
          const isToday = d === today;
          const relay = p ? pendingRelayFor(s, p.id) : undefined;
          return (
            <div
              key={d}
              onClick={() => setSelected(d)}
              className={`rounded-2xl bg-white p-3 shadow-sm ring-1 ${
                selected === d ? "ring-2 ring-slate-900" : "ring-slate-200"
              } ${d < today ? "opacity-60" : ""}`}
            >
              <div className="flex items-center justify-between">
                <div className="font-bold">
                  {capitalize(dayName(d))} {Number(d.slice(8))}
                  {isToday && <Badge tone="green">Aujourd’hui</Badge>}
                </div>
              </div>
              {p && (
                <div
                  role={d >= today ? "button" : undefined}
                  aria-label={d >= today ? `Modifier la récupération du ${dayName(d)}` : undefined}
                  onClick={(e) => {
                    if (d < today) return;
                    e.stopPropagation();
                    setEditing(p);
                  }}
                  className="mt-2 flex cursor-pointer items-center gap-2 rounded-xl px-2 py-2"
                  style={{ background: p.responsible_id ? "#f8fafc" : "#fff7ed", borderLeft: `4px solid ${s.profiles.find((x) => x.id === p.responsible_id)?.color ?? ORANGE}` }}
                >
                  <span className="w-16 shrink-0 whitespace-nowrap font-extrabold">{formatTime(p.time)}</span>
                  <span className="min-w-0 flex-1 text-sm">
                    <Person id={p.responsible_id} />
                    {relay && <span className="ml-2 text-xs text-slate-500">relais en attente</span>}
                  </span>
                  {d >= today && p.responsible_id && <span className="text-xl text-slate-400" aria-hidden>›</span>}
                  {!p.responsible_id && d >= today && (
                    <Button
                      kind="orange"
                      className="!min-h-9 !px-3 text-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        void a.claim(p);
                      }}
                    >
                      Je {s.couple.child_pronoun} récupère
                    </Button>
                  )}
                </div>
              )}
              {appts.map((x) => (
                <div key={x.id} className="mt-2 flex items-center gap-2 px-2 text-sm">
                  <span className="w-14 font-bold">{formatTime(x.time)}</span>
                  <span className="flex-1 truncate">{x.title}</span>
                  <span className="flex -space-x-1">
                    {x.participants.map((id) => (
                      <Avatar key={id} id={id} size={22} />
                    ))}
                  </span>
                </div>
              ))}
              {tasks.length > 0 && (
                <div className="mt-2 space-y-2">
                  {tasks.map((t) => (
                    <TaskRow key={t.id} task={t} />
                  ))}
                </div>
              )}
              {!p && !appts.length && !tasks.length && <div className="mt-1 text-sm text-slate-400">Rien de prévu</div>}
            </div>
          );
        })}
      </div>
      {editing && <PickupEditSheet pickup={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

export default function PlanningPage() {
  // L'état n'est pas mémorisé : chaque ouverture affiche « Aujourd'hui ».
  const [view, setView] = useState<"today" | "week">("today");
  return (
    <>
      <Header title="Planning" />
      <div className="mb-4">
        <Segmented
          name="Vue"
          value={view}
          onChange={setView}
          options={[
            { value: "today", label: "Aujourd’hui" },
            { value: "week", label: "Semaine" },
          ]}
        />
      </div>
      {view === "today" ? <Today /> : <Week onToday={() => setView("today")} />}
    </>
  );
}
