import { test } from "node:test";
import assert from "node:assert/strict";
import { listAvailableSkills, loadSkill, selectSkillsForTask, buildSkillPromptInstructions } from "./loader";

test("listAvailableSkills: finds skills in skills/ directory", async () => {
  const skills = await listAvailableSkills();
  assert.ok(skills.length > 0, "should find at least one skill");
  assert.ok(skills.some((s) => s.id === "housing-extraction-quality"));
});

test("loadSkill: loads text content from .md file", async () => {
  const skill = await loadSkill("housing-extraction-quality");
  assert.ok(skill !== null);
  assert.equal(skill.id, "housing-extraction-quality");
  assert.ok(skill.content.includes("Vietnamese Real Estate Shorthand Dictionary"));
});

test("selectSkillsForTask: dynamically selects skills based on task context", async () => {
  const selected = await selectSkillsForTask({ taskType: "extraction", text: "Bán căn 2PN Vinhomes Q9 3.2 tỷ" });
  assert.ok(selected.length > 0);
  assert.equal(selected[0]?.id, "housing-extraction-quality");
});

test("buildSkillPromptInstructions: formats loaded skill text into system instruction block", async () => {
  const prompt = await buildSkillPromptInstructions({ taskType: "extraction" });
  assert.ok(prompt.includes("[LOADED SKILL: housing-extraction-quality]"));
  assert.ok(prompt.includes("Rejection Rules"));
});
