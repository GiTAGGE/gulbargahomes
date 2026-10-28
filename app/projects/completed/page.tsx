import type { Metadata } from "next";

import { ProjectListPage } from "@/components/project-list-page";

export const metadata: Metadata = {
  title: "Completed projects",
  description:
    "Completed home construction, interiors and renovation work by GulbargaHomes across Kalaburagi.",
};

export default function CompletedProjectsPage() {
  return (
    <ProjectListPage
      title="Completed projects"
      intro="Finished homes, interiors and renovations — real GulbargaHomes project photographs and handover details."
      status="completed"
    />
  );
}
