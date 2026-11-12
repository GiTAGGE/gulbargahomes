import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findContactByPhone } from "../lib/crm/contacts";
import { createLandJvEnquiry } from "../lib/crm/land-jv";
import { createOwnerLead } from "../lib/crm/owner-leads";
import { prepareDatabase } from "../lib/db/prepare";
import { readMetaConfig } from "../lib/meta/config";
import { storePageConnection } from "../lib/meta/connection";
import { getStoredForm, parseFormSettings, updateFormSettings, upsertDiscoveredForms } from "../lib/meta/forms";
import { createGraphClient, type MetaQuestion } from "../lib/meta/graph";
import { enqueueLead, type MetaRuntime } from "../lib/meta/ingest";
import { CLASSIFICATION_LABEL, isHistoricalImportClassification, type FormClassification } from "../lib/meta/mapping";
import {
  BUYER_RECOVERY_CAMPAIGN_ID,
  BUYER_RECOVERY_FORM_IDS,
  BUYER_TENANT_FROM_ANSWER_LABEL,
  buyerTenantFromAnswerClassification,
  confirmBuyerRecovery,
  previewBuyerRecovery,
  runBuyerRecoveryStep,
  type BuyerRecoveryRun,
} from "../lib/meta/buyer-recovery";
import { approvedBuyerRenterIntent } from "../lib/meta/values";
import { parseSourceInput } from "../lib/crm/sources";
import { FakeMeta, PAGE_ID, PAGE_TOKEN, type FakeLead } from "./helpers/fake-meta";
import { createTestDb } from "./helpers/sqlite";

const COPY = BUYER_RECOVERY_FORM_IDS[0];
const ORIGINAL = BUYER_RECOVERY_FORM_IDS[1];
const CAMPAIGN = BUYER_RECOVERY_CAMPAIGN_ID;
const ENV = {
  META_APP_SECRET: "0123456789abcdef0123456789abcdef",
  META_WEBHOOK_VERIFY_TOKEN: "verify-me",
  META_TOKEN_KEY: "k".repeat(48),
};
const { config } = readMetaConfig(ENV, "https://gulbargahomes.com");
const admin = { id: "adm_super", email: "owner@example.com", role: "super_admin" };

const choice = (key: string, value: string) => ({ key, value });
const questions: MetaQuestion[] = [
  { key: "nimge_yen_beku?", label: "Nimge yen beku?", type: "CUSTOM", options: [choice("buy_madbeku", "Buy madbeku"), choice("rent_ge_beku", "Rent ge beku")] },
  {
    key: "buy_madbekadre_nimma_budget_eshtu?",
    label: "Buy madbekadre nimma budget eshtu?",
    type: "CUSTOM",
    options: [choice("below_25_lakhs", "Below ₹25 Lakhs"), choice("budget_decide_madilla", "Budget decide madilla")],
  },
  {
    key: "rent_ge_monthly_budget_eshtu?",
    label: "Rent ge monthly budget eshtu?",
    type: "CUSTOM",
    options: [choice("below_10000", "Below ₹10,000"), choice("budget_decide_madilla", "Budget decide madilla")],
  },
  { key: "yava_type_property_beku?", label: "Yava type property beku?", type: "CUSTOM", options: [choice("house", "House"), choice("land", "Land")] },
  { key: "full_name", label: "Full name", type: "FULL_NAME", options: [] },
  { key: "phone", label: "Phone number", type: "PHONE", options: [] },
];

const mapping = {
  "nimge_yen_beku?": "intent",
  "buy_madbekadre_nimma_budget_eshtu?": "purchase_budget",
  "rent_ge_monthly_budget_eshtu?": "rent_budget",
  "yava_type_property_beku?": "property_type",
  full_name: "name",
  phone: "phone",
} as const;

