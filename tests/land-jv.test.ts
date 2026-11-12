import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getContact } from "../lib/crm/contacts";
import { erasureStatements } from "../lib/crm/erasure";
import { getLandJvEnquiry } from "../lib/crm/land-jv";
import { getOwnerLead } from "../lib/crm/owner-leads";
import { getRequirement } from "../lib/crm/requirements";
import { prepareDatabase } from "../lib/db/prepare";
import { readMetaConfig } from "../lib/meta/config";
import { getStoredForm, parseFormSettings, updateFormSettings, upsertDiscoveredForms } from "../lib/meta/forms";
import { createGraphClient, type MetaLead, type MetaQuestion } from "../lib/meta/graph";
import { enqueueLead, processIngestion, resolveIngestionIntent, type MetaRuntime } from "../lib/meta/ingest";
import { alignLandTargets, mapLead, suggestMapping, type MappedForm } from "../lib/meta/mapping";
import { createTestDb } from "./helpers/sqlite";

const NOW = "2026-11-12T10:00:00.000Z";
const PAGE_ID = "1122334455";
const JV = "1601516668397039";
const COPY = "1071121499253613";
const admin = { id: "adm_super", email: "owner@example.com", role: "super_admin" };
const { config } = readMetaConfig({
  META_APP_SECRET: "0123456789abcdef0123456789abcdef",
  META_WEBHOOK_VERIFY_TOKEN: "verify-me",
  META_TOKEN_KEY: "k".repeat(48),
});

const choice = (key: string, value: string) => ({ key, value });

const buyerQuestions: MetaQuestion[] = [
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
  {
    key: "yava_type_property_beku?",
    label: "Yava type property beku?",
    type: "CUSTOM",
    options: [choice("house", "House"), choice("land", "Land")],
  },
  { key: "full_name", label: "Full name", type: "FULL_NAME", options: [] },
  { key: "phone", label: "Phone number", type: "PHONE", options: [] },
];

const landQuestions: MetaQuestion[] = [
  { key: "yaava_taluk?", label: "Yaava taluk?", type: "CUSTOM", options: [choice("kalaburagi", "Kalaburagi")] },
  { key: "jameenu_eshtu_acre_ide?", label: "Jameenu eshtu acre ide?", type: "CUSTOM", options: [choice("2_5_acres", "2–5 acres")] },
  { key: "ownership_yaar_hesarallide?", label: "Ownership yaar hesarallide?", type: "CUSTOM", options: [choice("joint", "Joint")] },
  { key: "rtc_/_pahani_available_ideya?", label: "RTC / Pahani available ideya?", type: "CUSTOM", options: [choice("yes", "Yes")] },
  { key: "jameenige_road_access_ideya?", label: "Jameenige road access ideya?", type: "CUSTOM", options: [choice("yes", "Yes")] },
  { key: "jv_maadalu_ella_owners_agree_iddara?", label: "JV maadalu ella owners agree iddara?", type: "CUSTOM", options: [choice("yes", "Yes")] },
  { key: "nimma_jameenu_yaava_oorinallide?", label: "Nimma jameenu yaava oorinallide?", type: "CUSTOM", options: [] },
  { key: "full_name", label: "Full name", type: "FULL_NAME", options: [] },
  { key: "phone_number", label: "Phone number", type: "PHONE", options: [] },
];

function buyerForm(mapping: MappedForm["mapping"]): MappedForm {
  return { formId: COPY, name: "Gulbarga Buyer & Renter-copy", classification: "mixed", ownerIntent: "", mapping, questions: buyerQuestions };
}

function lead(formId: string, id: string, answers: Record<string, string>, campaignId = "120257140076410091"): MetaLead {
  return {
    id,
    createdTime: "2026-11-02T04:00:00.000Z",
    formId,
    adId: "701",
    adName: "Ad",
    adsetId: "801",
    adsetName: "Ad set",
    campaignId,
    campaignName: campaignId === "120257659162130091" ? "GH | Agri Land Owner JV Leads" : "GH | Buyers & Renters | Gulbarga",
    platform: "fb",
    isOrganic: false,
    fieldData: Object.entries(answers).map(([name, value]) => ({ name, values: [value] })),
  };
}

async function database() {
  const db = createTestDb();
  await prepareDatabase(db, () => [], NOW);
  const graph = createGraphClient(config, async () => {
    throw new Error("This test must not call Graph.");
  });
  const runtime: MetaRuntime = { db, graph, tokenKey: config.tokenKey, pageId: PAGE_ID, now: () => new Date(NOW) };
  return { db, runtime };
}

