---
name: housing-extraction-quality
description: Guidelines, quality standards, and dictionary for extracting structured real-estate facts from Vietnamese broker chatter and web listings. Covers terminology, completeness standards, rejection criteria for poor information observations, and entity hierarchy extraction.
---

# Housing Extraction Quality & Information Gate

This skill provides domain knowledge and rules for extracting structured housing facts from raw real estate text (broker chat, listings, social posts) and filtering out low-quality/poor-information observations.

---

## 1. Vietnamese Real Estate Shorthand Dictionary

| Term / Abbreviation | Meaning | Extracted Field | Example / Rule |
| --- | --- | --- | --- |
| `tỷ`, `tỉ` | Billion VND (1,000,000,000) | `priceVnd = amount * 1e9` | "3.2 tỷ" -> `3200000000` |
| `triệu`, `tr` | Million VND (1,000,000) | `priceVnd = amount * 1e6` | "18 triệu" -> `18000000` |
| `TL`, `thương lượng`, `thỏa thuận` | Price negotiable | `isNegotiable = true` | "15 tỷ TL" -> `isNegotiable = true` |
| `PN`, `phòng ngủ` | Bedrooms | `bedrooms = count` | "2PN" -> `bedrooms = 2` |
| `m2`, `m²`, `sqm` | Area in square meters | `areaM2 = amount` | "60m2" -> `areaM2 = 60` |
| `/m2`, `/m²`, `1m2` | Price quoted per m² | `priceBasis = "per_m2"` | "80 triệu/m2" -> `priceBasis = "per_m2"` |
| `cho thuê`, `cho thue` | Rental listing | `listingType = "rent"` | "Cho thuê căn 2PN" |
| `bán`, `cần bán`, `bán gấp` | Sale listing | `listingType = "sale"` | "Bán gấp căn 3PN" |
| `đã bán`, `chốt`, `sold` | Transacted deal | `dealStatus = "transacted"` | "Đã chốt căn 2PN 4.1 tỷ" |
| `sổ hồng`, `SHR`, `sổ đỏ`, `HĐMB` | Title / Contract note | `tags` | Put in `tags` (e.g. `["sổ hồng"]`). Does NOT change price fields. |
| `3.6x tỷ`, `3,6x tỉ` | Masked approximate price | `priceVnd = 3600000000`, lower confidence | Store lower-bound figure, lower confidence score. |

---

## 2. Rejection Rules: What NOT to Extract

Return an **empty array** (`properties: []`) or reject the candidate observation when encountering:

1. **Buying / Seeking Inquiries**:
   - `Cần mua`, `Tìm mua`, `Cần thuê`, `Seeking to buy/rent`, `Tài chính 3 tỷ cần tìm căn 2PN` -> **NOT** an offer/listing.
2. **General / Non-Actionable Posts**:
   - Recruitment (`Tuyển dụng môi giới`), broker promos without specific property specs, general market discussions, greeting messages.
3. **Generic Ads Without Specs**:
   - "Bán dự án ABC giá liên hệ" (no price, no area, no specific unit/house).
4. **Unusable Partial Information**:
   - Missing BOTH `priceVnd` AND `areaM2`.
   - Missing property/location identity completely.

---

## 3. Mandatory Quality Standards for Observations

A candidate property observation is **USABLE** and saved into `price_observation` ONLY if it meets ALL of the following criteria:

- **Price OR Area**: Must have a valid `priceVnd` or a valid `areaM2` (for a sales/rent offer).
- **Listing Type**: `listingType` must be `"sale"` or `"rent"` (`"unknown"` is rejected).
- **Identity**: `hasIdentity()` must return `true` (has `projectName`, `name`, or `locationText`).
- **Confidence**: `confidence` must be `>= 0.40`.

---

## 4. Entity Hierarchy Extraction Rules

Structure identity cleanly into:
- `projectName`: Root development/neighborhood name (e.g. "Vinhomes Grand Park", "Masteri Thảo Điền"). Strip category prefixes like "nhà phố", "shophouse", "căn hộ".
- `buildingName`: Block/tower/phase (e.g. "Block A", "Tòa S1", "Tháp T2").
- `houseNumber`: Specific unit/apartment/house number (e.g. "A1204", "LK-12", "Căn 05").
- `name`: Clean display name combining the hierarchy (e.g. "Masteri Thảo Điền / Block A / A1204").
