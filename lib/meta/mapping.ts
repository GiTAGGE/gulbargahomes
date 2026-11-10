import type { ContactInput } from "../crm/contacts";
import { OWNER_INTENTS, type OwnerIntent } from "../crm/options";
import type { OwnerLeadInput } from "../crm/owner-leads";
import type { RequirementInput } from "../crm/requirements";
import { canonicalLocalityName } from "../locality";
import type { MetaLead, MetaQuestion } from "./graph";
import {
  cleanAnswer,
  parseBhk,
  parseDemandIntent,
  parseMoney,
  parseOwnerIntent,
  parsePropertyType,
  parseTimeline,
  splitLocalities,
} from "./values";

export const FORM_CLASSIFICATIONS = ["unclassified", "owner", "tenant", "buyer", "ignore"] as const;
export type FormClassification = (typeof FORM_CLASSIFICATIONS)[number];

export const CLASSIFICATION_LABEL: Record<FormClassification, string> = {
  unclassified: "Not classified",
  owner: "Owner property enquiry → owner lead",
  tenant: "Tenant requirement → rental demand",
  buyer: "Buyer requirement → purchase demand",
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
  budget: "Budget",
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

/** A starting point from question types and wording. Admins confirm or change it. */
export function suggestTarget(question: MetaQuestion, classification: FormClassification): MappingTarget {
  const byType = TYPE_TARGET[question.type];
  if (byType) return byType;
  const byKey = STANDARD_KEYS[question.key];
  if (byKey) return byKey;
  const text = `${question.key} ${question.label}`.toLowerCase().replace(/_/g, " ");
  if (/\b(bhk|bedroom|bed room)/.test(text)) return "bhk";
  if (/(rent or (sale|sell|buy)|sell or rent|buy or rent|looking to|purpose|want to (rent|sell|buy))/.test(text)) return "intent";
  if (/(property type|type of property|kind of property|what type)/.test(text)) return "property_type";
  if (/(budget|price range|how much)/.test(text)) return classification === "owner" ? "expected_price" : "budget";
  if (/(expected (rent|price)|asking|rent amount|selling price)/.test(text)) return "expected_price";
  if (/(locat|locality|area|where|address|road|colony)/.test(text)) return "locality";
  if (/(when|timeline|how soon|move|shift|possession)/.test(text)) return "timeline";
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

export type MappedLead =
  | {
      kind: "owner";
      contact: ContactInput;
      owner: OwnerLeadInput;
      answers: MappedAnswer[];
      unmapped: MappedAnswer[];
      problems: string[];
    }
  | {
      kind: "tenant" | "buyer";
      contact: ContactInput;
      requirement: RequirementInput;
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

/** Turns one Meta lead into CRM input using the form's mapping. Every answer is kept. */
export function mapLead(form: MappedForm, lead: MetaLead): MappedLead {
  if (form.classification !== "owner" && form.classification !== "tenant" && form.classification !== "buyer") {
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

  if (form.classification === "owner") {
    let intent = intentAnswer ? parseOwnerIntent(intentAnswer) : null;
    if (intentAnswer && !intent) unparsed("Rent or sale", intentAnswer);
    if (!intent) {
      intent = (OWNER_INTENTS as readonly string[]).includes(form.ownerIntent) ? (form.ownerIntent as OwnerIntent) : "Rent";
      if (!form.ownerIntent) notes.push("Rent or sale was not on the form. Confirm it on the call.");
    }
    const priceAnswer = first("expected_price") || first("budget");
    const price = priceAnswer ? parseMoney(priceAnswer) : { min: null, max: null };
    if (priceAnswer && price.max === null && price.min === null) unparsed("Expected price", priceAnswer);
    return {
      kind: "owner",
      contact,
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

  const intent = form.classification === "tenant" ? "Rent" : "Buy";
  if (intentAnswer) {
    const answered = parseDemandIntent(intentAnswer);
    if (answered && answered !== intent) notes.push(`Answered “${intentAnswer}” on a ${form.classification} form. Confirm on the call.`);
  }
  const budgetAnswer = first("budget");
  const budget = budgetAnswer ? parseMoney(budgetAnswer) : { min: null, max: null };
  if (budgetAnswer && budget.min === null && budget.max === null) unparsed("Budget", budgetAnswer);
  const [budgetMin, budgetMax] =
    budget.min !== null && budget.max !== null && budget.min > budget.max ? [budget.max, budget.min] : [budget.min, budget.max];

  return {
    kind: form.classification,
    contact,
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
