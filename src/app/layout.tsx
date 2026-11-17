import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SwRegister } from "./sw-register";
import { BASE } from "@/lib/base";

export const metadata: Metadata = {
  title: "À deux",
  description: "Organiser le quotidien à deux et répartir la charge mentale.",
  manifest: `${BASE}/manifest.webmanifest`,
  appleWebApp: { capable: true, title: "À deux", statusBarStyle: "default" },
  icons: { icon: `${BASE}/icons/icon-192.png`, apple: `${BASE}/icons/apple-touch-icon.png` },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1f5f9" },
    { media: "(prefers-color-scheme: dark)", color: "#020617" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        {/* Thème choisi dans Réglages, appliqué avant l'affichage pour éviter un flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`,
          }}
        />
      </head>
      <body className="bg-slate-100 text-slate-900 antialiased">
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
