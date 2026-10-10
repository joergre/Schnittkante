import { createFileRoute } from "@tanstack/react-router";
import { Workbench } from "@/components/workbench";

export const Route = createFileRoute("/")({
  component: Home,
  head: () => ({
    meta: [
      { title: "Schnittkante — Bögen in Seiten zerlegen" },
      {
        name: "description",
        content: "Erkennt Seitenränder auf 4-auf-1-Scans und schneidet sie in Einzelseiten.",
      },
    ],
  }),
});

function Home() {
  return <Workbench />;
}
