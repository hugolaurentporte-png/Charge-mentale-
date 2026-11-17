"use client";
import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { errorMessage, supabase } from "@/lib/supabase";
import { Button, Input, Label } from "@/components/ui";

export default function InvitePage() {
  return (
    <Suspense>
      <InvitePageInner />
    </Suspense>
  );
}

function InvitePageInner() {
  const token = useSearchParams().get("t") ?? "";
  const router = useRouter();
  const [preview, setPreview] = useState<{ inviter: string; valid: boolean } | null | undefined>(undefined);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const db = supabase();
    void db.auth.getUser().then(async ({ data }) => {
      setSignedIn(Boolean(data.user));
      if (!data.user) return;
      // Déjà dans un espace (lien rouvert après l'avoir accepté) : direction l'accueil.
      const { data: m } = await db.from("couple_members").select("couple_id").eq("user_id", data.user.id).maybeSingle();
      if (m) router.replace("/planning");
    });
    void db.rpc("invite_preview", { p_token: token }).then(({ data }) => setPreview(data ?? null));
  }, [token, router]);

  const accept = async () => {
    const { error } = await supabase().rpc("accept_invite", { p_token: token, p_display_name: name.trim() });
    if (error) setErr(errorMessage(error));
    else router.replace("/planning");
  };

  return (
    <main className="mx-auto min-h-dvh max-w-md p-5 pt-14">
      <h1 className="text-3xl font-extrabold">Invitation</h1>
      {preview === undefined && <p className="mt-6 text-slate-500">Chargement…</p>}
      {preview === null && <p className="mt-6 font-semibold text-red-700">Ce lien d’invitation est introuvable.</p>}
      {preview && !preview.valid && (
        <p className="mt-6 font-semibold text-red-700">Ce lien a déjà été utilisé ou a expiré.{" "}
          <Link href="/connexion" className="underline">
            Déjà inscrit·e ? Se connecter
          </Link>
          , sinon demande un nouveau lien.
        </p>
      )}
      {preview?.valid && (
        <div className="mt-6 space-y-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <p className="text-lg">
            <b>{preview.inviter}</b> t’invite à partager son espace.
          </p>
          {signedIn === false && (
            <Link
              href={`/connexion?suite=${encodeURIComponent(`/invitation?t=${token}`)}`}
              className="block rounded-xl bg-slate-900 py-3 text-center font-semibold text-white"
            >
              Créer mon compte ou me connecter
            </Link>
          )}
          {signedIn && (
            <>
              <label className="block">
                <Label>Ton prénom</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Camille" />
              </label>
              <Button className="w-full" disabled={!name.trim()} onClick={() => void accept()}>
                Rejoindre l’espace
              </Button>
            </>
          )}
          {err && <p className="text-sm font-semibold text-red-700">{err}</p>}
        </div>
      )}
    </main>
  );
}
