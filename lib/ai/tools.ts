import { tool } from "ai";
import { z } from "zod";
import { searchInternetForProjectInformation } from "../collection/internet-search";

export const projectInformationSearchTool = tool({
  description:
    "Search the public internet for project, building, property, location, developer, or other real-estate context. " +
    "All returned evidence is Tier 2 / unconfirmed and must not be treated as verified fact.",
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .describe("Search query for the needed project, building, property, location, developer, or related context."),
    purpose: z
      .string()
      .min(1)
      .optional()
      .describe("Why this information is needed, e.g. entity resolution, wiki grounding, or review context."),
    limit: z.number().int().min(1).max(10).optional().describe("Maximum results to return. Defaults to 5."),
  }),
  execute: async ({ query, purpose, limit }) => {
    return searchInternetForProjectInformation({ query, purpose, limit });
  },
});

export const dwellingFeeTools = {
  projectInformationSearch: projectInformationSearchTool,
};
