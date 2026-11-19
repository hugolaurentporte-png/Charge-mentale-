"use client";
// Échanges : une conversation à deux, reliée aux tâches.
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useReady } from "@/lib/store";
import { formatDay, relativeDay, todayIn } from "@/lib/dates";
import { analyze } from "@/lib/capture";
import type { Message } from "@/lib/types";
import { Header } from "@/components/shell";
import { Button, Empty, Input, Sheet } from "@/components/ui";
import { TaskForm } from "@/components/forms";

function hhmm(iso: string, tz: string) {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso)).replace(":", " h ");
}

export default function EchangesPage() {
  const { s, today, who, run, deferDelete, partner, reload } = useReady();
  const tz = s.couple.timezone;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [toTask, setToTask] = useState<Message | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const messages = useMemo(() => s.messages ?? [], [s.messages]);
  const me = s.profiles.find((p) => p.id === s.me);
  const last = messages[messages.length - 1];

  // Lu : dès que la conversation est affichée (et à chaque retour au premier plan)
  // avec un message de l'autre plus récent. L'heure de lecture est fixée par le serveur.
  const readAtMs = Date.parse(me?.messages_read_at ?? "") || 0;
  const unseen = messages.some((m) => m.author_id !== s.me && Date.parse(m.created_at) > readAtMs);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [last?.id]);
  useEffect(() => {
    const markRead = () => {
      if (document.visibilityState === "visible") void supabase().rpc("mark_messages_read").then(() => reload());
    };
    if (unseen) markRead();
    document.addEventListener("visibilitychange", markRead);
    return () => document.removeEventListener("visibilitychange", markRead);
  }, [unseen, last?.id, reload]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    const ok = await run(() => supabase().from("messages").insert({ couple_id: s.couple.id, body: body.slice(0, 2000) }));
    setBusy(false);
    if (ok !== null) setText("");
  };

  let lastDay = "";
  return (
    <>
      <Header title="Échanges" />
      {!partner && <p className="px-1 text-sm text-slate-500">Invite ton partenaire depuis les Réglages pour échanger.</p>}
      <div className="space-y-2 pb-24">
        {messages.length === 0 && <Empty>Écris le premier message à {partner?.display_name ?? "l’autre"}.</Empty>}
        {messages.map((m) => {
          const mine = m.author_id === s.me;
          const day = todayIn(tz, new Date(m.created_at));
          const sep = day !== lastDay;
          lastDay = day;
          const color = s.profiles.find((p) => p.id === m.author_id)?.color ?? "#64748b";
          const tasks = s.tasks.filter((t) => t.message_id === m.id);
          return (
            <div key={m.id}>
              {sep && <div className="py-2 text-center text-xs font-semibold text-slate-400">{relativeDay(day, today) || formatDay(day)}</div>}
              <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <button
                  onClick={() => setOpen(open === m.id ? null : m.id)}
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-left text-[16px] shadow-sm ${mine ? "rounded-br-sm text-white" : "rounded-bl-sm bg-white ring-1 ring-slate-200"}`}
                  style={mine ? { background: color } : { borderLeft: `4px solid ${color}` }}
                  aria-label={`Message de ${who(m.author_id)}`}
                >
                  <span className="whitespace-pre-wrap break-words">{m.body}</span>
                  <span className={`mt-0.5 block text-right text-[11px] ${mine ? "text-white/80" : "text-slate-400"}`}>{hhmm(m.created_at, tz)}</span>
                </button>
              </div>
              {tasks.map((t) => (
                <div key={t.id} className={`mt-1 text-xs text-slate-500 ${mine ? "text-right" : ""}`}>
                  ✓ Tâche : {t.title}
                  {t.done ? " (faite)" : ""}
                </div>
              ))}
              {open === m.id && (
                <div className={`mt-1 flex gap-2 ${mine ? "justify-end" : ""}`}>
                  <Button kind="secondary" className="!min-h-9 text-sm" onClick={() => (setToTask(m), setOpen(null))}>
                    En faire une tâche
                  </Button>
                  {mine && (
                    <Button
                      kind="ghost"
                      className="!min-h-9 text-sm"
                      onClick={() => {
                        setOpen(null);
                        deferDelete(m.id, "Message supprimé", () => supabase().from("messages").delete().eq("id", m.id));
                      }}
                    >
                      Supprimer
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <div ref={end} />
      </div>

      <form
        onSubmit={send}
        className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-slate-200 bg-white/95 px-4 py-2 backdrop-blur"
      >
        <div className="mx-auto flex max-w-md gap-2">
          <Input aria-label="Message" value={text} onChange={(e) => setText(e.target.value)} placeholder="Écrire un message…" enterKeyHint="send" />
          <Button type="submit" disabled={!text.trim() || busy} aria-label="Envoyer">
            ➤
          </Button>
        </div>
      </form>

      {toTask && (
        <Sheet open onClose={() => setToTask(null)} title="En faire une tâche">
          <TaskForm
            initialTitle={analyze(toTask.body, today).title.slice(0, 200)}
            day={analyze(toTask.body, today).date ?? undefined}
            messageId={toTask.id}
            onDone={() => setToTask(null)}
          />
        </Sheet>
      )}
    </>
  );
}
