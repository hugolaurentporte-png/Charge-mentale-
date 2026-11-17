import type { NextConfig } from "next";

// STATIC_EXPORT=1 produit un site statique (dossier out/) pour GitHub Pages ;
// NEXT_PUBLIC_BASE_PATH donne le sous-dossier (ex. /Charge-mentale-).
const isExport = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  ...(isExport ? { output: "export", trailingSlash: true, images: { unoptimized: true } } : {}),
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
};

export default nextConfig;
