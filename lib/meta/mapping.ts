import type { ContactInput } from "../crm/contacts";
import { OWNER_INTENTS, type DemandIntent, type OwnerIntent } from "../crm/options";
import type { OwnerLeadInput } from "../crm/owner-leads";
import type { RequirementInput } from "../crm/requirements";
import { canonicalLocalityName } from "../locality";
import type { MetaLead, MetaQuestion } from "./graph";
import {
  cleanAnswer,
  demandIntentsIn,
  ownerIntentsIn,
  parseBhk,
  parseDemandIntent,
  parseMoney,
  parseOwnerIntent,
  parsePropertyType,
  parseTimeline,
  splitLocalities,
} from "./values";

export const FORM_CLASSIFICATIONS = ["unclassified", "owner", "tenant", "buyer", "mixed", "ignore"] as const;
export type FormClassification = (typeof FORM_CLASSIFICATIONS)[number];

export const CLASSIFICATION_LABEL: Record<FormClassification, string> = {
  unclassified: "Not classified",
  owner: "Owner property enquiry → owner lead",
  tenant: "Tenant requirement → rental demand",
  buyer: "Buyer requirement → purchase demand",
  mixed: "Buyer or tenant, from the answer",
  ignore: "Ignore (do not import)",
};

export const MAPPING_TARGETS = [
  "",
  "name",
  "first_name",
  "last_name",
  "phone",
  "email",
  "intent",
  "property_type",
  "bhk",
  "budget",
  "purchase_budget",
  "rent_budget",
  "expected_price",
  "locality",
  "timeline",
  "preferences",
  "ignore",
] as const;
export type MappingTarget = (typeof MAPPING_TARGETS)[number];

export const TARGET_LABEL: Record<MappingTarget, string> = {
  "": "Not mapped (keep for review)",
  name: "Full name",
  first_name: "First name",
  last_name: "Last name",
  phone: "Mobile",
  email: "Email",
  intent: "Rent / sale / buy",
  property_type: "Property type",
  bhk: "BHK",
  budget: "Budget (single-purpose form)",
  purchase_budget: "Purchase budget",
  rent_budget: "Monthly rental budget",
  expected_price: "Expected rent or price (owner)",
  locality: "Preferred location / locality",
  timeline: "Requirement timeline",
  preferences: "Additional preferences",
  ignore: "Ignore",
};

export type FieldMapping = Record<string, MappingTarget>;

export type MappedForm = {
  formId: string;
  name: string;
  classification: FormClassification;
  ownerIntent: OwnerIntent | "";
  mapping: FieldMapping;
  questions: MetaQuestion[];
};

/** Contact fields Meta always uses these keys for. They apply unless the form maps the key elsewhere. */
const STANDARD_KEYS: Record<string, MappingTarget> = {
  full_name: "name",
  first_name: "first_name",
  last_name: "last_name",
  phone_number: "phone",
  phone: "phone",
  email: "email",
  work_email: "email",
};

const TYPE_TARGET: Record<string, MappingTarget> = {
  FULL_NAME: "name",
  FIRST_NAME: "first_name",
  LAST_NAME: "last_name",
  PHONE: "phone",
  EMAIL: "email",
  WORK_EMAIL: "email",
};

export function isMappingTarget(value: unknown): value is MappingTarget {
  return typeof value === "string" && (MAPPING_TARGETS as readonly string[]).includes(value);
}

function questionText(question: MetaQuestion): string {
  const options = question.options.map((option) => `${option.key} ${option.value}`).join(" ");
  return `${question.key} ${question.label} ${options}`.toLowerCase().replace(/_/g, " ");
}

