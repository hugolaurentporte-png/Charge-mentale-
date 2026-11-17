"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useReady } from "@/lib/store";
import { Button, Input, Label, Section, Segmented } from "@/components/ui";

export default function ReglagesPage() {
  const { s, run, partner, toast } = useReady();
  const router = useRouter();
  const me = s.profiles.find((p) => p.id === s.me);
  const [name, setName] = useState(me?.display_name ?? "");
  const [child, setChild] = useState(s.couple.child_name);
  const [pronoun, setPronoun] = useState(s.couple.child_pronoun);
  const [label, setLabel] = useState(s.couple.pickup_label);
  const [link, setLink] = useState<string | null>(null);

  const save = async () => {
    await run(() => supabase().from("profiles").update({ display_name: name.trim() }).eq("id", s.me));
    await run(
      () =>
        supabase()
          .from("couples")
          .update({ child_name: child.trim(), child_pronoun: pronoun, pickup_label: label.trim() })
          .eq("id", s.couple.id),
      "Réglages enregistrés",
    );
  };
  const invite = async () => {
    const token = (await run(() => supabase().rpc("create_invite"))) as string | null;
    if (token) setLink(`${window.location.origin}/invitation/${token}`);
  };
  const share = async () => {
    if (!link) return;
    if (navigator.share) {
      await navigator.share({ title: "Rejoins notre espace", url: link }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(link);
      toast("Lien copié");
    }
  };
  return (
    <div className="pt-4">
      <button onClick={() => router.push("/planning")} className="text-sm font-semibold text-slate-500">
        ‹ Planning
      </button>
      <h1 className="mt-1 text-[28px] font-extrabold">Réglages</h1>

      <Section title="Partenaire">
        {partner ? (
          <p className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            Espace partagé avec <b>{partner.display_name}</b>.
          </p>
        ) : (
          <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <p>Invite ton ou ta partenaire avec un lien à usage unique (valable 7 jours).</p>
            {link ? (
              <>
                <Input readOnly value={link} aria-label="Lien d’invitation" onFocus={(e) => e.target.select()} />
                <Button className="w-full" onClick={() => void share()}>
                  Partager le lien
                </Button>
              </>
            ) : (
              <Button className="w-full" onClick={() => void invite()}>
                Créer un lien d’invitation
              </Button>
            )}
          </div>
        )}
      </Section>

      <Section title="Profil et enfant">
        <div className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <label className="block">
            <Label>Ton prénom</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <Label>Prénom de l’enfant</Label>
            <Input value={child} onChange={(e) => setChild(e.target.value)} />
          </label>
          <div>
            <Label>Bouton</Label>
            <Segmented
              name="Pronom"
              value={pronoun}
              onChange={setPronoun}
              options={[
                { value: "la", label: "Je la récupère" },
                { value: "le", label: "Je le récupère" },
              ]}
            />
          </div>
          <label className="block">
            <Label>Libellé des récupérations</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <Button className="w-full" onClick={() => void save()}>
            Enregistrer
          </Button>
        </div>
      </Section>

      <Section title="Notifications">
        <p className="rounded-2xl bg-white p-4 text-sm text-slate-600 shadow-sm ring-1 ring-slate-200">
          Pour l’instant, les rappels et demandes de relais s’affichent dans l’application. Les notifications push arriveront dans une prochaine version.
        </p>
      </Section>

      <Button
        kind="ghost"
        className="mt-8 w-full"
        onClick={() => void supabase().auth.signOut().then(() => router.replace("/connexion"))}
      >
        Se déconnecter
      </Button>
    </div>
  );
}
