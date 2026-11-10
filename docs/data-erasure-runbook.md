# Data erasure and 12-month review (Super Admin runbook)

`/privacy-policy` and `/data-deletion` promise two things:

- Deletion requests are handled by hand by the Super Admin.
- Enquiries are kept for 12 months after the last meaningful interaction, then
  reviewed by hand.

This runbook is how both are done. There is no erasure screen in the admin yet,
and there is no automatic timer.

Only the person who holds the Super Admin role and Cloudflare access runs
this. Nothing here runs by itself.

## What erasure changes

`npm run -s erasure:sql -- <contact code> --by <your email>` prints SQL. It
never connects to a database. The SQL (see `lib/crm/erasure.ts`) works on the
contact and any contacts merged into it.

| Record | Change |
| --- | --- |
| Contact | Name becomes `Erased contact`. Phone becomes a placeholder (`erased:<id>`). Alternate phone, WhatsApp, email, language and notes are cleared. The contact is marked **Do not contact**. |
| Owner leads | Notes and location text are cleared. Open leads (New, Contacted, Details pending) become `Not interested`, with the reason "Personal data erased on request". |
| Requirements | Notes are cleared. Open requirements become `Lost`, with the same reason. |
| Lead source | Form answers (`raw_payload_json`) are cleared. Form, ad and campaign ids and the Meta lead id are kept, so the same form is not imported again. |
| Calls and notes | Text is cleared. |
| Follow-ups | Reason and outcome note are cleared. Open follow-ups are cancelled. |
| Meta import queue | Working copy of answers, last error and step messages are cleared. This includes held leads whose answers contain the person's 10-digit number. |
| Audit history | **Unchanged.** It is append-only by database trigger. One new `erase` entry records who erased the contact and when. |

What is **not** removed:

- The audit history, which can show the name and number as first recorded.
  Only super admins and inventory managers can view it. The policy says this.
- Properties owned by the contact. Archive or edit them yourself if the owner
  asks. The property keeps its link to the anonymised contact.
- Meta's copy. The person manages that in Facebook or Instagram.
- WhatsApp chats, phone call logs and emails. Delete those in those apps.

## Handling a deletion request

1. **Confirm the request.** Contact the mobile number the request is about, and
   check it is that person. Note the date of the request.
2. **Find the contact.** In the admin, open Contacts and search by number. Note
   the contact code, for example `GH-C0042`. Check for a second contact under
   another number, and repeat for each.
3. **Check what they own.** Open the contact page. If it lists a property, agree
   with the person whether to archive the listing first.
4. **Take a restore point:**

   ```bash
   npx wrangler d1 time-travel info gulbargahomes
   ```

   Keep the bookmark with the request.
5. **Generate and read the SQL:**

   ```bash
   npm run -s erasure:sql -- GH-C0042 --by you@gulbargahomes.com > erase-GH-C0042.sql
   ```

   Do not edit it. It must contain nine statements, and every `WHERE` must name
   `GH-C0042`.
6. **Run it:**

   ```bash
   npx wrangler d1 execute gulbargahomes --remote --file erase-GH-C0042.sql
   ```

   Expect "9 commands executed successfully".
7. **Check the result.** The contact page should show `Erased contact`, phone
   `Erased`, and "Do not contact: Personal data erased on request". Search the
   old number in Contacts and expect no result.
8. **Delete the local SQL file,** and remove the person from WhatsApp, phone and
   email where asked.
9. **Reply to the person.** Say what was removed and what was kept, using the
   "What a deletion does not remove" list on `/data-deletion`.

If a step fails, restore with
`npx wrangler d1 time-travel restore gulbargahomes --bookmark=<bookmark>`.
This also discards anything written after the bookmark, so do it straight
away.

## The 12-month review

Do this at least once a month.

1. List the contacts due for review:

   ```bash
   npm run -s erasure:sql -- --review > review.sql
   npx wrangler d1 execute gulbargahomes --remote --file review.sql
   ```

   The list shows contacts whose latest activity is more than 12 months old.
   Activity means any change to the contact or its owner leads and
   requirements, or any call, note or follow-up. Contacts are left off the list
   if they own a property that is not archived, or are already erased.
2. Leave a contact out if the person asked you to keep their details, or a law
   requires you to keep them. Note the reason on the contact.
3. Erase each remaining contact with steps 4 to 8 above. No reply to the person
   is needed.

## Testing

`tests/erasure.test.ts` runs the generated SQL against the full schema. It
checks that the name, number and free text are gone from every table except
`audit_log`, and that other contacts are untouched. The SQL was also run
against a local D1 database with `wrangler d1 execute --local`.
