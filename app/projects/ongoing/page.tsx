import type { Metadata } from "next";

import { ProjectListPage } from "@/components/project-list-page";

export const metadata: Metadata = {
  title: "Ongoing projects",
  description:
    "Example in-progress construction updates for GulbargaHomes — Kalaburagi site progress.",
};

export default function OngoingProjectsPage() {
  return (
    <ProjectListPage
      title="Ongoing projects"
      intro="Current construction stage, dated updates and recent site photos — replace examples with live projects."
      status="ongoing"
    />
  );
}
