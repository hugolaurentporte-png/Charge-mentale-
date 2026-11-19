"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { errorMessage, supabase } from "@/lib/supabase";
import { Button, Input, Label, Segmented } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("suite") || "/planning";
  const [mode, setMode] = useState<"in" | "up">(next.startsWith("/invitation") ? "up" : "in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const auth = supabase().auth;
    const res =
      mode === "in"
        ? await auth.signInWithPassword({ email, password })
        : await auth.signUp({
            email,
            password,
            options: { emailRedirectTo: `${window.location.origin}${next}` },
          });
    setBusy(false);
    if (res.error) return setMsg(errorMessage(res.error));
    if (!res.data.session) return setMsg("Compte créé. Confirme ton adresse depuis l’e-mail reçu, puis connecte-toi.");
    router.replace(next);
  };

  return (
    <main className="mx-auto max-w-md p-5 pt-14">
      <h1 className="text-3xl font-extrabold">À deux</h1>
      <p className="mt-1 text-slate-600">Le quotidien partagé, sans se le rappeler sans cesse.</p>
      <form onSubmit={submit} className="mt-8 space-y-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <Segmented
          name="Mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: "in", label: "Se connecter" },
            { value: "up", label: "Créer un compte" },
          ]}
        />
        <label className="block">
          <Label>E-mail</Label>
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block">
          <Label>Mot de passe</Label>
          <Input
            type="password"
            autoComplete={mode === "in" ? "current-password" : "new-password"}
            minLength={6}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {msg && <p className="text-sm font-semibold text-red-700">{msg}</p>}
        <Button type="submit" className="w-full" disabled={busy}>
          {mode === "in" ? "Se connecter" : "Créer mon compte"}
        </Button>
      </form>
    </main>
  );
}

export default function Page() {
  return (
    <div className="min-h-dvh bg-slate-100">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
