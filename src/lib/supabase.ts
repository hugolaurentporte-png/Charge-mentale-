"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY doivent être définies (voir .env.example).",
      );
    }
    client = createBrowserClient(url, key);
  }
  return client;
}

/** Message d'erreur lisible à partir d'une erreur Supabase / Postgres. */
export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    const m = String((e as { message: unknown }).message);
    if (m.includes("row-level security")) return "Action non autorisée.";
    if (m.includes("Invalid login credentials")) return "E-mail ou mot de passe incorrect.";
    if (m.includes("User already registered")) return "Un compte existe déjà avec cet e-mail.";
    return m;
  }
  return "Une erreur est survenue.";
}
