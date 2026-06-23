import { Type, type Schema } from "@google/genai";

const nullableString: Schema = { type: Type.STRING, nullable: true };

const stringArray: Schema = {
  type: Type.ARRAY,
  items: { type: Type.STRING },
};

const propertyExtractionSchema: Schema = {
  type: Type.OBJECT,
  required: [
    "name",
    "projectName",
    "buildingName",
    "houseNumber",
    "aliases",
    "tags",
    "type",
    "listingType",
    "priceVnd",
    "priceBasis",
    "areaM2",
    "bedrooms",
    "isNegotiable",
    "dealStatus",
    "locationText",
    "confidence",
  ],
  properties: {
    name: nullableString,
    projectName: nullableString,
    buildingName: nullableString,
    houseNumber: nullableString,
    aliases: stringArray,
    tags: stringArray,
    type: { type: Type.STRING, enum: ["apartment", "house", "project", "land", "unknown"], format: "enum" },
    listingType: { type: Type.STRING, enum: ["sale", "rent", "unknown"], format: "enum" },
    priceVnd: { type: Type.INTEGER, nullable: true },
    priceBasis: { type: Type.STRING, enum: ["total", "per_m2", "unknown"], format: "enum" },
    areaM2: { type: Type.NUMBER, nullable: true },
    bedrooms: { type: Type.INTEGER, nullable: true },
    isNegotiable: { type: Type.BOOLEAN },
    dealStatus: { type: Type.STRING, enum: ["asking", "transacted", "unknown"], format: "enum" },
    locationText: nullableString,
    confidence: { type: Type.NUMBER, minimum: 0, maximum: 1 },
  },
};

const tier2EvidenceSchema: Schema = {
  type: Type.OBJECT,
  required: ["title", "url", "snippet", "source", "tier"],
  properties: {
    title: { type: Type.STRING },
    url: { type: Type.STRING },
    snippet: { type: Type.STRING },
    source: { type: Type.STRING },
    tier: { type: Type.STRING, enum: ["tier_2_unconfirmed"], format: "enum" },
  },
};

const projectFactSchema: Schema = {
  type: Type.OBJECT,
  required: ["key", "value", "appliesTo"],
  properties: {
    key: { type: Type.STRING },
    value: { type: Type.STRING },
    appliesTo: { type: Type.STRING, enum: ["project", "building"], format: "enum" },
  },
};

const projectCurationDraftSchema: Schema = {
  type: Type.OBJECT,
  required: [
    "projectName",
    "buildingName",
    "aliases",
    "tags",
    "addressText",
    "wikiNotes",
    "facts",
    "evidence",
    "searchQuery",
    "model",
  ],
  properties: {
    projectName: nullableString,
    buildingName: nullableString,
    aliases: stringArray,
    tags: stringArray,
    addressText: nullableString,
    wikiNotes: nullableString,
    facts: { type: Type.ARRAY, items: projectFactSchema },
    evidence: { type: Type.ARRAY, items: tier2EvidenceSchema },
    searchQuery: nullableString,
    model: { type: Type.STRING },
  },
};

export const draftTurnAdkSchema: Schema = {
  type: Type.OBJECT,
  required: ["reply", "properties", "projectCuration", "readyToCommit"],
  properties: {
    reply: {
      type: Type.STRING,
      description: "Short user-facing reply in the user's preferred language.",
    },
    properties: {
      type: Type.ARRAY,
      items: propertyExtractionSchema,
    },
    projectCuration: {
      type: Type.ARRAY,
      items: projectCurationDraftSchema,
    },
    readyToCommit: { type: Type.BOOLEAN },
  },
};

export const projectInformationResearchAdkSchema: Schema = {
  type: Type.OBJECT,
  required: ["query"],
  properties: {
    query: {
      type: Type.STRING,
      description: "Same-language project/building research query. Include project and building names when known.",
    },
    purpose: {
      type: Type.STRING,
      nullable: true,
      description: "Why this research is needed, e.g. entity disambiguation or Tier 2 project curation.",
    },
  },
};
