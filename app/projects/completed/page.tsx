import type { Metadata } from "next";

import { ProjectListPage } from "@/components/project-list-page";

export const metadata: Metadata = {
  title: "Completed projects",
  description:
    "Example completed home construction and renovation portfolio layout for GulbargaHomes — Kalaburagi.",
};

export default function CompletedProjectsPage() {
  return (
    <ProjectListPage
      title="Completed projects"
      intro="Finished homes, interiors and renovations — with before-and-after photos when you upload verified work."
      status="completed"
    />
  );
}
