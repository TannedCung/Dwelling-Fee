import { test } from "node:test";
import assert from "node:assert/strict";
import { researchProjectInformation } from "./research";

test("researchProjectInformation uses the agent-provided query without rewrite", async () => {
  const previous = process.env.BRAVE_SEARCH_API_KEY;
  delete process.env.BRAVE_SEARCH_API_KEY;
  let calls = 0;
  const chain = {
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    limit: async () => {
      calls++;
      return [];
    },
  };
  const db = {
    select: () => chain,
  } as never;

  const result = await researchProjectInformation("Ecopark Park Premium mặt bằng tòa", "test", db);
  if (previous === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
  else process.env.BRAVE_SEARCH_API_KEY = previous;

  assert.equal(result.query, "Ecopark Park Premium mặt bằng tòa");
  assert.equal(result.internet?.query, "Ecopark Park Premium mặt bằng tòa");
  assert.equal(calls, 3);
  assert.match(result.internet?.warnings[0] ?? "", /BRAVE_SEARCH_API_KEY/);
});
