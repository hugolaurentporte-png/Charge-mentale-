"use client";
import { useState } from "react";
import { useReady } from "@/lib/store";
import { Header, useFab } from "@/components/shell";
import { Empty, Section } from "@/components/ui";
import { TaskRow } from "@/components/tasks";
import { TopicCard } from "@/components/topics";
import { ListLink, NewListForm } from "@/components/lists";

export default function ListesPage() {
  const { s } = useReady();
  useFab({ mode: "lists" });
  const [showClosed, setShowClosed] = useState(false);
  const open = s.topics
    .filter((t) => t.status === "open")
    .sort((a, b) => Number(Boolean(a.owner_id)) - Number(Boolean(b.owner_id)));
  const closed = s.topics.filter((t) => t.status === "closed");
  const todo = s.tasks.filter((t) => !t.is_private && !t.due_date && !t.done);
  const lists = s.lists.filter((l) => !l.is_private);
  return (
    <>
      <Header title="Listes" />
      <Section title="Sujets à deux">
        {open.length ? open.map((t) => <TopicCard key={t.id} t={t} />) : <Empty>Aucun sujet en cours. Appuie sur + pour en créer un.</Empty>}
        {closed.length > 0 && (
          <button className="px-1 text-sm font-semibold text-slate-500 underline" onClick={() => setShowClosed((v) => !v)}>
            {showClosed ? "Masquer" : "Voir"} les sujets réglés ({closed.length})
          </button>
        )}
        {showClosed && closed.map((t) => <TopicCard key={t.id} t={t} />)}
      </Section>
      <Section title="À faire à deux">
        {todo.length ? todo.map((t) => <TaskRow key={t.id} task={t} />) : <Empty>Rien en attente.</Empty>}
      </Section>
      <Section title="Listes partagées">
        {lists.map((l) => (
          <ListLink key={l.id} list={l} />
        ))}
        <NewListForm />
      </Section>
    </>
  );
}
