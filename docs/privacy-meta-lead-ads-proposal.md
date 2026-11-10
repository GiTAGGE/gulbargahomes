# Proposed privacy wording for Meta Lead Ads and the CRM

**Status: proposal for the business owner's approval.** Nothing here has been
applied to `/privacy-policy` or `/data-deletion`. This is not legal advice. Text in
`[brackets]` is a decision only the business can make. Once approved, it goes into
`app/privacy-policy/page.tsx` and `app/data-deletion/page.tsx` with a new "last
updated" date.

## Why the current pages must change before real leads arrive

The current pages say things that stop being true once Meta Lead Ads is connected,
and some that stopped being true with the Phase 1 CRM:

| Page / section | Current statement | Reality |
| --- | --- | --- |
| Privacy · scope, Meta, messages | Instant Forms are "collected by Meta, not by this website", "not imported into this website", "handled manually if we export them" | Submissions are imported automatically into the private CRM |
| Privacy · website | "There is no database of visitor enquiries on the website" | The CRM stores contacts, owner leads and requirements in Cloudflare D1 |
| Privacy · sharing | "These are not active on this website: a customer-relationship database … Meta's Conversions API" | A CRM is active. The Conversions API is still not used (true) |
| Privacy · retention | "no automatic deletion schedule, because it does not store those enquiries" | Enquiries are stored. Integration copies have a schedule (below); CRM records do not yet |
| Privacy · security | "The listing desk is limited to people with the desk password" | Named staff accounts with roles. The shared password still exists until `ADMIN_LEGACY_LOGIN=disabled` |
| Data deletion · what this covers | Instant Form answers "are not imported into this site automatically" | They are |

## Facts the wording relies on (verified in code)

- **What is imported:** every answer on the Instant Form (name, mobile, email if
  asked, and the property questions), plus the form, ad, ad set and campaign
  identifiers, the platform (Facebook or Instagram) and the time submitted.
  Campaign names are stored only if the optional `ads_read` permission is granted.
- **Where it is stored:** the GulbargaHomes CRM on Cloudflare (Workers and D1). It
  is not on the public website.
- **Who can see it:** signed-in GulbargaHomes staff with a named account.
  - Super admins, inventory managers and lead executives see full phone numbers
    (`contact.view_phone`).
  - Viewers see masked numbers.
  - Only super admins can connect or disconnect Meta.
- **What it is used for:** to call or message the person about the enquiry they
  made, to record follow-ups, and (Phase 2) to suggest matching properties to staff.
- **What is not done automatically:**
  - no property is created
  - no lead is marked qualified
  - nothing is published
  - nothing is sent to owners
- **Retention, as implemented:**
  - CRM records (contact, owner lead or requirement, and its source with the form
    answers) are kept until staff change or remove them. There is no automatic
    deletion of CRM records.
  - The integration queue drops its copy of answers when a lead is imported. It
    also drops it immediately when staff dismiss a lead. For leads that were
    ignored or failed, it drops the copy after 30 days.
  - The webhook delivery log (ids and counts, no answers) is deleted after 90 days.
  - Meta keeps its own copy. Meta lets the CRM read leads for 90 days after
    submission.
- **The audit history is append-only** and records who created or changed a
  contact, including the name and phone number at creation. The application has
  **no erasure tool** yet: staff cannot delete a contact, a lead or a requirement
  from the CRM screens, and audit entries cannot be deleted.

> **Decision needed before publishing deletion promises:** either build a
> staff-run erasure action (remove or anonymise the contact, its leads and
> requirements, the source answers and queue rows, and redact the phone number in
> audit entries), or word the policy so it does not promise deletion the system
> cannot perform. The proposal below assumes the erasure action is built first.
> If it is not, use the alternative sentence marked **(no erasure tool)**.

---

## Proposed changes to `/privacy-policy`

### Scope ("What this notice covers"), replace the Meta bullet

> Meta Instant Forms you submit in a GulbargaHomes advertisement on Facebook or
> Instagram. Meta collects the form and passes your answers to our private
> enquiry system, described below.

### "What the website does", replace the last two sentences of the first paragraph

> Visitors do not create an account. There is no public registration, login,
> checkout or payment. The public pages do not store what you type. Enquiries that
> reach us by Meta Instant Form, phone or WhatsApp can be recorded by our staff in a
> private enquiry system that is not part of the public website.

### "Meta ads and Instant Forms", replace the second and third paragraphs