async function classify(db: Awaited<ReturnType<typeof database>>["db"], formId: string, questions: MetaQuestion[], name: string, classification: "mixed" | "land_jv") {
  await upsertDiscoveredForms(
    db,
    admin.id,
    PAGE_ID,
    [{ id: formId, name, status: "ACTIVE", locale: "en_US", createdTime: null, leadsCount: 1, questions }],
    NOW,
  );
  const form = (await getStoredForm(db, formId))!;
  await updateFormSettings(db, admin, form, parseFormSettings({ classification, mapping: suggestMapping(questions, classification) }, form), { now: NOW });
}

describe("buyer and renter mapping", () => {
  const stale = {
    "nimge_yen_beku?": "intent",
    "buy_madbekadre_nimma_budget_eshtu?": "budget",
    "rent_ge_monthly_budget_eshtu?": "budget",
    "yava_type_property_beku?": "property_type",
    full_name: "name",
    phone: "phone",
  } as const;

  it("keeps purchase and monthly budgets apart, including a stale generic mapping", () => {
    const buy = mapLead(
      buyerForm(stale),
      lead(COPY, "100000000000001", {
        "nimge_yen_beku?": "Buy madbeku",
        "buy_madbekadre_nimma_budget_eshtu?": "Below ₹25 Lakhs",
        "rent_ge_monthly_budget_eshtu?": "Below ₹10,000",
        full_name: "Asha Rao",
        phone: "9845011111",
      }),
    );
    assert.equal(buy.kind, "buyer");
    if (buy.kind !== "buyer") return;
    assert.equal(buy.requirement.intent, "Buy");
    assert.equal(buy.requirement.budgetMax, 2_500_000);
    assert.equal(buy.decision.budgetBasis, "purchase");
    assert.match(buy.requirement.notes, /Below ₹10,000/);

    const rent = mapLead(
      buyerForm(stale),
      lead(COPY, "100000000000002", {
        "nimge_yen_beku?": "Rent ge beku",
        "buy_madbekadre_nimma_budget_eshtu?": "Below ₹25 Lakhs",
        "rent_ge_monthly_budget_eshtu?": "Below ₹10,000",
        full_name: "Asha Rao",
        phone: "9845011111",
      }),
    );
    assert.equal(rent.kind, "tenant");
    if (rent.kind !== "tenant") return;
    assert.equal(rent.requirement.budgetMax, 10_000);
    assert.equal(rent.decision.budgetBasis, "monthly");

    const keyed = mapLead(
      buyerForm(stale),
      lead(COPY, "100000000000007", {
        "nimge_yen_beku?": "rent_ge_beku",
        "rent_ge_monthly_budget_eshtu?": "below_₹10,000",
        full_name: "Asha Rao",
        phone: "9845011111",
      }),
    );
    assert.equal(keyed.kind, "tenant");
  });

  it("treats an undecided budget as valid and holds a missing or combined intent", () => {
    const undecided = mapLead(
      buyerForm(suggestMapping(buyerQuestions, "mixed")),
      lead(COPY, "100000000000003", {
        "nimge_yen_beku?": "Buy madbeku",
        "buy_madbekadre_nimma_budget_eshtu?": "Budget decide madilla",
        full_name: "Asha Rao",
        phone: "9845011111",
      }),
    );
    assert.equal(undecided.kind, "buyer");
    if (undecided.kind !== "buyer") return;
    assert.equal(undecided.requirement.budgetMin, null);
    assert.equal(undecided.requirement.budgetMax, null);

    const missing = mapLead(
      buyerForm(suggestMapping(buyerQuestions, "mixed")),
      lead(COPY, "100000000000004", { full_name: "Asha Rao", phone: "9845011111" }),
    );
    assert.equal(missing.kind, "review");
    const both = mapLead(
      buyerForm(suggestMapping(buyerQuestions, "mixed")),
      lead(COPY, "100000000000005", { "nimge_yen_beku?": "Buy madbeku, Rent ge beku", full_name: "Asha Rao", phone: "9845011111" }),
    );
    assert.equal(both.kind, "review");
  });

  it("imports a Land answer as a buyer requirement and creates no inventory", async () => {
    const { db, runtime } = await database();
    await classify(db, COPY, buyerQuestions, "Gulbarga Buyer & Renter-copy", "mixed");
    const queued = await enqueueLead(
      db,
      {
        leadgenId: "100000000000006",
        pageId: PAGE_ID,
        origin: "import",
        lead: lead(COPY, "100000000000006", {
          "nimge_yen_beku?": "Buy madbeku",
          "yava_type_property_beku?": "Land",
          full_name: "Asha Rao",
          phone: "9845011112",
        }),
      },
      NOW,
    );
    assert.equal(await processIngestion(runtime, queued.id), "done");
    const row = await db.prepare("SELECT entity_type, entity_id FROM meta_lead_ingestions WHERE id = ?1").bind(queued.id).first<{ entity_type: string; entity_id: string }>();
    assert.equal(row?.entity_type, "requirement");
    const requirement = await getRequirement(db, row!.entity_id);
    assert.equal(requirement?.status, "New");
    assert.deepEqual(requirement?.propertyTypes, ["Plot"]);
    assert.match(requirement?.notes ?? "", /Land/);
    const properties = await db.prepare("SELECT COUNT(*) AS n FROM properties").first<{ n: number }>();
    assert.equal(Number(properties?.n), 0);
    assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM owner_leads").first<{ n: number }>().then((item) => Number(item?.n)), 0);
    const source = await db.prepare("SELECT meta_campaign_id, meta_lead_id FROM lead_sources").first<{ meta_campaign_id: string; meta_lead_id: string }>();
    assert.equal(source?.meta_campaign_id, "120257140076410091");
    assert.equal(source?.meta_lead_id, "100000000000006");
  });
});

