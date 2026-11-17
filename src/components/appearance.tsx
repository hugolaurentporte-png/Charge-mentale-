"use client";
import { useEffect, useState } from "react";
import { Segmented } from "./ui";

type Theme = "auto" | "light" | "dark";

/** Apparence : automatique (suit le téléphone), clair ou sombre. Mémorisé sur cet appareil. */
export function AppearanceSettings() {
  const [theme, setTheme] = useState<Theme>("auto");
  useEffect(() => {
    try {
      const t = localStorage.getItem("theme");
      if (t === "light" || t === "dark") setTheme(t);
    } catch {}
  }, []);
  const choose = (t: Theme) => {
    setTheme(t);
    try {
      if (t === "auto") localStorage.removeItem("theme");
      else localStorage.setItem("theme", t);
    } catch {}
    if (t === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  };
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <Segmented
        name="Apparence"
        value={theme}
        onChange={choose}
        options={[
          { value: "auto", label: "Automatique" },
          { value: "light", label: "Clair" },
          { value: "dark", label: "Sombre" },
        ]}
      />
    </div>
  );
}