> We advertise on Facebook and Instagram, including ads that use a Meta Instant
> Form for property owners, tenants and buyers in Gulbarga (Kalaburagi). When you
> submit one of those forms, Meta sends your answers to GulbargaHomes. Our system
> receives them automatically and records them in our private enquiry system
> (CRM). This includes:
>
> - your name and mobile number, and your email if the form asks for it
> - the answers you gave about the property, your budget, the area and your timing
> - which form, advertisement and campaign the answers came from
> - whether you used Facebook or Instagram, and when you submitted
>
> We use these details to call or message you about the enquiry you made and to
> keep a record of our follow-ups. Submitting a form does not list a property,
> does not publish your details, and does not share your number with an owner,
> tenant or buyer. Those steps need a separate conversation with you.
>
> Meta also keeps its own copy under Meta's terms. We can act on the copy we hold.
> We cannot delete Meta's copy for you; Meta provides its own controls.

The first paragraph (no Meta Pixel, no Conversions API) stays as it is.

### "Phone, WhatsApp and email", replace the Meta Instant Forms bullet

> **Meta Instant Forms.** Received automatically from Meta and recorded in our
> private enquiry system, as described above.

### "Information involved", add

> - answers you give in a Meta Instant Form, and which advertisement and form you used;

### "Who receives information", change two items

- Cloudflare:

  > **Cloudflare.** Hosts the site on Workers, stores listings in D1 and new
  > listing media in R2, and hosts our private enquiry system, including
  > enquiries received from Meta Instant Forms.

- Replace the "not active" sentence with:

  > These are not active on this website: an email delivery provider, a payment
  > service, Google Ads conversion tracking, Google Tag Manager, a Meta Pixel, and
  > Meta's Conversions API.

### "Why we use information", add

> - record and follow up an enquiry you made through a Meta Instant Form;

### "How long information is kept", replace the first paragraph

> Enquiries recorded in our private enquiry system, including Meta Instant Form
> answers, are kept while we are handling the enquiry and afterwards
> [for N months / until you ask us to delete them / as long as we may need to
> contact you about properties you asked about]. When our system cannot import a
> form answer, it deletes its working copy within 30 days. Technical logs of Meta
> deliveries, which contain identifiers but not your answers, are deleted after 90
> days. A record of who created or changed an enquiry is kept so that we can show
> how our staff handled it [; when you ask for deletion, your name and number are
> removed from that record]. A WhatsApp chat, phone note or email stays in that
> tool while we still need it.

### "Security", replace the second sentence

> Our private enquiry system is available only to GulbargaHomes staff with
> individual accounts, and each account has a role that limits what it can see and
> change. Phone numbers are hidden from roles that do not need them.

### "Deletion", replace the first paragraph

> Use the data deletion page for the steps and the same contacts. We will delete
> or anonymise the enquiry records we hold about you, including Meta Instant Form
> answers, except where a law that applies to us requires us to keep them. We will
> not keep an optional marketing permission after you withdraw it.

**(no erasure tool)**, use instead:

> Use the data deletion page for the steps and the same contacts. We will stop
> using your details for new contact and will remove them from our enquiry records
> as far as our system allows, except where a law that applies to us requires us
> to keep them.

### The page `description` at the top

> This notice describes how GulbargaHomes handles personal information in
> connection with gulbargahomes.com, our Facebook and Instagram advertisements and
> our private enquiry system.

---

## Proposed changes to `/data-deletion`

### Description

> Use this page to ask for access, a correction, withdrawal of consent, or
> deletion of personal information GulbargaHomes holds about you, including answers
> you sent through a Meta Instant Form in one of our ads.

### "What you can ask", first item

> Access: what we hold in our enquiry system, WhatsApp, phone notes or email we control.

### "What this website does and does not store", replace the first paragraph

> Property and service enquiries reach us by phone, WhatsApp, email or a Meta
> Instant Form in one of our ads. Meta Instant Form answers are imported
> automatically into our private enquiry system. Staff may also record phone and
> WhatsApp enquiries there. The agricultural land form opens WhatsApp with what
> you typed; it does not save a copy on the website. Tell us the mobile number you
> used so we can find your records.

### "What you can ask", add

> If you sent a Meta Instant Form, we can delete our copy. Meta's own copy is
> managed in your Facebook or Instagram settings.

---

## Meta App Review / app settings that rely on these pages

- **Privacy Policy URL:** `https://gulbargahomes.com/privacy-policy` (must
  describe the lead data use above)
- **User data deletion:** choose "Data deletion instructions URL" →
  `https://gulbargahomes.com/data-deletion`. The app has no Facebook Login for
  end users, so a deletion callback is not needed.
