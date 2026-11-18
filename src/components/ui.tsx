"use client";
import { useEffect, useState } from "react";

/** Valeur locale immédiate, resynchronisée quand la donnée serveur change. */
export function useOptimistic<T>(server: T): [T, (v: T) => void] {
  const [local, setLocal] = useState(server);
  const [prev, setPrev] = useState(server);
  if (prev !== server) {
    setPrev(server);
    setLocal(server);
  }
  return [local, setLocal];
}
import { useApp } from "@/lib/store";
import type { UUID } from "@/lib/types";

export const ORANGE = "#ea580c";
/** Couleurs « pour qui » : juste moi (violet), chaque personne (sa couleur), nous deux (orange). */
export const PRIVATE_VIOLET = "#7c3aed";
export const BOTH_COLOR = ORANGE;

export function useAudienceColor() {
  const { s } = useApp();
  return (o: { isPrivate?: boolean; people: (UUID | null | undefined)[] }) => {
    if (o.isPrivate) return PRIVATE_VIOLET;
    const ids = [...new Set(o.people.filter(Boolean))] as UUID[];
    if (ids.length === 1) return s?.profiles.find((p) => p.id === ids[0])?.color ?? BOTH_COLOR;
    return BOTH_COLOR;
  };
}

/** Fond teinté + liseré gauche de la couleur « pour qui ». */
export function audienceStyle(color: string): React.CSSProperties {
  return {
    borderLeft: `6px solid ${color}`,
    background: `color-mix(in srgb, ${color} 9%, var(--color-white))`,
  };
}

/** Petite légende des couleurs. */
export function AudienceLegend() {
  const { s, partner } = useApp();
  const me = s?.profiles.find((p) => p.id === s.me);
  const items = [
    { label: "Privé 🔒", color: PRIVATE_VIOLET },
    { label: "Toi", color: me?.color ?? "#4f46e5" },
    ...(partner ? [{ label: partner.display_name, color: partner.color }] : []),
    { label: "À deux", color: BOTH_COLOR },
  ];
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 px-1 text-xs text-slate-500" aria-label="Légende des couleurs">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function initials(name: string): string {
  return name
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

/** Pastille couleur + initiales. Sans responsable : repère orange « ? ». */
export function Avatar({ id, size = 36 }: { id: UUID | null | undefined; size?: number }) {
  const { profile } = useApp();
  const p = profile(id);
  const style = { width: size, height: size, fontSize: size * 0.4 };
  if (!p) {
    return (
      <span
        aria-hidden
        style={{ ...style, borderColor: ORANGE, color: ORANGE }}
        className="inline-flex shrink-0 items-center justify-center rounded-full border-2 border-dashed font-bold"
      >
        ?
      </span>
    );
  }
  return (
    <span
      aria-hidden
      style={{ ...style, background: p.color }}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
    >
      {initials(p.display_name)}
    </span>
  );
}

/** Personne toujours nommée en toutes lettres en plus de la couleur. */
export function Person({ id, empty = "À décider" }: { id: UUID | null | undefined; empty?: string }) {
  const { who } = useApp();
  return (
    <span className="inline-flex items-center gap-1.5">
      <Avatar id={id} size={24} />
      {id ? (
        <span className="font-semibold">{who(id)}</span>
      ) : (
        <span className="font-semibold text-orange-700">{empty}</span>
      )}
    </span>
  );
}

export function Card({
  children,
  className = "",
  accent,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  accent?: string;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      style={accent ? { borderLeftColor: accent } : undefined}
      className={`block w-full rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 ${
        accent ? "border-l-[6px]" : ""
      } ${onClick ? "active:bg-slate-50" : ""} ${className}`}
    >
      {children}
    </Tag>
  );
}

export function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">{title}</h2>
        {action}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

type BtnKind = "primary" | "secondary" | "ghost" | "danger" | "orange";
const BTN: Record<BtnKind, string> = {
  primary: "bg-slate-900 text-white active:bg-slate-700",
  secondary: "bg-slate-100 text-slate-900 active:bg-slate-200",
  ghost: "text-slate-600 active:bg-slate-100",
  danger: "bg-red-50 text-red-700 active:bg-red-100",
  orange: "bg-orange-600 text-white active:bg-orange-700",
};

export function Button({
  kind = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: BtnKind }) {
  return (
    <button
      type="button"
      {...props}
      className={`min-h-11 rounded-xl px-4 py-2 text-[15px] font-semibold disabled:opacity-50 ${BTN[kind]} ${className}`}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={2}
      maxLength={500}
      {...props}
      className={`w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base outline-none focus:border-slate-900 ${
        props.className ?? ""
      }`}
    />
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }) {
  return (
    <input
      {...props}
      className={`min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-slate-900 ${
        props.className ?? ""
      }`}
    />
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-sm font-semibold text-slate-600">{children}</span>;
}

/** Feuille modale qui monte depuis le bas de l'écran. */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Fermer" className="h-10 w-10 rounded-full text-2xl text-slate-500">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Choix segmenté (Toi / Prénom / À décider, etc.). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  name,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; color?: string }[];
  name: string;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="flex gap-1 rounded-xl bg-slate-100 p-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            style={active && o.color ? { background: o.color, color: "white" } : undefined}
            className={`min-h-10 flex-1 rounded-lg px-2 text-sm font-semibold ${
              active ? (o.color ? "" : "bg-white shadow-sm") : "text-slate-600"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">{children}</p>;
}

export function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "orange" | "green" | "violet" }) {
  const t = {
    slate: "bg-slate-100 text-slate-700",
    orange: "bg-orange-100 text-orange-800",
    green: "bg-emerald-100 text-emerald-800",
    violet: "bg-violet-100 text-violet-800",
  }[tone];
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${t}`}>{children}</span>;
}
