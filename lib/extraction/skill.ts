/**
 * Domain Skill for Housing Price Collection & Ingest Agent.
 *
 * This skill is loaded into the LLM system prompts of both the one-shot/web collection
 * extractor (lib/extraction/extract.ts) and the interactive ingest agent (lib/ingest/agent.ts).
 */

export const HOUSING_EXTRACTION_SKILL = `
[SKILL: HOUSING_EXTRACTION_QUALITY_GATE]

1. VIETNAMESE REAL-ESTATE SHORTHAND & TERMINOLOGY:
- Price units: "tỷ"/"tỉ" = 1,000,000,000 VND; "triệu"/"tr" = 1,000,000 VND (e.g. "4.5 tỷ" -> 4,500,000,000 VND; "18tr" -> 18,000,000 VND).
- Approximate/masked prices: "3.6x tỷ" or "3,6x tỉ" mean a low-precision total price near that amount. Store lower-bound figure (3600000000) and lower confidence.
- Negotiable: "TL", "thương lượng", "thỏa thuận" -> isNegotiable=true.
- Bedrooms: "PN", "phòng ngủ" -> bedrooms count (e.g. "2PN" -> bedrooms=2).
- Area: "m2", "m²", "sqm" -> areaM2.
- Price basis: "/m2", "/m²", "1m2" alongside a price -> priceBasis="per_m2", otherwise "total".
- Listing types: "cho thuê" -> rent; "bán", "cần bán", "bán gấp" -> sale.
- Deal status: "đã bán", "chốt", "sold" -> transacted; active listing -> asking.
- Title & legal notes: "sổ hồng", "SHR", "sổ đỏ", "HĐMB" -> store in tags (e.g. ["sổ hồng"]); does not change price fields.

2. REJECTION & QUALITY GATE (WHEN TO RETURN EMPTY properties: []):
- BUYER / SEEKING REQUESTS: "Cần mua", "Tìm mua", "Cần thuê", "Tài chính X tỷ cần tìm căn Y", "Looking for 2PN". These are buyer demands, NOT property offers or market observations. Return properties: [].
- RECRUITMENT & ADS: Broker hiring ("Tuyển dụng môi giới"), generic agency promos, market commentary, or general project greetings ("Chào cả nhà") without specific property specs. Return properties: [].
- UNUSABLE PARTIAL DATA: Posts mentioning a property name but providing NEITHER price nor area nor actionable listing details. Return properties: [].

3. ENTITY HIERARCHY SEPARATION:
- projectName = root project/development name (e.g. "Vinhomes Grand Park", "Masteri Thảo Điền"). Strip category prefixes like "nhà phố", "shophouse", "căn hộ".
- buildingName = block/tower/phase (e.g. "Block A", "Tòa S1").
- houseNumber = unit/apartment/lot number (e.g. "A1204", "LK-12", "Căn 05").
- name = combined display name (e.g. "Masteri Thảo Điền / Block A / A1204").
- Treat generic unit labels like "Căn 1" or "lô 5" as houseNumber, NOT standalone property names. Put category words ("nhà phố", "shophouse") in tags.
- For apartments, project/building alone is context. If unit is absent, keep projectName/buildingName and lower confidence; do not invent unit numbers.
`.trim();
