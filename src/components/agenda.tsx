"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useReady } from "@/lib/store";
import { Button, Input } from "./ui";

const card = "rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200";

/** Lien d'abonnement iCal personnel : agenda Apple, Google Agenda, Outlook… */
export function AgendaSettings() {
  const { run, toast } = useReady();
  const [token, setToken] = useState<string | null>(null);
  const load = async (reset = false) => {
    const t = (await run(() => supabase().rpc("my_calendar_token", { p_reset: reset }))) as string | null;
    if (t) setToken(t);
    if (t && reset) toast("Nouveau lien créé : l’ancien ne marche plus");
  };
  const host = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/^https?:\/\//, "");
  const https = token ? `https://${host}/functions/v1/agenda?t=${token}` : "";
  const webcal = https.replace(/^https:/, "webcal:");
  const google = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
  return (
    <div className={`${card} space-y-3 text-sm`}>
      <p className="text-slate-600">
        Retrouve dans ton agenda les rendez-vous, tes récupérations à la crèche et tes tâches avec une heure. L’agenda se
        met à jour tout seul (environ toutes les heures). Ce lien est personnel : ne le partage pas.
      </p>
      {!token ? (
        <Button className="w-full" onClick={() => void load()}>
          Ajouter à mon agenda
        </Button>
      ) : (
        <>
          <a href={webcal} className="block rounded-xl bg-slate-900 py-3 text-center font-semibold text-white">
            Agenda Apple (iPhone, Mac)
          </a>
          <a
            href={google}
            target="_blank"
            rel="noreferrer"
            className="block rounded-xl bg-slate-100 py-3 text-center font-semibold text-slate-900"
          >
            Google Agenda
          </a>
          <Input readOnly value={https} aria-label="Lien de l’agenda" onFocus={(e) => e.target.select()} />
          <div className="flex gap-2">
            <Button
              kind="secondary"
              className="flex-1"
              onClick={() => void navigator.clipboard.writeText(https).then(() => toast("Lien copié"))}
            >
              Copier le lien
            </Button>
            <Button kind="ghost" className="flex-1" onClick={() => void load(true)}>
              Changer de lien
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
