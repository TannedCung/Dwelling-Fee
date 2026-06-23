import { FunctionTool } from "@google/adk";
import { z } from "zod";
import { researchProjectInformation } from "../ingest/research";
import { projectInformationResearchAdkSchema } from "./adk-schema";

const ProjectInformationResearchInput = z.object({
  query: z
    .string()
    .min(1)
    .describe("Same-language project/building research query. Include project and building names when known."),
  purpose: z
    .string()
    .min(1)
    .optional()
    .describe("Why this research is needed, e.g. entity disambiguation or Tier 2 project curation."),
});

export const projectInformationResearchMcp = {
  name: "research_project_information",
  description:
    "Search existing DB records and the public internet for project/building context only. " +
    "Use this when the main ingest agent needs more information to identify, disambiguate, or curate a project/building. " +
    "This is especially useful when a broker message names a project, building, tower, block, compound, or development alias and the agent should ground that context before asking the user for clarification. " +
    "Returned internet evidence is Tier 2 / unconfirmed and must not be treated as verified fact. " +
    "Do not use it for sale/rent listing facts such as price, unit area, bedrooms, floor, balcony direction, or fees.",
  inputSchema: ProjectInformationResearchInput,
  execute: async (input: z.infer<typeof ProjectInformationResearchInput>) => {
    const research = await researchProjectInformation(
      input.query,
      input.purpose ?? "main ingest agent requested project/building context",
    );
    return {
      query: research.query,
      dbMatches: research.dbMatches,
      internet: research.internet,
      debug: research.debug,
    };
  },
};

export function adkProjectInformationResearchTool(): FunctionTool {
  return new FunctionTool({
    name: projectInformationResearchMcp.name,
    description: projectInformationResearchMcp.description,
    parameters: projectInformationResearchAdkSchema,
    execute: async (raw) => projectInformationResearchMcp.execute(ProjectInformationResearchInput.parse(raw)),
  });
}
