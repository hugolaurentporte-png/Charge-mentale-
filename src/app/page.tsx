"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Chaque ouverture de l'application affiche « Aujourd'hui ».
export default function Home() {
  const router = useRouter();
  useEffect(() => router.replace("/planning"), [router]);
  return null;
}
