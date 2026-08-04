import type { PropertyExtraction } from "../lib/extraction/schema";

/**
 * Golden evaluation set for the extraction spike (docs/design.md Phase 0).
 *
 * These are SYNTHETIC messages that imitate real broker shorthand (VI/EN, abbreviations,
 * multi-property, noise). Replace/expand with ~100 real collected messages before trusting
 * the accuracy numbers — synthetic data flatters the model.
 *
 * `expected` lists only the fields we assert on. `name`/`locationText` are scored as a
 * loose substring match (too fuzzy for exact equality); `confidence` is not scored.
 */
export type Golden = Pick<
  PropertyExtraction,
  "type" | "listingType" | "priceVnd" | "priceBasis" | "areaM2" | "bedrooms" | "isNegotiable" | "dealStatus"
> & { locationContains?: string };

export interface Case {
  id: string;
  text: string;
  expected: Golden[];
}

export const DATASET: Case[] = [
  {
    id: "sale-apartment-basic",
    text: "Bán căn hộ Vinhomes Grand Park Q9, 2PN 60m2, giá 3.2 tỷ, sổ hồng đầy đủ. LH chính chủ.",
    expected: [
      { type: "apartment", listingType: "sale", priceVnd: 3_200_000_000, priceBasis: "total", areaM2: 60, bedrooms: 2, isNegotiable: false, dealStatus: "asking", locationContains: "Q9" },
    ],
  },
  {
    id: "rent-negotiable",
    text: "Cho thuê chung cư Masteri Thảo Điền 2 phòng ngủ, 70m2, 18 triệu/tháng, TL nhẹ cho khách thiện chí.",
    expected: [
      { type: "apartment", listingType: "rent", priceVnd: 18_000_000, priceBasis: "total", areaM2: 70, bedrooms: 2, isNegotiable: true, dealStatus: "asking", locationContains: "Masteri" },
    ],
  },
  {
    id: "land-per-m2",
    text: "Cần bán lô đất mặt tiền đường Nguyễn Văn Linh, 100m2, giá 80 triệu/m2, thương lượng.",
    expected: [
      { type: "land", listingType: "sale", priceVnd: 80_000_000, priceBasis: "per_m2", areaM2: 100, bedrooms: null, isNegotiable: true, dealStatus: "asking", locationContains: "Nguyễn Văn Linh" },
    ],
  },
  {
    id: "multi-property",
    text: "Giỏ hàng hôm nay:\n1) Sunrise City Q7, 3PN 100m2, 5.5 tỷ\n2) Phú Mỹ Hưng nhà phố 5x20, 15 tỷ TL\nAi quan tâm ib em.",
    expected: [
      { type: "apartment", listingType: "sale", priceVnd: 5_500_000_000, priceBasis: "total", areaM2: 100, bedrooms: 3, isNegotiable: false, dealStatus: "asking", locationContains: "Q7" },
      { type: "house", listingType: "sale", priceVnd: 15_000_000_000, priceBasis: "total", areaM2: null, bedrooms: null, isNegotiable: true, dealStatus: "asking", locationContains: "Phú Mỹ Hưng" },
    ],
  },
  {
    id: "transacted",
    text: "Đã chốt căn 2PN The Sun Avenue 72m2 giá 4.1 tỷ tuần trước. Cảm ơn anh chị đã tin tưởng!",
    expected: [
      { type: "apartment", listingType: "sale", priceVnd: 4_100_000_000, priceBasis: "total", areaM2: 72, bedrooms: 2, isNegotiable: false, dealStatus: "transacted", locationContains: "Sun Avenue" },
    ],
  },
  {
    id: "english-mixed",
    text: "FOR SALE: 3BR apartment at Estella Heights, 115 sqm, asking 8.2 billion VND, slightly negotiable.",
    expected: [
      { type: "apartment", listingType: "sale", priceVnd: 8_200_000_000, priceBasis: "total", areaM2: 115, bedrooms: 3, isNegotiable: true, dealStatus: "asking", locationContains: "Estella" },
    ],
  },
  {
    id: "missing-price",
    text: "Còn duy nhất 1 căn 1PN view sông tại Vinhomes Central Park, diện tích 50m2. Inbox giá nhé!",
    expected: [
      { type: "apartment", listingType: "sale", priceVnd: null, priceBasis: "unknown", areaM2: 50, bedrooms: 1, isNegotiable: false, dealStatus: "asking", locationContains: "Central Park" },
    ],
  },
  {
    id: "noisy-screenshot",
    text: "📞0909xxxxxx ‼️HOT‼️ bán gấp nhà hẻm Bình Thạnh 4x15 = 60m2, 6ty5, shr, hỗ trợ vay 70%.",
    expected: [
      { type: "house", listingType: "sale", priceVnd: 6_500_000_000, priceBasis: "total", areaM2: 60, bedrooms: null, isNegotiable: false, dealStatus: "asking", locationContains: "Bình Thạnh" },
    ],
  },
  {
    id: "trieu-shorthand",
    text: "Cho thuê phòng trọ Q.Gò Vấp 25m2 giá 4tr5/tháng, có gác.",
    expected: [
      { type: "apartment", listingType: "rent", priceVnd: 4_500_000, priceBasis: "total", areaM2: 25, bedrooms: null, isNegotiable: false, dealStatus: "asking", locationContains: "Gò Vấp" },
    ],
  },
  {
    id: "no-property",
    text: "Chào buổi sáng cả nhà, chúc mọi người một ngày làm việc hiệu quả nhé! 🌞",
    expected: [],
  },
  {
    id: "buying-request-1",
    text: "Cần mua gấp căn hộ 2PN Vinhomes Grand Park Q9 tài chính 3.5 tỷ đổ lại. Sổ hồng sang tên ngay. Inbox em!",
    expected: [],
  },
  {
    id: "buying-request-2",
    text: "Khách em tìm thuê căn 1PN Masteri An Phú full nội thất tài chính 14tr/tháng. Chính chủ nhắn em nhé.",
    expected: [],
  },
  {
    id: "broker-recruitment",
    text: "Tuyển dụng 5 nhân viên kinh doanh bất động sản khu vực Quận 2, hoa hồng hấp dẫn 60%, hỗ trợ data hot.",
    expected: [],
  },
  {
    id: "vague-project-promo",
    text: "Siêu siêu phẩm căn hộ cao cấp chuẩn Nhật Bản trung tâm Q7. Liên hệ hotline 0909xxxxxx để chọn căn đẹp!",
    expected: [],
  },
  {
    id: "masked-price",
    text: "Bán căn 2PN Ecopark Park Premium 58m2 giá 3.6x tỷ, view nội khu mát mẻ.",
    expected: [
      { type: "apartment", listingType: "sale", priceVnd: 3_600_000_000, priceBasis: "total", areaM2: 58, bedrooms: 2, isNegotiable: false, dealStatus: "asking", locationContains: "Ecopark" },
    ],
  },
  {
    id: "shophouse-sale",
    text: "Bán shophouse khối đế Masteri Thảo Điền 120m2 giá 18.5 tỷ, đang có hợp đồng thuê sẵn.",
    expected: [
      { type: "apartment", listingType: "sale", priceVnd: 18_500_000_000, priceBasis: "total", areaM2: 120, bedrooms: null, isNegotiable: false, dealStatus: "asking", locationContains: "Masteri" },
    ],
  },
];

