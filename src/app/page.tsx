import { redirect } from "next/navigation";

// Chaque ouverture de l'application affiche « Aujourd'hui ».
export default function Home() {
  redirect("/planning");
}
