import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SwRegister } from "./sw-register";

export const metadata: Metadata = {
  title: "À deux",
  description: "Organiser le quotidien à deux et répartir la charge mentale.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "À deux", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body className="bg-slate-100 text-slate-900 antialiased">
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
