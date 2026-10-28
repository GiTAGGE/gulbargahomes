export type ProjectMetaFields = {
  locality: string;
  category: string;
};

export function projectMetaLine(project: ProjectMetaFields): string {
  const place =
    project.locality.toLowerCase().includes("kalaburagi") ||
    project.locality.toLowerCase().includes("gulbarga")
      ? project.locality
      : `${project.locality}, Kalaburagi`;
  return `${place} · ${project.category}`;
}

export type ProjectStatus = "planning" | "ongoing" | "completed" | "upcoming";

export function projectStatusBadgeClass(status: ProjectStatus): string {
  switch (status) {
    case "completed":
      return "bg-emerald-600 text-white";
    case "ongoing":
      return "bg-amber-500 text-ink";
    case "upcoming":
      return "bg-brand-600 text-white";
    default:
      return "bg-ink/80 text-white";
  }
}