describe("land JV enquiries", () => {
  it("suggests the land fields and ignores a saved residential mapping", () => {
    const suggested = suggestMapping(landQuestions, "land_jv");
    assert.equal(suggested["yaava_taluk?"], "taluk");
    assert.equal(suggested["jameenu_eshtu_acre_ide?"], "acre_band");
    assert.equal(suggested["nimma_jameenu_yaava_oorinallide?"], "village");
    assert.equal(suggested["jameenige_road_access_ideya?"], "road_access");
    assert.equal(suggested["rtc_/_pahani_available_ideya?"], "rtc_available");
    assert.equal(suggested["jv_maadalu_ella_owners_agree_iddara?"], "owners_agree");
    const stale = alignLandTargets(landQuestions, "land_jv", {
      "yaava_taluk?": "locality",
      "jameenu_eshtu_acre_ide?": "expected_price",
      "jameenige_road_access_ideya?": "locality",
      "nimma_jameenu_yaava_oorinallide?": "locality",
      phone_number: "phone",
      full_name: "name",
    });
    assert.equal(stale["jameenu_eshtu_acre_ide?"], "acre_band");
    assert.equal(stale.phone_number, "phone");
  });

  it("records one enquiry from Record as Land JV and does not create a property or a second contact", async () => {
    const { db, runtime } = await database();
    await classify(db, JV, landQuestions, "Agricultural Land JV | Kalaburagi", "land_jv");
    const answers = {
      "yaava_taluk?": "Kalaburagi",
      "jameenu_eshtu_acre_ide?": "2–5 acres",
      "ownership_yaar_hesarallide?": "Joint",
      "rtc_/_pahani_available_ideya?": "Yes",
      "jameenige_road_access_ideya?": "Yes",
      "jv_maadalu_ella_owners_agree_iddara?": "Yes",
      "nimma_jameenu_yaava_oorinallide?": "Some village",
      full_name: "Land Owner",
      phone_number: "9845012345",
    };
    const first = lead(JV, "200000000000001", answers, "120257659162130091");
    const queued = await enqueueLead(db, { leadgenId: first.id, pageId: PAGE_ID, origin: "import", lead: first }, NOW);
    await db.prepare("UPDATE meta_lead_ingestions SET status = 'needs_review', last_error_kind = 'intent_owner' WHERE id = ?1").bind(queued.id).run();
    const decision = await resolveIngestionIntent(db, admin, queued.id, "Land JV", NOW);
    assert.equal(decision.ready, true);
    assert.equal(await processIngestion(runtime, queued.id), "done");

    const saved = await db.prepare("SELECT entity_id, contact_id FROM meta_lead_ingestions WHERE id = ?1").bind(queued.id).first<{ entity_id: string; contact_id: string }>();
    const enquiry = await getLandJvEnquiry(db, saved!.entity_id);
    assert.equal(enquiry?.status, "New");
    assert.equal(enquiry?.taluk, "Kalaburagi");
    assert.equal(enquiry?.village, "Some village");
    assert.equal(enquiry?.acreBand, "2–5 acres");
    assert.equal(enquiry?.campaignId, "120257659162130091");
    assert.equal(enquiry?.answers.find((answer) => answer.key === "yaava_taluk?")?.value, "Kalaburagi");
    const contact = await getContact(db, saved!.contact_id);
    assert.equal(contact?.isLandJv, true);
    assert.equal(contact?.isOwner, false);
    assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM properties").first<{ n: number }>())?.n), 0);
    assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM owner_leads").first<{ n: number }>())?.n), 0);

    await db.prepare("UPDATE meta_lead_ingestions SET status = 'pending', entity_type = NULL, entity_id = NULL, next_attempt_at = ?2 WHERE id = ?1").bind(queued.id, NOW).run();
    assert.equal(await processIngestion(runtime, queued.id), "done");
    assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM land_jv_enquiries").first<{ n: number }>())?.n), 1);

    const second = lead(JV, "200000000000002", { ...answers, full_name: "Same Person" }, "120257659162130091");
    const again = await enqueueLead(db, { leadgenId: second.id, pageId: PAGE_ID, origin: "import", lead: second }, NOW);
    assert.equal(await processIngestion(runtime, again.id), "done");
    assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM contacts").first<{ n: number }>())?.n), 1);
    assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM land_jv_enquiries").first<{ n: number }>())?.n), 2);
  });

  it("holds an 11-digit number beginning with 19 and keeps Sale as a staff owner lead", async () => {
    const { db, runtime } = await database();
    await classify(db, JV, landQuestions, "Agricultural Land JV | Kalaburagi", "land_jv");
    const bad = lead(JV, "200000000000003", { full_name: "Bad Number", phone_number: "19000000000", "yaava_taluk?": "Sedam" }, "120257659162130091");
    const held = await enqueueLead(db, { leadgenId: bad.id, pageId: PAGE_ID, origin: "import", lead: bad }, NOW);
    assert.equal(await processIngestion(runtime, held.id), "needs_review");
    const reason = await db.prepare("SELECT status, last_error_kind, last_error FROM meta_lead_ingestions WHERE id = ?1").bind(held.id).first<{ status: string; last_error_kind: string; last_error: string }>();
    assert.equal(reason?.status, "needs_review");
    assert.equal(reason?.last_error_kind, "data");
    assert.equal(reason?.last_error.includes("19000000000"), false);
    assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM land_jv_enquiries").first<{ n: number }>())?.n), 0);

    const saleLead = lead(JV, "200000000000004", { full_name: "Chosen Sale", phone_number: "9845012346", "yaava_taluk?": "Aland" }, "120257659162130091");
    const sale = await enqueueLead(db, { leadgenId: saleLead.id, pageId: PAGE_ID, origin: "import", lead: saleLead }, NOW);
    await db.prepare("UPDATE meta_lead_ingestions SET status = 'needs_review', last_error_kind = 'intent_owner' WHERE id = ?1").bind(sale.id).run();
    await resolveIngestionIntent(db, admin, sale.id, "Sale", NOW);
    assert.equal(await processIngestion(runtime, sale.id), "done");
    const saved = await db.prepare("SELECT entity_type, entity_id FROM meta_lead_ingestions WHERE id = ?1").bind(sale.id).first<{ entity_type: string; entity_id: string }>();
    assert.equal(saved?.entity_type, "owner_lead");
    assert.equal((await getOwnerLead(db, saved!.entity_id))?.intent, "Sale");
    assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM properties").first<{ n: number }>())?.n), 0);
    assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM land_jv_enquiries").first<{ n: number }>())?.n), 0);
    const repeat = await resolveIngestionIntent(db, admin, sale.id, "Land JV", NOW);
    assert.equal(repeat.ready, false);
    assert.equal(repeat.entityType, "owner_lead");
    assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM owner_leads").first<{ n: number }>())?.n), 1);
  });

  it("erases the village and the stored answers with the contact", async () => {
    const { db, runtime } = await database();
    await classify(db, JV, landQuestions, "Agricultural Land JV | Kalaburagi", "land_jv");
    const item = lead(JV, "200000000000005", { full_name: "Erase Me", phone_number: "9845012347", "nimma_jameenu_yaava_oorinallide?": "Secret village" }, "120257659162130091");
    const queued = await enqueueLead(db, { leadgenId: item.id, pageId: PAGE_ID, origin: "webhook", lead: item }, NOW);
    assert.equal(await processIngestion(runtime, queued.id), "done");
    const contactId = (await db.prepare("SELECT contact_id FROM meta_lead_ingestions WHERE id = ?1").bind(queued.id).first<{ contact_id: string }>())!.contact_id;
    const code = (await getContact(db, contactId))!.code;
    await db.batch(erasureStatements(code, "owner@example.com", NOW).map((sql) => db.prepare(sql)));
    const left = await db.prepare("SELECT village, answers_json, notes FROM land_jv_enquiries").first<{ village: string; answers_json: string; notes: string }>();
    assert.equal(left?.village, "");
    assert.equal(left?.answers_json, "[]");
    assert.equal(left?.notes, "");
    const source = await db.prepare("SELECT meta_lead_id FROM lead_sources").first<{ meta_lead_id: string }>();
    assert.equal(source?.meta_lead_id, "200000000000005");
  });
});
