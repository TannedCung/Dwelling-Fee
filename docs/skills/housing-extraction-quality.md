# Housing Extraction Quality Skill (Application Collect Agent)

> Source module: `lib/extraction/skill.ts`
> Loaded by: `lib/extraction/extract.ts` and `lib/ingest/agent.ts`

This domain skill defines the collection rules, terminology dictionary, rejection criteria, and entity hierarchy separation for our application's **collect agent** and **ingest agent**.

---

## 1. Vietnamese Real-Estate Shorthand Dictionary

- **Price Units**: `tỷ`/`tỉ` = 1,000,000,000 VND; `triệu`/`tr` = 1,000,000 VND.
- **Approximate Masked Prices**: `3.6x tỷ` or `3,6x tỉ` mean a low-precision total price near that amount. Store lower-bound figure (3,600,000,000 VND) and lower confidence.
- **Negotiable**: `TL`, `thương lượng`, `thỏa thuận` -> `isNegotiable = true`.
- **Bedrooms**: `PN`, `phòng ngủ` -> `bedrooms` count.
- **Area**: `m2`, `m²`, `sqm` -> `areaM2`.
- **Price Basis**: `/m2`, `/m²`, `1m2` alongside a price -> `priceBasis = "per_m2"`, otherwise `"total"`.
- **Listing Types**: `cho thuê` -> `rent`; `bán`, `cần bán`, `bán gấp` -> `sale`.
- **Deal Status**: `đã bán`, `chốt`, `sold` -> `transacted`; active listing -> `asking`.
- **Title / Legal**: `sổ hồng`, `SHR`, `sổ đỏ`, `HĐMB` -> stored in `tags`.

---

## 2. Rejection & Quality Gate (Return `properties: []`)

1. **Buyer / Seeking Requests**: `Cần mua`, `Tìm mua`, `Cần thuê`, `Tài chính X tỷ cần tìm căn Y`, `Looking for 2PN`. These are buyer demands, NOT property offers or market observations. Return `properties: []`.
2. **Recruitment & Ads**: Broker hiring, generic agency promos, market commentary, or general project greetings (`Chào cả nhà`) without specific property specs. Return `properties: []`.
3. **Unusable Partial Data**: Posts mentioning a property name but providing NEITHER price nor area nor actionable listing details. Return `properties: []`.

---

## 3. Entity Hierarchy Separation

- `projectName`: Root development name (e.g. "Vinhomes Grand Park", "Masteri Thảo Điền"). Strip category prefixes like "nhà phố", "shophouse", "căn hộ".
- `buildingName`: Block/tower/phase (e.g. "Block A", "Tòa S1").
- `houseNumber`: Unit/apartment/lot number (e.g. "A1204", "LK-12", "Căn 05").
- `name`: Combined display name (e.g. "Masteri Thảo Điền / Block A / A1204").