/** A starting point from question types, wording and the options Meta offers. Admins confirm it. */
export function suggestTarget(question: MetaQuestion, classification: FormClassification): MappingTarget {
  const byType = TYPE_TARGET[question.type];
  if (byType) return byType;
  const byKey = STANDARD_KEYS[question.key];
  if (byKey) return byKey;
  const text = questionText(question);
  const ownerChoices = ownerIntentsIn(text);
  const demandChoices = demandIntentsIn(text);
  if (/\b(bhk|bedroom|bed room)/.test(text)) return "bhk";
  if (ownerChoices.length > 1 || demandChoices.length > 1) return "intent";
  if (/(rent or (sale|sell|buy)|sell or rent|buy or rent|looking to|purpose|want to (rent|sell|buy)|\byen beku\b|\bmadbeku\b)/.test(text)) {
    return "intent";
  }
  if (/(property type|type of property|kind of property|what type|type property)/.test(text)) return "property_type";
  if (/\b(house|flat|apartment|plot|villa|commercial)\b/.test(text) && question.options.length >= 2) return "property_type";
  if (/(budget|price range|how much|eshtu|expect)/.test(text)) {
    if (classification === "owner") return "expected_price";
    if (classification === "mixed") {
      if (/lakh|crore|\bcr\b/.test(text)) return "purchase_budget";
      if (/month|monthly|rent|tingala/.test(text)) return "rent_budget";
    }
    return "budget";
  }
  if (/(expected (rent|price)|asking|rent amount|selling price)/.test(text)) return "expected_price";
  if (/(immediate|within|just looking|how soon|timeline|move|possession|yavaga)/.test(text)) return "timeline";
  if (/(locat|locality|area|where|address|road|colony|ellide|dalli|oorin)/.test(text)) return "locality";
  if (/(prefer|requirement|additional|furnish|vegetarian|family|bachelor|parking|message|comment)/.test(text)) {
    return "preferences";
  }
  if (question.type === "CITY") return "preferences";
  return "";
}

export function suggestMapping(questions: MetaQuestion[], classification: FormClassification): FieldMapping {
  return Object.fromEntries(questions.map((question) => [question.key, suggestTarget(question, classification)]));
}

export type MappedAnswer = { key: string; label: string; value: string; target: MappingTarget };

/** How the importer chose the intent and which budget it stored. Kept with the original answers. */
export type IntentDecision = {
  intent: OwnerIntent | DemandIntent;
  basis: "answer" | "form_default" | "staff";
  questionKey: string;
  answer: string;
  budgetBasis: "purchase" | "monthly" | "expected_price" | "";
  budgetKey: string;
  /** Set when a staff member chose the intent. Empty when the answer decided it. */
  decidedBy: string;
};

export type MappedLead =
  | {
      kind: "owner";
      contact: ContactInput;
      owner: OwnerLeadInput;
      decision: IntentDecision;
      answers: MappedAnswer[];
      unmapped: MappedAnswer[];
      problems: string[];
    }
  | {
      kind: "tenant" | "buyer";
      contact: ContactInput;
      requirement: RequirementInput;
      decision: IntentDecision;
      answers: MappedAnswer[];
      unmapped: MappedAnswer[];
      problems: string[];
    }
  | {
      kind: "review";
      reason: string;
      choices: readonly ("Buy" | "Rent" | "Sale" | "Lease")[];
      answers: MappedAnswer[];
      unmapped: MappedAnswer[];
      problems: string[];
    };

function targetFor(form: MappedForm, key: string): MappingTarget {
  if (key in form.mapping) return form.mapping[key];
  return STANDARD_KEYS[key] ?? "";
}

function labelFor(form: MappedForm, key: string): string {
  return form.questions.find((question) => question.key === key)?.label || cleanAnswer(key);
}

export type IntentChoice = { intent?: string; decidedBy?: string };

