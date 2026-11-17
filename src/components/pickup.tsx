"use client";
import { supabase } from "@/lib/supabase";
import { useReady } from "@/lib/store";
import { formatTime, relativeDay, todayIn } from "@/lib/dates";
import { pendingRelayFor } from "@/lib/selectors";
import type { Pickup } from "@/lib/types";
import { useState } from "react";
import { Avatar, Button, Input, Label, ORANGE, Segmented, Sheet } from "./ui";

export function usePickupActions() {
  const { s, run, toast, who } = useReady();
  return {
    claim: async (p: Pickup) => {
      const r = (await run(() => supabase().rpc("claim_pickup", { p_pickup: p.id }))) as
        | { ok: boolean; responsible_id: string }
        | null;
      if (r && !r.ok) toast(`${who(r.responsible_id)} s’en occupe déjà.`);
      else if (r?.ok) toast(`C’est noté, tu ${s.couple.child_pronoun} récupères.`);
    },
    requestRelay: (p: Pickup) =>
      run(() => supabase().rpc("request_relay", { p_pickup: p.id }), "Demande de relais envoyée"),
    respond: (id: string, accept: boolean) =>
      run(() => supabase().rpc("respond_relay", { p_request: id, p_accept: accept }), accept ? "Relais accepté" : "Relais refusé"),
    noCreche: (p: Pickup) =>
      run(
        () => supabase().rpc("save_pickups", { p_entries: [{ day: p.day, none: true }] }),
        `Pas de crèche ${relativeDay(p.day, todayIn(s.couple.timezone)).toLowerCase()}`,
      ),
    cancel: (id: string) => run(() => supabase().rpc("cancel_relay", { p_request: id }), "Demande annulée"),
  };
}

/** Phrase principale : « 17 h 30 · Tu récupères Juliette ». */
export function pickupSentence(p: Pickup, me: string, name: (id: string) => string, child: string) {
  if (!p.responsible_id) return `Qui récupère ${child} ?`;
  if (p.responsible_id === me) return `Tu récupères ${child}`;
  return `${name(p.responsible_id)} récupère ${child}`;
}

type Who = "me" | "partner" | "undecided";

/** Modifier une récupération précise : heure, qui, ou pas de crèche ce jour-là. */
function PickupEditSheet({ pickup, onClose }: { pickup: Pickup; onClose: () => void }) {
  const { s, partner, run, today } = useReady();
  const a = usePickupActions();
  const [time, setTime] = useState(pickup.time.slice(0, 5));
  const [whoSel, setWho] = useState<Who>(
    !pickup.responsible_id ? "undecided" : pickup.responsible_id === s.me ? "me" : "partner",
  );
  const opts: { value: Who; label: string }[] = [
    { value: "me", label: "Moi" },
    ...(partner ? [{ value: "partner" as Who, label: partner.display_name }] : []),
    { value: "undecided", label: "À décider" },
  ];
  const save = async () => {
    const ok = await run(
      () => supabase().rpc("save_pickups", { p_entries: [{ day: pickup.day, time, who: whoSel }] }),
      "Récupération modifiée",
    );
    if (ok !== null) onClose();
  };
  return (
    <Sheet open onClose={onClose} title={`${s.couple.pickup_label} · ${relativeDay(pickup.day, today)}`}>
      <div className="space-y-4">
        <label className="block w-40">
          <Label>Heure</Label>
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <div>
          <Label>Qui {s.couple.child_pronoun} récupère ?</Label>
          <Segmented name="Qui récupère" value={whoSel} onChange={setWho} options={opts} />
        </div>
        <Button className="w-full" disabled={!time} onClick={() => void save()}>
          Enregistrer
        </Button>
        <Button
          kind="secondary"
          className="w-full"
          onClick={() => void a.noCreche(pickup).then((ok) => ok !== null && onClose())}
        >
          Pas de crèche ce jour-là
        </Button>
        <p className="text-sm text-slate-500">
          Pour changer l’heure habituelle de tous les jours : Planning › Organiser la semaine › Heure par défaut.
        </p>
      </div>
    </Sheet>
  );
}

export function PickupCard({ pickup, compact = false }: { pickup: Pickup; compact?: boolean }) {
  const { s, who, today, partner } = useReady();
  const [editing, setEditing] = useState(false);
  const a = usePickupActions();
  const relay = pendingRelayFor(s, pickup.id);
  const child = s.couple.child_name;
  const unassigned = !pickup.responsible_id;
  const color = s.profiles.find((p) => p.id === pickup.responsible_id)?.color ?? ORANGE;
  const sentence = pickupSentence(pickup, s.me, who, child);
  return (
    <div
      data-testid="pickup-card"
      style={{ borderColor: color }}
      className={`rounded-3xl border-[3px] bg-white shadow-sm ${compact ? "p-3" : "p-5"} ${unassigned ? "bg-orange-50" : ""}`}
    >
      <div className="flex items-center justify-between gap-2 text-sm font-semibold text-slate-500">
        <span>
          {s.couple.pickup_label} · {relativeDay(pickup.day, today)}
        </span>
        {pickup.day >= today && (
          <button onClick={() => setEditing(true)} className="font-semibold text-slate-600 underline">
            Modifier
          </button>
        )}
      </div>
      {editing && <PickupEditSheet pickup={pickup} onClose={() => setEditing(false)} />}
      <div className="mt-2 flex items-center gap-3">
        <Avatar id={pickup.responsible_id} size={compact ? 36 : 48} />
        <div className={`${compact ? "text-lg" : "text-2xl"} font-extrabold leading-tight`}>
          {formatTime(pickup.time)} · {sentence}
        </div>
      </div>
      {unassigned && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="rounded-full bg-orange-100 px-3 py-1 text-sm font-bold text-orange-800">À décider</span>
          <div className="flex items-center gap-2">
            <Button kind="ghost" onClick={() => void a.noCreche(pickup)}>
              Pas de crèche
            </Button>
            <Button kind="orange" onClick={() => void a.claim(pickup)}>
              Je {s.couple.child_pronoun} récupère
            </Button>
          </div>
        </div>
      )}
      {relay && relay.from_user === s.me && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-slate-50 p-3 text-sm">
          <span>
            Relais demandé à <b>{who(relay.to_user)}</b>, en attente
          </span>
          <Button kind="secondary" onClick={() => void a.cancel(relay.id)}>
            Annuler
          </Button>
        </div>
      )}
      {relay && relay.to_user === s.me && (
        <div className="mt-3 rounded-2xl bg-amber-50 p-3">
          <div className="text-[15px] font-semibold">
            {who(relay.from_user)} te demande de {s.couple.child_pronoun} récupérer
          </div>
          <div className="mt-2 flex gap-2">
            <Button className="flex-1" onClick={() => void a.respond(relay.id, true)}>
              Accepter
            </Button>
            <Button kind="secondary" className="flex-1" onClick={() => void a.respond(relay.id, false)}>
              Refuser
            </Button>
          </div>
        </div>
      )}
      {!relay && pickup.responsible_id === s.me && partner && pickup.day >= today && (
        <div className="mt-3">
          <Button kind="ghost" className="px-0 underline" onClick={() => void a.requestRelay(pickup)}>
            Demander un relais à {partner.display_name}
          </Button>
        </div>
      )}
    </div>
  );
}
