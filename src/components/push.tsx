"use client";
import { useEffect, useState } from "react";
import { disablePush, enablePush, pushState, type PushState } from "@/lib/push";
import { useReady } from "@/lib/store";
import { Button } from "./ui";

const card = "rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200";

export function usePushState() {
  const [state, setState] = useState<PushState | null>(null);
  useEffect(() => {
    void pushState().then(setState);
  }, []);
  return [state, setState] as const;
}

function useToggle(setState: (s: PushState) => void) {
  const { toast } = useReady();
  const [busy, setBusy] = useState(false);
  const act = async (on: boolean) => {
    setBusy(true);
    try {
      const s = on ? await enablePush() : await disablePush();
      setState(s);
      if (s === "on") toast("Notifications activées");
      if (s === "denied") toast("Notifications refusées dans les réglages du téléphone");
    } catch (e) {
      toast((e as Error).message || "Impossible d’activer les notifications");
    } finally {
      setBusy(false);
    }
  };
  return { busy, act };
}

export function PushSettings() {
  const [state, setState] = usePushState();
  const { busy, act } = useToggle(setState);
  if (state === null) return null;
  return (
    <div className={`${card} space-y-3 text-sm`}>
      <p className="text-slate-600">
        Sois prévenu·e sur ce téléphone quand ton ou ta partenaire ajoute une tâche, un rendez-vous, un sujet, un article
        dans une liste partagée, ou te demande un relais. Rien de ce qui est dans « Pour moi » n’est envoyé.
      </p>
      {state === "needs-install" && (
        <p className="font-semibold">
          Sur iPhone, ajoute d’abord l’app à l’écran d’accueil (Safari : Partager › Sur l’écran d’accueil), puis ouvre-la
          depuis l’icône et reviens ici.
        </p>
      )}
      {state === "unsupported" && <p className="font-semibold">Ce navigateur ne gère pas les notifications.</p>}
      {state === "denied" && (
        <p className="font-semibold">
          Les notifications sont bloquées. Autorise-les dans les réglages du téléphone (Notifications › À deux).
        </p>
      )}
      {state === "off" && (
        <Button className="w-full" disabled={busy} onClick={() => void act(true)}>
          Activer les notifications
        </Button>
      )}
      {state === "on" && (
        <>
          <p className="font-semibold text-emerald-700">Notifications activées sur ce téléphone.</p>
          <Button kind="secondary" className="w-full" disabled={busy} onClick={() => void act(false)}>
            Désactiver sur ce téléphone
          </Button>
        </>
      )}
    </div>
  );
}

/** Rappel discret sur l'accueil tant que les notifications ne sont pas activées. */
export function PushNudge() {
  const [state, setState] = usePushState();
  const { busy, act } = useToggle(setState);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem("push-nudge-hidden") === "1";
    } catch {
      return false;
    }
  });
  if (hidden || state !== "off") return null;
  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem("push-nudge-hidden", "1");
    } catch {}
  };
  return (
    <div className={`${card} mt-4 flex items-center gap-3 text-sm`}>
      <span className="min-w-0 flex-1">Être prévenu·e quand l’autre ajoute quelque chose ?</span>
      <Button disabled={busy} onClick={() => void act(true)}>
        Activer
      </Button>
      <button onClick={hide} aria-label="Masquer" className="px-1 text-lg text-slate-400">
        ×
      </button>
    </div>
  );
}