class Clock {
  constructor(public current = new Date("2026-11-12T12:00:00.000Z")) {}
  now = () => this.current;
  iso = () => this.current.toISOString();
  advance(minutes: number) {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}

function leadAt(index: number): FakeLead {
  const intent = index === 142 || index < 103 ? "buy_madbeku" : "rent_ge_beku";
  const formId = index === 142 ? ORIGINAL : COPY;
  let phone = String(9000000000 + index);
  if (index === 0) phone = "19000000000";
  if (index === 103 || index === 104) phone = "9845012345";
  return {
    id: String(860000000000000 + index),
    form_id: formId,
    created_time: index === 142 ? "2026-10-02T10:12:45.000Z" : index === 141 ? "2026-11-03T18:45:43.000Z" : "2026-10-15T08:00:00.000Z",
    ad_id: "701",
    ad_name: "Buyer ad",
    adset_id: "801",
    adset_name: "Buyer ad set",
    campaign_id: CAMPAIGN,
    campaign_name: "GH | Buyers & Renters | Gulbarga",
    platform: "fb",
    is_organic: false,
    field_data: [
      { name: "nimge_yen_beku?", values: [intent] },
      { name: "buy_madbekadre_nimma_budget_eshtu?", values: [index === 5 ? "budget_decide_madilla" : "below_25_lakhs"] },
      { name: "rent_ge_monthly_budget_eshtu?", values: ["below_10000"] },
      { name: "yava_type_property_beku?", values: [index === 2 ? "land" : "house"] },
      { name: "full_name", values: [`Person ${index}`] },
      { name: "phone", values: [phone] },
    ],
  };
}

function allLeads(): FakeLead[] {
  return Array.from({ length: 143 }, (_, index) => leadAt(index));
}

async function connect(leads: FakeLead[]) {
  const db = createTestDb();
  await prepareDatabase(db, () => [], "2026-11-12T00:00:00.000Z");
  const meta = new FakeMeta();
  meta.forms = [
    { id: COPY, name: "Gulbarga Buyer & Renter-copy", questions },
    { id: ORIGINAL, name: "Gulbarga Buyer & Renter", questions },
  ];
  meta.leads = leads;
  const clock = new Clock();
  const graph = createGraphClient(config, meta.fetch);
  await storePageConnection(db, admin, {
    tokenKey: config.tokenKey,
    pageId: PAGE_ID,
    pageName: "GulbargaHomes",
    pageToken: PAGE_TOKEN,
    pageTokenExpiresAt: null,
    dataAccessExpiresAt: null,
    scopes: meta.scopes,
    webhookSubscribed: true,
    now: clock.iso(),
  });
  await upsertDiscoveredForms(
    db,
    admin.id,
    PAGE_ID,
    meta.forms.map((form) => ({ id: form.id, name: form.name, status: "ACTIVE", locale: "en_US", createdTime: null, leadsCount: null, questions: form.questions })),
    clock.iso(),
  );
  const runtime: MetaRuntime = { db, graph, tokenKey: config.tokenKey, pageId: PAGE_ID, adNames: true, now: clock.now };
  return { db, meta, clock, runtime };
}

async function classify(db: Awaited<ReturnType<typeof connect>>["db"], now: string) {
  await saveClassification(db, now, "mixed", mapping);
}

async function saveClassification(
  db: Awaited<ReturnType<typeof connect>>["db"],
  now: string,
  classification: FormClassification,
  nextMapping: Record<string, string>,
) {
  for (const formId of BUYER_RECOVERY_FORM_IDS) {
    const form = (await getStoredForm(db, formId))!;
    await updateFormSettings(db, admin, form, parseFormSettings({ classification, mapping: nextMapping }, form), { now });
  }
}

async function count(db: Awaited<ReturnType<typeof connect>>["db"], sql: string) {
  const row = await db.prepare(sql).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

async function finish(runtime: MetaRuntime, clock: Clock, runId: string) {
  let run = (await runBuyerRecoveryStep(runtime, admin, runId, clock.iso())) as BuyerRecoveryRun;
  for (let step = 0; step < 20 && run.status === "running"; step += 1) {
    clock.advance(1);
    run = await runBuyerRecoveryStep(runtime, admin, runId, clock.iso());
  }
  return run;
}

describe("historical buyer and renter recovery", () => {
  it("maps only the approved Kannada option keys and keeps mixed forms off historical import", () => {
    assert.deepEqual([...BUYER_RECOVERY_FORM_IDS], ["1071121499253613", "1489593689660590"]);
    assert.equal(approvedBuyerRenterIntent("buy_madbeku"), "Buy");
    assert.equal(approvedBuyerRenterIntent("rent_ge_beku"), "Rent");
    assert.equal(approvedBuyerRenterIntent("Buy madbeku"), null);
    assert.equal(approvedBuyerRenterIntent("Rent ge beku"), null);
    assert.equal(approvedBuyerRenterIntent("buy"), null);
    assert.equal(isHistoricalImportClassification("mixed"), false);
    assert.equal(buyerTenantFromAnswerClassification(), "mixed");
    assert.equal(CLASSIFICATION_LABEL[buyerTenantFromAnswerClassification()], BUYER_TENANT_FROM_ANSWER_LABEL);
    assert.notEqual(CLASSIFICATION_LABEL.buyer, BUYER_TENANT_FROM_ANSWER_LABEL);
    assert.notEqual(CLASSIFICATION_LABEL.tenant, BUYER_TENANT_FROM_ANSWER_LABEL);
  });

  it("imports 104 Buy and 39 Rent once, reuses contacts, and leaves land JV and owner leads alone", async () => {
    const leads = allLeads();
    const { db, clock, runtime } = await connect(leads);
    const village = "Subhash village near the tank, call 9845012347";
    await createLandJvEnquiry(
      db,
      admin,
      { name: "Existing Land", phone: "9111111111" },
      {
        taluk: "Aland",
        village,
        acreBand: "2–5 acres",
        ownership: "Joint",
        rtcAvailable: "Yes",
        roadAccess: "Yes",
        ownersAgree: "Yes",
        answers: [{ key: "village", label: "Village", value: village }],
        notes: "keep",
      },
      parseSourceInput({ channel: "meta_lead_form", metaLeadId: "land-existing", metaCampaignId: "120257659162130091" }),
      clock.iso(),
    );
    const owner = await createOwnerLead(
      db,
      admin,
      { name: "Existing Owner", phone: "9000000001" },
      { intent: "Rent", propertyType: "House", locality: "Sedam Road", locationText: "", expectedPrice: 14000, notes: "owner-note", priority: "Warm" },
      parseSourceInput({ channel: "meta_lead_form", metaLeadId: "owner-existing", metaCampaignId: "120257043784730091", metaFormId: "2023485355008623" }),
      clock.iso(),
    );

    const early = await previewBuyerRecovery(runtime, admin, [...BUYER_RECOVERY_FORM_IDS], clock.iso());
    assert.equal(early.status, "blocked");
    assert.equal(early.preview?.total, 143);
    assert.equal(early.preview?.buy, 104);
    assert.equal(early.preview?.rent, 39);
    assert.ok(early.preview?.mappingIssues.length);
    await assert.rejects(confirmBuyerRecovery(runtime, admin, early.id, clock.iso()), /blocked or stale|not classified|Purchase budget/);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM demand_requirements"), 0);

    await classify(db, clock.iso());
    const preview = await previewBuyerRecovery(runtime, admin, [...BUYER_RECOVERY_FORM_IDS], clock.iso());
    assert.equal(preview.status, "previewed");
    assert.equal(preview.preview?.blocked, false);
    assert.equal(preview.preview?.total, 143);
    assert.equal(preview.preview?.buy, 104);
    assert.equal(preview.preview?.rent, 39);
    assert.equal(preview.preview?.unclassified, 0);
    assert.equal(preview.preview?.invalidPhone, 1);
    assert.equal(preview.preview?.existingContacts, 1);
    assert.equal(preview.preview?.campaigns.length, 1);
    assert.equal(preview.preview?.campaigns[0]?.id, CAMPAIGN);
    assert.equal(preview.preview?.createdMin, "2026-10-02T10:12:45.000Z");
    assert.equal(preview.preview?.createdMax, "2026-11-03T18:45:43.000Z");
    assert.equal(preview.preview?.leadIds.length, 143);
    const storedPreview = await db.prepare("SELECT preview_json FROM meta_buyer_recovery_runs WHERE id = ?1").bind(preview.id).first<{ preview_json: string }>();
    assert.equal(storedPreview?.preview_json.includes("9000000001"), false);
    assert.equal(storedPreview?.preview_json.includes("9845012345"), false);

    const started = await confirmBuyerRecovery(runtime, admin, preview.id, clock.iso());
    const done = started.status === "completed" ? started : await finish(runtime, clock, preview.id);
    assert.equal(done.status, "completed");
    assert.equal(done.imported, 142);
    assert.equal(done.held, 1);
    assert.equal(done.failed, 0);
    assert.equal(done.duplicates, 0);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM demand_requirements"), 142);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM demand_requirements WHERE status = 'New'"), 142);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM demand_requirements WHERE status = 'Qualified'"), 0);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM demand_requirements WHERE intent = 'Buy'"), 103);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM demand_requirements WHERE intent = 'Rent'"), 39);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM properties"), 0);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM owner_leads"), 1);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM land_jv_enquiries"), 1);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM lead_sources WHERE ingestion_origin = 'buyer_recovery'"), 142);
    assert.equal(await count(db, `SELECT COUNT(*) AS n FROM lead_sources WHERE meta_campaign_id = '${CAMPAIGN}' AND meta_ad_id = '701' AND meta_adset_id = '801'`), 142);
    assert.equal(await count(db, `SELECT COUNT(*) AS n FROM lead_sources WHERE meta_form_id = '${COPY}'`), 141);
    assert.equal(await count(db, `SELECT COUNT(*) AS n FROM lead_sources WHERE meta_form_id = '${ORIGINAL}'`), 1);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM demand_requirements WHERE property_types_json LIKE '%Plot%'"), 1);

    const held = await db.prepare("SELECT status, last_error FROM meta_lead_ingestions WHERE leadgen_id = '860000000000000'").first<{ status: string; last_error: string }>();
    assert.equal(held?.status, "needs_review");
    assert.equal(held?.last_error.includes("19000000000"), false);
    const undecided = await db.prepare("SELECT status FROM meta_lead_ingestions WHERE leadgen_id = '860000000000005'").first<{ status: string }>();
    assert.equal(undecided?.status, "done");
    const landAnswer = await db.prepare("SELECT village, notes FROM land_jv_enquiries").first<{ village: string; notes: string }>();
    assert.equal(landAnswer?.village, village);
    assert.equal(landAnswer?.notes, "keep");
    const ownerRow = await db.prepare("SELECT intent, notes FROM owner_leads WHERE id = ?1").bind(owner.id).first<{ intent: string; notes: string }>();
    assert.equal(ownerRow?.intent, "Rent");
    assert.equal(ownerRow?.notes, "owner-note");
    const reused = await findContactByPhone(db, "9000000001");
    assert.equal(reused?.name, "Existing Owner");
    assert.equal(reused?.isOwner, true);
    assert.equal(reused?.isSeeker, true);
    assert.equal(await count(db, `SELECT COUNT(*) AS n FROM demand_requirements WHERE contact_id = '${reused!.id}'`), 1);
    const shared = await findContactByPhone(db, "9845012345");
    assert.equal(await count(db, `SELECT COUNT(*) AS n FROM demand_requirements WHERE contact_id = '${shared!.id}'`), 2);
    const audit = await db.prepare("SELECT actor_id, action FROM audit_log WHERE entity_id = ?1 AND action = 'confirm'").bind(preview.id).first<{ actor_id: string; action: string }>();
    assert.equal(audit?.actor_id, admin.id);

    const again = await previewBuyerRecovery(runtime, admin, [...BUYER_RECOVERY_FORM_IDS], clock.iso());
    assert.equal(again.preview?.alreadyQueued, 143);
    const repeated = await confirmBuyerRecovery(runtime, admin, again.id, clock.iso());
    const repeatedDone = repeated.status === "completed" ? repeated : await finish(runtime, clock, again.id);
    assert.equal(repeatedDone.status, "completed");
    assert.equal(repeatedDone.imported, 0);
    assert.equal(repeatedDone.duplicates, 143);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM demand_requirements"), 142);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM owner_leads"), 1);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM land_jv_enquiries"), 1);
  });

  it("blocks a different campaign, a missing intent, a label instead of the key, and any other form", async () => {
    const leads = allLeads();
    leads[10]!.campaign_id = "120257043784730091";
    const { db, clock, runtime } = await connect(leads);
    await classify(db, clock.iso());
    const wrongCampaign = await previewBuyerRecovery(runtime, admin, [...BUYER_RECOVERY_FORM_IDS], clock.iso());
    assert.equal(wrongCampaign.status, "blocked");
    assert.match(wrongCampaign.lastError, /campaign/);
    await assert.rejects(confirmBuyerRecovery(runtime, admin, wrongCampaign.id, clock.iso()));
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM meta_lead_ingestions"), 0);

    leads[10]!.campaign_id = CAMPAIGN;
    leads[11]!.field_data[0]!.values = [""];
    const missing = await previewBuyerRecovery(runtime, admin, [...BUYER_RECOVERY_FORM_IDS], clock.iso());
    assert.equal(missing.preview?.unclassified, 1);
    assert.equal(missing.status, "blocked");

    leads[11]!.field_data[0]!.values = ["buy_madbeku", "rent_ge_beku"];
    const combined = await previewBuyerRecovery(runtime, admin, [...BUYER_RECOVERY_FORM_IDS], clock.iso());
    assert.equal(combined.preview?.unclassified, 1);
    assert.equal(combined.status, "blocked");

    leads[11]!.field_data[0]!.values = ["Buy madbeku"];
    const label = await previewBuyerRecovery(runtime, admin, [...BUYER_RECOVERY_FORM_IDS], clock.iso());
    assert.equal(label.preview?.buy, 103);
    assert.equal(label.preview?.unclassified, 1);
    assert.equal(label.status, "blocked");
    await assert.rejects(approvedRecovery(runtime, label.id, clock), /Nothing was imported|blocked or stale/);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM demand_requirements"), 0);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM properties"), 0);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM owner_leads"), 0);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM land_jv_enquiries"), 0);
    await assert.rejects(previewBuyerRecovery(runtime, admin, ["999999999999999"], clock.iso()), /approved Buyer/);
  });

  it("accepts only Buyer or tenant, from the answer, and refuses a preview that no longer matches", async () => {
    const leads = allLeads();
    const { db, clock, runtime } = await connect(leads);
    await saveClassification(db, clock.iso(), "buyer", mapping);
    const asBuyer = await previewBuyerRecovery(runtime, admin, [...BUYER_RECOVERY_FORM_IDS], clock.iso());
    assert.equal(asBuyer.status, "blocked");
    assert.match(asBuyer.preview?.mappingIssues.join(" ") ?? "", /Buyer requirement/);
    await assert.rejects(confirmBuyerRecovery(runtime, admin, asBuyer.id, clock.iso()));

    await saveClassification(db, clock.iso(), "tenant", mapping);
    const asTenant = await previewBuyerRecovery(runtime, admin, [...BUYER_RECOVERY_FORM_IDS], clock.iso());
    assert.equal(asTenant.status, "blocked");
    assert.match(asTenant.preview?.mappingIssues.join(" ") ?? "", /Tenant requirement/);

    const stored = (await getStoredForm(db, BUYER_RECOVERY_FORM_IDS[0]))!;
    assert.throws(
      () => parseFormSettings({ classification: "mixed", mapping: { ...mapping, "buy_madbekadre_nimma_budget_eshtu?": "budget" } }, stored),
      /Purchase budget or Monthly rental budget/,
    );
    await db
      .prepare("UPDATE meta_forms SET classification = 'mixed', mapping_json = ?1")
      .bind(JSON.stringify({ ...mapping, "buy_madbekadre_nimma_budget_eshtu?": "budget" }))
      .run();
    const generic = await previewBuyerRecovery(runtime, admin, [...BUYER_RECOVERY_FORM_IDS], clock.iso());
    assert.equal(generic.status, "blocked");
    assert.match(generic.preview?.mappingIssues.join(" ") ?? "", /generic budget/);

    await saveClassification(db, clock.iso(), "mixed", { ...mapping, "rent_ge_monthly_budget_eshtu?": "preferences" });
    const missingRent = await previewBuyerRecovery(runtime, admin, [...BUYER_RECOVERY_FORM_IDS], clock.iso());
    assert.equal(missingRent.status, "blocked");
    assert.match(missingRent.preview?.mappingIssues.join(" ") ?? "", /rental budget/);

    await classify(db, clock.iso());
    const preview = await previewBuyerRecovery(runtime, admin, [...BUYER_RECOVERY_FORM_IDS], clock.iso());
    assert.equal(preview.status, "previewed");
    assert.equal(preview.preview?.total, 143);
    assert.equal(preview.preview?.buy, 104);
    assert.equal(preview.preview?.rent, 39);
    assert.equal(preview.preview?.campaigns[0]?.id, CAMPAIGN);
    assert.equal(preview.preview?.leadIds.length, 143);
    assert.equal(preview.preview?.blocked, false);

    leads[4]!.campaign_id = "120257043784730091";
    await assert.rejects(confirmBuyerRecovery(runtime, admin, preview.id, clock.iso()), /Nothing was imported|campaign/);
    const blocked = await db.prepare("SELECT status FROM meta_buyer_recovery_runs WHERE id = ?1").bind(preview.id).first<{ status: string }>();
    assert.equal(blocked?.status, "blocked");
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM meta_lead_ingestions"), 0);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM demand_requirements"), 0);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM owner_leads"), 0);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM properties"), 0);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM land_jv_enquiries"), 0);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM ad_spend_daily"), 0);
  });

  it("retries a rate-limited batch without creating a second requirement", async () => {
    const leads = [leadAt(20), leadAt(21), leadAt(22)];
    const { db, meta, clock, runtime } = await connect(leads);
    await classify(db, clock.iso());
    const runId = "mbr_partialbatchretry1";
    await db
      .prepare(
        `INSERT INTO meta_buyer_recovery_runs (id, status, form_ids_json, preview_json, created_by, created_at, updated_at)
         VALUES (?1, 'running', '[]', '{}', ?2, ?3, ?3)`,
      )
      .bind(runId, admin.id, clock.iso())
      .run();
    meta.rateLimitIds.add(leads[0]!.id);
    const queue = async (lead: FakeLead, withPayload: boolean) => {
      clock.advance(1);
      await enqueueLead(
        db,
        {
          leadgenId: lead.id,
          pageId: PAGE_ID,
          formId: COPY,
          origin: "recovery",
          recoveryRunId: runId,
          lead: withPayload
            ? {
                id: lead.id,
                createdTime: lead.created_time,
                formId: COPY,
                adId: "701",
                adName: "Buyer ad",
                adsetId: "801",
                adsetName: "Buyer ad set",
                campaignId: CAMPAIGN,
                campaignName: "GH | Buyers & Renters | Gulbarga",
                platform: "fb",
                isOrganic: false,
                fieldData: lead.field_data,
              }
            : null,
        },
        clock.iso(),
      );
    };
    await queue(leads[0]!, false);
    await queue(leads[1]!, true);
    await queue(leads[2]!, true);

    const paused = await runBuyerRecoveryStep(runtime, admin, runId, clock.iso());
    assert.equal(paused.status, "running");
    assert.match(paused.lastError, /rate-limited/);
    assert.ok(paused.imported < 3);
    const retrying = await db.prepare("SELECT status FROM meta_lead_ingestions WHERE leadgen_id = ?1").bind(leads[0]!.id).first<{ status: string }>();
    assert.equal(retrying?.status, "retry");

    meta.rateLimitIds.clear();
    clock.advance(16);
    const done = await finish(runtime, clock, runId);
    assert.equal(done.status, "completed");
    assert.equal(done.imported, 3);
    assert.equal(done.failed, 0);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM demand_requirements"), 3);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM demand_requirements WHERE status = 'New'"), 3);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM owner_leads"), 0);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM properties"), 0);
    await assert.rejects(runBuyerRecoveryStep(runtime, admin, runId, clock.iso()), /no recovery in progress/);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM demand_requirements"), 3);
  });
});

function approvedRecovery(runtime: MetaRuntime, id: string, clock: Clock) {
  return confirmBuyerRecovery(runtime, admin, id, clock.iso());
}
