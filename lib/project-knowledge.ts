import type { PropertyExtraction } from "./extraction/schema";
import { normalizeName, uniqueText } from "./text";

export interface ProjectProfile {
  canonicalName: string;
  aliases: string[];
  phaseTags: string[];
  wikiNotes: string;
}

const PROJECT_PROFILES: ProjectProfile[] = [
  {
    canonicalName: "Lumi",
    aliases: [
      "Lumi",
      "Lumi Hanoi",
      "Lumi Hà Nội",
      "Lumi Hanoi CapitalLand",
      "Lumi CapitalLand",
      "Lumi Signature",
      "Lumi Prestige",
      "Lumi Elite",
    ],
    phaseTags: ["signature", "prestige", "elite"],
    wikiNotes:
      "Lumi Hanoi is a CapitaLand residential project in Tay Mo, Nam Tu Liem, Hanoi. Public project material describes Lumi Signature, Lumi Prestige, and Lumi Elite as phases/subzones under the Lumi Hanoi project; unit/tower labels such as S3, Elite, and apartment numbers should remain observation-level details, not separate canonical properties. Sources: https://www.capitaland.com/sites/lumihanoi/en/ ; https://www.capitaland.com/sites/lumihanoi/en/lumi-signature/",
  },
];

export function projectProfileForExtraction(extraction: PropertyExtraction): ProjectProfile | null {
  const haystack = [
    extraction.projectName,
    extraction.name,
    extraction.locationText,
    extraction.buildingName,
    ...extraction.aliases,
  ].map((value) => normalizeName(value ?? ""));

  for (const profile of PROJECT_PROFILES) {
    const aliasKeys = profile.aliases.map(normalizeName);
    if (haystack.some((value) => aliasKeys.some((alias) => value === alias || value.includes(alias)))) {
      return profile;
    }
  }
  return null;
}

export function projectScopedIdentity(extraction: PropertyExtraction): PropertyExtraction {
  const profile = projectProfileForExtraction(extraction);
  if (!profile || extraction.type !== "apartment") return extraction;

  const observedName = extraction.projectName ?? extraction.name;
  const phaseTags = profile.phaseTags.filter((tag) =>
    [extraction.projectName, extraction.name, extraction.buildingName, extraction.locationText]
      .some((value) => normalizeName(value ?? "").includes(tag)),
  );

  return {
    ...extraction,
    name: profile.canonicalName,
    projectName: profile.canonicalName,
    buildingName: null,
    houseNumber: null,
    aliases: uniqueText([
      observedName,
      extraction.locationText,
      extraction.buildingName ? `${profile.canonicalName} ${extraction.buildingName}` : null,
      ...profile.aliases,
      ...extraction.aliases,
    ]),
    tags: uniqueText([...extraction.tags, ...phaseTags]),
  };
}

export function wikiNotesForExtraction(extraction: PropertyExtraction): string | null {
  return projectProfileForExtraction(extraction)?.wikiNotes ?? null;
}
