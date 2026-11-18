"use client";
import { useEffect, useRef, useState } from "react";

type Rec = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function getRecognition(): (new () => Rec) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** iPhone / iPad : la dictée web y est peu fiable, on passe par celle du clavier. */
function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** Bouton micro : dicte une phrase en français et la renvoie. */
export function VoiceButton({ onText }: { onText: (text: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [ios, setIos] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Rec | null>(null);
  useEffect(() => {
    setIos(isIOS());
    setSupported(isIOS() || getRecognition() !== null);
  }, []);
  if (!supported) return null;
  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (ios) {
      // Ouvre le clavier sur le champ voisin : le micro du clavier fait la dictée.
      const field = e.currentTarget.closest("div")?.parentElement?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
      field?.focus();
      setError("Touche le micro 🎤 du clavier pour dicter.");
      setTimeout(() => setError(null), 4000);
      return;
    }
    if (listening) {
      rec.current?.stop();
      return;
    }
    const R = getRecognition();
    if (!R) return;
    const r = new R();
    r.lang = "fr-FR";
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      const t = Array.from(e.results).map((x) => x[0].transcript).join(" ").trim();
      if (t) onText(t);
    };
    r.onerror = (e) =>
      setError(
        e.error === "not-allowed"
          ? "Micro refusé : autorise-le dans les réglages."
          : e.error === "no-speech"
            ? "Je n’ai rien entendu, réessaie."
            : "Je n’ai pas compris, réessaie.",
      );
    r.onend = () => setListening(false);
    rec.current = r;
    setError(null);
    setListening(true);
    r.start();
  };
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={toggle}
        aria-label={listening ? "Arrêter la dictée" : "Dicter"}
        className={`flex h-11 w-11 items-center justify-center rounded-xl ${
          listening ? "animate-pulse bg-red-600 text-white" : "bg-slate-100 text-slate-700"
        }`}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
        </svg>
      </button>
      {error && (
        <p
          role="status"
          className={`absolute right-0 top-12 z-10 w-52 rounded-lg px-2 py-1 text-xs shadow ${
            ios ? "bg-slate-900 text-white" : "bg-red-50 text-red-700"
          }`}
        >
          {error}
        </p>
      )}
    </div>
  );
}
