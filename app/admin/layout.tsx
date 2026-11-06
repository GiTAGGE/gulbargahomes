export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="fixed inset-0 z-[80] overflow-auto bg-surface">{children}</div>;
}
