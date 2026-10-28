import type { Metadata } from "next";

import { ProjectListPage } from "@/components/project-list-page";

export const metadata: Metadata = {
  title: "Ongoing projects",
  description:
    "In-progress construction and renovation sites in Gulbarga (Kalaburagi) — dated updates and site photos.",
};

export default function OngoingProjectsPage() {
  return (
    <ProjectListPage
      title="Ongoing projects"
      intro="Current construction stage, dated updates and recent site photographs from active GulbargaHomes projects."
      status="ongoing"
    />
  );
}
