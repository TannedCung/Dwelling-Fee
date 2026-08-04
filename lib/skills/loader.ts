import fs from "node:fs/promises";
import path from "node:path";

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  filePath: string;
}

export interface LoadedSkill extends SkillInfo {
  content: string;
}

const SKILLS_DIR = path.join(process.cwd(), "skills");

/**
 * Parses simple YAML frontmatter (between --- markers) at the start of a markdown file.
 */
function parseFrontmatter(rawContent: string): { meta: Record<string, string>; body: string } {
  const lines = rawContent.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { meta: {}, body: rawContent };
  }

  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      endIdx = i;
      break;
    }
  }

  if (endIdx === -1) {
    return { meta: {}, body: rawContent };
  }

  const meta: Record<string, string> = {};
  for (let i = 1; i < endIdx; i++) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith("#")) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      meta[key] = val;
    }
  }

  const body = lines.slice(endIdx + 1).join("\n").trim();
  return { meta, body };
}

/**
 * Scans the `skills/` directory and returns metadata for all available text skill files.
 */
export async function listAvailableSkills(): Promise<SkillInfo[]> {
  try {
    const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
    const skills: SkillInfo[] = [];

    for (const entry of entries) {
      let filePath: string | null = null;
      let id = entry.name;

      if (entry.isDirectory()) {
        const candidate = path.join(SKILLS_DIR, entry.name, "SKILL.md");
        try {
          await fs.access(candidate);
          filePath = candidate;
        } catch {
          // directory without SKILL.md -> skip
          continue;
        }
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        filePath = path.join(SKILLS_DIR, entry.name);
        id = entry.name.slice(0, -3);
      }

      if (!filePath) continue;

      try {
        const raw = await fs.readFile(filePath, "utf-8");
        const { meta } = parseFrontmatter(raw);
        skills.push({
          id,
          name: meta.name || id,
          description: meta.description || "",
          filePath,
        });
      } catch {
        // Unreadable file -> skip
      }
    }

    return skills;
  } catch {
    return [];
  }
}

/**
 * Loads a single skill by ID or name from its .md text file on disk.
 */
export async function loadSkill(skillId: string): Promise<LoadedSkill | null> {
  const skills = await listAvailableSkills();
  const match = skills.find((s) => s.id === skillId || s.name === skillId);
  if (!match) return null;

  try {
    const raw = await fs.readFile(match.filePath, "utf-8");
    const { meta, body } = parseFrontmatter(raw);
    return {
      ...match,
      name: meta.name || match.name,
      description: meta.description || match.description,
      content: body,
    };
  } catch {
    return null;
  }
}

/**
 * Agent Skill Selection: Analyzes the task/text context and selects the appropriate skill(s) to load.
 */
export async function selectSkillsForTask(context: {
  text?: string;
  taskType?: string;
}): Promise<LoadedSkill[]> {
  const available = await listAvailableSkills();
  if (available.length === 0) return [];

  const selectedIds: string[] = [];
  const textLower = (context.text || "").toLowerCase();
  const taskLower = (context.taskType || "").toLowerCase();

  for (const s of available) {
    const descLower = s.description.toLowerCase();
    const nameLower = s.name.toLowerCase();

    // Default match for real estate extraction / collection tasks
    if (
      nameLower.includes("housing") ||
      nameLower.includes("real-estate") ||
      nameLower.includes("extraction") ||
      descLower.includes("real-estate") ||
      descLower.includes("broker")
    ) {
      if (
        taskLower.includes("extract") ||
        taskLower.includes("collect") ||
        taskLower.includes("ingest") ||
        !context.taskType || // default for ingest pipeline
        textLower.includes("bán") ||
        textLower.includes("thuê") ||
        textLower.includes("tỷ") ||
        textLower.includes("tr") ||
        textLower.includes("m2")
      ) {
        selectedIds.push(s.id);
      }
    }
  }

  // Fallback: if no match, load default housing extraction skill if present
  if (selectedIds.length === 0 && available.some((s) => s.id === "housing-extraction-quality")) {
    selectedIds.push("housing-extraction-quality");
  }

  const loaded: LoadedSkill[] = [];
  for (const id of selectedIds) {
    const skill = await loadSkill(id);
    if (skill) loaded.push(skill);
  }
  return loaded;
}

/**
 * Utility to assemble prompt instructions for the selected skills for an agent task.
 */
export async function buildSkillPromptInstructions(context: {
  text?: string;
  taskType?: string;
}): Promise<string> {
  const selected = await selectSkillsForTask(context);
  if (selected.length === 0) return "";

  return selected
    .map((s) => `[LOADED SKILL: ${s.name}]\n${s.content}`)
    .join("\n\n---\n\n");
}
