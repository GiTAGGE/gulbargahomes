import Link from "next/link";

import { AdminShell } from "@/components/admin/admin-shell";
import { Card, Empty, Pill } from "@/components/admin/ui";
import { relativeTime } from "@/lib/admin/format";
import { requirePageAdmin } from "@/lib/admin/page";
import { listContacts } from "@/lib/crm/contacts";
import { formatPhone, maskPhone } from "@/lib/crm/phone";

export const dynamic = "force-dynamic";

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { db, caps } = await requirePageAdmin("crm.view");
  const { q } = await searchParams;
  // Searching by number would reveal whether a number exists, so it needs phone access.
  const contacts = await listContacts(db, {
    q: q && !caps.viewPhone ? q.replace(/\d/g, "").trim() || undefined : q,
    limit: 300,
  });
  const now = new Date();

  return (
    <AdminShell eyebrow="People" title="Contacts">
      <form className="mb-4 flex max-w-md gap-2" action="/admin/contacts">
        <input
          name="q"
          defaultValue={q}
          placeholder={caps.viewPhone ? "Name, code or mobile number" : "Name or code"}
          className="w-full rounded-xl border border-brand-200 bg-white px-3 py-2 text-sm"
        />
        <button className="btn-ghost">Search</button>
      </form>
      <p className="mb-3 text-xs text-ink-muted">One person per mobile number, however many leads or properties they bring.</p>
      <Card>
        {contacts.length === 0 ? (
          <Empty>No contacts found.</Empty>
        ) : (
          <ul className="-my-2 divide-y divide-brand-50">
            {contacts.map((contact) => (
              <li key={contact.id}>
                <Link
                  href={`/admin/contacts/${contact.id}`}
                  className="-mx-2 flex flex-wrap items-center gap-3 rounded-xl px-2 py-3 hover:bg-brand-50/50"
                >
                  <span className="font-mono text-xs text-ink-faint">{contact.code}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink">{contact.name}</span>
                  {contact.isOwner && <Pill tone="green">Owner</Pill>}
                  {contact.isSeeker && <Pill tone="blue">Looking</Pill>}
                  {contact.doNotContact && <Pill tone="red">Do not contact</Pill>}
                  <span className="text-xs text-ink-muted">{caps.viewPhone ? formatPhone(contact.phone) : maskPhone(contact.phone)}</span>
                  <span className="text-xs text-ink-faint">{relativeTime(contact.updatedAt, now)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AdminShell>
  );
}
