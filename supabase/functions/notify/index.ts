// Envoie une notification Web Push aux abonnements des destinataires.
// Appelée uniquement par le trigger Postgres (en-tête x-notify-secret).
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

type Payload = { user_ids: string[]; title: string; body: string; url?: string };

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Méthode non autorisée", { status: 405 });
  const { data: cfg, error } = await db.rpc("push_config");
  if (error || !cfg?.secret || !cfg?.private) return new Response("Configuration manquante", { status: 500 });
  if (req.headers.get("x-notify-secret") !== cfg.secret) return new Response("Interdit", { status: 401 });

  const p = (await req.json()) as Payload;
  if (!Array.isArray(p.user_ids) || !p.user_ids.length) return Response.json({ sent: 0 });
  webpush.setVapidDetails(cfg.subject, cfg.public, cfg.private);

  const { data: subs } = await db.from("push_subscriptions").select("endpoint, p256dh, auth").in("user_id", p.user_ids);
  const message = JSON.stringify({ title: p.title, body: p.body, url: p.url ?? "/planning/" });
  let sent = 0;
  const failed: string[] = [];
  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, message, {
          TTL: 3600,
          urgency: "high",
        });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        // Abonnement expiré ou révoqué : on l'oublie.
        if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        failed.push(`${code ?? "?"} ${(e as Error).message}`.slice(0, 200));
      }
    }),
  );
  return Response.json({ sent, failed });
});