/** Turns one Meta lead into CRM input using the form's mapping. Every answer is kept. */
export function mapLead(form: MappedForm, lead: MetaLead, choice: IntentChoice = {}): MappedLead {
  if (!["owner", "tenant", "buyer", "mixed"].includes(form.classification)) {
    throw new Error(`Form ${form.formId} is not classified for import.`);
  }
  const answers: MappedAnswer[] = lead.fieldData.map((field) => ({
    key: field.name,
    label: labelFor(form, field.name),
    value: field.values.map((value) => value.trim()).filter(Boolean).join(", "),
    target: targetFor(form, field.name),
  }));
  const valuesFor = (target: MappingTarget) => answers.filter((answer) => answer.target === target && answer.value);
  const first = (target: MappingTarget) => valuesFor(target)[0]?.value ?? "";

  const problems: string[] = [];
  const notes: string[] = [`From Meta Instant Form “${form.name || form.formId}”.`];
  const unparsed = (label: string, value: string) => notes.push(`${label} (as answered): ${value}`);

  const name =
    first("name") || [first("first_name"), first("last_name")].filter(Boolean).join(" ").trim() || "Meta lead";
  const phone = first("phone");
  const email = first("email").toLowerCase();
  if (!phone) problems.push("The lead has no mobile number mapped.");
  const contact: ContactInput = {
    name: name.slice(0, 80),
    phone,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.slice(0, 120) : "",
  };

  const typeAnswer = first("property_type");
  const propertyType = typeAnswer ? parsePropertyType(typeAnswer) : null;
  if (typeAnswer && !propertyType) unparsed("Property type", typeAnswer);
  if (typeAnswer && propertyType && cleanAnswer(typeAnswer).toLowerCase() !== propertyType.toLowerCase()) {
    notes.push(`Property type “${typeAnswer}” recorded as ${propertyType}. The original answer is kept.`);
  }

  const bhkAnswer = first("bhk");
  const bhk = bhkAnswer ? parseBhk(bhkAnswer) : { min: null, max: null };
  if (bhkAnswer && bhk.min === null) unparsed("BHK", bhkAnswer);

  const locationAnswer = valuesFor("locality").map((answer) => answer.value).join(", ");
  const localities = splitLocalities(locationAnswer).map(canonicalLocalityName);

  const timelineAnswer = first("timeline");
  const timeline = timelineAnswer ? parseTimeline(timelineAnswer) : null;
  if (timelineAnswer) notes.push(`Timeline (as answered): ${timelineAnswer}`);

  const intentAnswer = first("intent");
  for (const answer of valuesFor("preferences")) notes.push(`${answer.label}: ${answer.value}`);

  const unmapped = answers.filter((answer) => answer.target === "" && answer.value);
  if (unmapped.length) {
    notes.push("Other answers:");
    for (const answer of unmapped) notes.push(`- ${answer.label}: ${answer.value}`);
  }

  const review = (reason: string, choices: readonly ("Buy" | "Rent" | "Sale" | "Lease")[]): MappedLead => ({
    kind: "review",
    reason,
    choices,
    answers,
    unmapped,
    problems,
  });

  if (form.classification === "owner") {
    const staffIntent = (OWNER_INTENTS as readonly string[]).includes(choice.intent ?? "") ? (choice.intent as OwnerIntent) : null;
    const parsed = intentAnswer ? parseOwnerIntent(intentAnswer) : null;
    const fromUnmapped = answers
      .filter((answer) => {
        if (answer.target !== "" || !answer.value) return false;
        const question = form.questions.find((item) => item.key === answer.key);
        const options = question?.options.map((option) => `${option.key} ${option.value}`).join(" ") ?? "";
        // Only an unmapped choice question can set the intent. A note that mentions
        // "sale" must not override the form's assume-Rent default.
        return ownerIntentsIn(options).length > 1;
      })
      .flatMap((answer) => ownerIntentsIn(answer.value).map((intent) => ({ intent, answer })));
    const uniqueUnmapped = [...new Set(fromUnmapped.map((item) => item.intent))];
    let intent: OwnerIntent | null = staffIntent ?? parsed;
    let basis: IntentDecision["basis"] = staffIntent ? "staff" : "answer";
    let questionKey = valuesFor("intent")[0]?.key ?? "";
    let answerText = intentAnswer;
    if (!intent && !intentAnswer && uniqueUnmapped.length === 1) {
      intent = uniqueUnmapped[0];
      const found = fromUnmapped.find((item) => item.intent === intent);
      questionKey = found?.answer.key ?? "";
      answerText = found?.answer.value ?? "";
      notes.push(`Sell, rent or lease was taken from an unmapped answer “${answerText}”.`);
    }
    if (!intent && intentAnswer && !parsed) {
      return review(
        `The answer “${intentAnswer}” is not a sale, a rent or a lease. Choose Import as Sale, Import as Rent or Import as Lease. Nothing was created.`,
        ["Sale", "Rent", "Lease"],
      );
    }
    if (!intent) {
      const fallback = (OWNER_INTENTS as readonly string[]).includes(form.ownerIntent) ? (form.ownerIntent as OwnerIntent) : null;
      if (!fallback) {
        return review(
          "The form does not say whether they want to sell, rent or lease. Choose Import as Sale, Import as Rent or Import as Lease. Nothing was created.",
          ["Sale", "Rent", "Lease"],
        );
      }
      intent = fallback;
      basis = "form_default";
      notes.push(`The form does not ask. Staff set this form to assume ${fallback}.`);
    }
    if (staffIntent && intentAnswer && parsed && parsed !== staffIntent) {
      notes.push(`Staff recorded this as ${staffIntent}. The form answer was “${intentAnswer}”.`);
    }
    const pricePick = valuesFor("expected_price")[0] ?? valuesFor("budget")[0];
    const price = pricePick ? parseMoney(pricePick.value) : { min: null, max: null };
    if (pricePick && price.max === null && price.min === null) unparsed("Expected price", pricePick.value);
    notes.unshift(`Recorded as ${intent}${answerText ? `, from “${labelFor(form, questionKey) || questionKey}” = ${answerText}` : ""}.`);
    return {
      kind: "owner",
      contact,
      decision: {
        intent,
        basis,
        questionKey,
        answer: answerText,
        budgetBasis: pricePick ? "expected_price" : "",
        budgetKey: pricePick?.key ?? "",
        decidedBy: basis === "staff" ? choice.decidedBy ?? "" : "",
      },
      owner: {
        intent,
        propertyType: propertyType ?? "",
        locality: localities[0] ?? "",
        locationText: locationAnswer.slice(0, 200),
        expectedPrice: price.max ?? price.min,
        notes: notes.join("\n").slice(0, 4000),
        priority: "Warm",
      },
      answers,
      unmapped,
      problems,
    };
  }

  const staffDemand = choice.intent === "Buy" || choice.intent === "Rent" ? choice.intent : null;
  let intent: DemandIntent;
  let basis: IntentDecision["basis"] = "form_default";
  let questionKey = valuesFor("intent")[0]?.key ?? "";
  let answerText = intentAnswer;
  if (form.classification === "mixed" || staffDemand) {
    const parsed = intentAnswer ? parseDemandIntent(intentAnswer) : null;
    if (staffDemand) {
      intent = staffDemand;
      basis = "staff";
      if (intentAnswer && parsed && parsed !== staffDemand) notes.push(`Staff recorded this as ${staffDemand}. The form answer was “${intentAnswer}”.`);
    } else if (parsed) {
      intent = parsed;
      basis = "answer";
    } else if (intentAnswer) {
      return review(
        `The answer “${intentAnswer}” is not a buy or a rent. Choose Import as Buy or Import as Rent. Nothing was created.`,
        ["Buy", "Rent"],
      );
    } else {
      return review(
        "The form does not say whether they want to buy or rent. Choose Import as Buy or Import as Rent. Nothing was created.",
        ["Buy", "Rent"],
      );
    }
  } else {
    intent = form.classification === "tenant" ? "Rent" : "Buy";
    if (intentAnswer) {
      const answered = parseDemandIntent(intentAnswer);
      if (answered && answered !== intent) notes.push(`Answered “${intentAnswer}” on a ${form.classification} form. Confirm on the call.`);
    }
  }

  // Only the budget that matches the intent is stored. The other answer stays
  // in the original form answers and is never written into the range.
  const purchase = valuesFor("purchase_budget")[0];
  const monthly = valuesFor("rent_budget")[0];
  const generic = valuesFor("budget")[0];
  const selected = intent === "Buy" ? purchase ?? generic : monthly ?? generic;
  if (intent === "Buy" && monthly) notes.push(`Monthly rental answer “${monthly.value}” was kept with the form answers and not stored as the purchase budget.`);
  if (intent === "Rent" && purchase) notes.push(`Purchase answer “${purchase.value}” was kept with the form answers and not stored as the monthly rent.`);
  const budget = selected ? parseMoney(selected.value) : { min: null, max: null };
  if (selected && budget.min === null && budget.max === null) unparsed(intent === "Buy" ? "Purchase budget" : "Monthly rent", selected.value);
  const [budgetMin, budgetMax] =
    budget.min !== null && budget.max !== null && budget.min > budget.max ? [budget.max, budget.min] : [budget.min, budget.max];
  const budgetBasis = intent === "Buy" ? "purchase" : "monthly";
  notes.unshift(
    `Recorded as ${intent === "Buy" ? "a purchase" : "a monthly rent"}${answerText ? `, from “${labelFor(form, questionKey) || questionKey}” = ${answerText}` : ""}. Budget stored: ${budgetBasis}${selected ? ` from “${selected.label}”` : ", none answered"}.`,
  );

  return {
    kind: intent === "Rent" ? "tenant" : "buyer",
    contact,
    decision: {
      intent,
      basis,
      questionKey,
      answer: answerText,
      budgetBasis,
      budgetKey: selected?.key ?? "",
      decidedBy: basis === "staff" ? choice.decidedBy ?? "" : "",
    },
    requirement: {
      intent,
      propertyTypes: propertyType ? [propertyType] : [],
      bhkMin: bhk.min,
      bhkMax: bhk.max,
      budgetMin,
      budgetMax,
      localities,
      localityFlexible: localities.length === 0,
      areaMin: null,
      furnishing: "Any",
      tenantProfile: "Any",
      vegetarian: "Any",
      parkingRequired: false,
      timeline: timeline ?? "Exploring",
      neededBy: null,
      notes: notes.join("\n").slice(0, 4000),
    },
    answers,
    unmapped,
    problems,
  };
}
