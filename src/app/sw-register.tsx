"use client";
import { useEffect } from "react";
import { BASE } from "@/lib/base";

export function SwRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register(`${BASE}/sw.js`).catch(() => {});
    }
  }, []);
  return null;
}
