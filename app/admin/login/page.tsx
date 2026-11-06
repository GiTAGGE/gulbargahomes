import { LoginForm } from "@/components/admin/login-form";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const nextPath =
    params.next && params.next.startsWith("/admin") && !params.next.startsWith("//")
      ? params.next
      : "/admin/properties";

  return (
    <div className="grid min-h-full place-items-center px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-brand-100 bg-white p-6 shadow-lift sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-700">
          GulbargaHomes
        </p>
        <h1 className="mt-2 text-2xl font-bold text-ink">Listing desk</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Add and update houses, flats, plots and commercial listings for Gulbarga and Kalaburagi.
          Changes save to the property database — no git publish, no rebuild wait.
        </p>
        <LoginForm nextPath={nextPath} />
      </div>
    </div>
  );
}
