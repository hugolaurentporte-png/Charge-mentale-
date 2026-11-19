// Flux iCalendar personnel (agenda Apple, Google Agenda…) : ?t=<lien secret>.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (!/^[a-f0-9]{64}$/.test(token)) return new Response("Lien invalide", { status: 404 });
  const { data, error } = await db.rpc("agenda_ics", { p_token: token });
  if (error) return new Response("Erreur", { status: 500 });
  if (!data) return new Response("Lien invalide", { status: 404 });
  return new Response(data as string, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="a-deux.ics"',
      "cache-control": "no-cache",
    },
  });
});
