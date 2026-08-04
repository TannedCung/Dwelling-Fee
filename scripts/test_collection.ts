import { isUsableObservation, rejectionReason } from "../lib/extraction/completeness.js";
import { extract } from "../lib/extraction/extract.js";

async function main() {
  console.log("================================================================================");
  console.log("  COLLECTION POST FILTER EVALUATION & QUALITY CLASSIFIER REVIEW");
  console.log("================================================================================\n");

  const samplePosts = [
    {
      id: "post-01",
      category: "Valid Sale Offer",
      text: "Bán căn 2PN Vinhomes Grand Park Q9 60m2 giá 3.2 tỷ. Sổ hồng đầy đủ. LH 0909xxxxxx",
      expectedClassification: "ACCEPTED",
    },
    {
      id: "post-02",
      category: "Buying Request (Noise)",
      text: "Cần mua gấp căn hộ 2PN Vinhomes Grand Park Q9 tài chính 3.5 tỷ đổ lại. Sổ hồng sang tên ngay. Inbox em!",
      expectedClassification: "REJECTED (Buying Request)",
    },
    {
      id: "post-03",
      category: "Tenant Seeking Request (Noise)",
      text: "Khách em tìm thuê căn 1PN Masteri An Phú full nội thất tài chính 14tr/tháng. Chính chủ nhắn em nhé.",
      expectedClassification: "REJECTED (Seeking Rental)",
    },
    {
      id: "post-04",
      category: "Broker Recruitment (Noise)",
      text: "Tuyển dụng 5 nhân viên kinh doanh bất động sản khu vực Quận 2, hoa hồng hấp dẫn 60%, hỗ trợ data hot.",
      expectedClassification: "REJECTED (Recruitment / Ad)",
    },
    {
      id: "post-05",
      category: "Valid Rental Offer",
      text: "Cho thuê chung cư Masteri Thảo Điền 2 phòng ngủ, 70m2, 18 triệu/tháng, TL nhẹ cho khách thiện chí.",
      expectedClassification: "ACCEPTED",
    },
    {
      id: "post-06",
      category: "Incomplete Post (Missing Price & Area)",
      text: "Siêu siêu phẩm căn hộ cao cấp chuẩn Nhật Bản trung tâm Q7. Liên hệ hotline 0909xxxxxx để chọn căn đẹp!",
      expectedClassification: "REJECTED (Missing Specs)",
    },
    {
      id: "post-07",
      category: "Masked Price Valid Offer",
      text: "Bán căn 2PN Ecopark Park Premium 58m2 giá 3.6x tỷ, view nội khu mát mẻ.",
      expectedClassification: "ACCEPTED",
    },
    {
      id: "post-08",
      category: "Shophouse Sale Offer",
      text: "Bán shophouse khối đế Masteri Thảo Điền 120m2 giá 18.5 tỷ, đang có hợp đồng thuê sẵn.",
      expectedClassification: "ACCEPTED",
    },
    {
      id: "post-09",
      category: "General Greeting (Noise)",
      text: "Chào buổi sáng cả nhà, chúc mọi người một ngày làm việc hiệu quả nhé! 🌞",
      expectedClassification: "REJECTED (General Chatter)",
    },
    {
      id: "post-10",
      category: "Land Sale Offer per m²",
      text: "Cần bán lô đất mặt tiền đường Nguyễn Văn Linh, 100m2, giá 80 triệu/m2, thương lượng.",
      expectedClassification: "ACCEPTED",
    },
  ];

  const results: Array<{
    id: string;
    category: string;
    text: string;
    extractedCount: number;
    usableCount: number;
    rejectedCount: number;
    classification: "ACCEPTED" | "REJECTED";
    reasons: string[];
    classifierMatch: boolean;
  }> = [];

  for (const post of samplePosts) {
    const extraction = await extract(post.text);
    const properties = extraction.properties;
    const usable = properties.filter((p) => isUsableObservation(p));
    const rejected = properties.filter((p) => !isUsableObservation(p));
    const reasons = rejected.map((p) => rejectionReason(p)).filter(Boolean) as string[];

    if (properties.length === 0) {
      reasons.push("Extractor returned empty array (Non-offer / Noise)");
    }

    const classification = usable.length > 0 ? "ACCEPTED" : "REJECTED";
    const expectedAccept = post.expectedClassification === "ACCEPTED";
    const classifierMatch = (classification === "ACCEPTED") === expectedAccept;

    results.push({
      id: post.id,
      category: post.category,
      text: post.text,
      extractedCount: properties.length,
      usableCount: usable.length,
      rejectedCount: rejected.length,
      classification,
      reasons,
      classifierMatch,
    });
  }

  console.log("=== MANUAL REVIEW OF POST FILTER RESULTS ===\n");
  for (const r of results) {
    console.log(`[${r.id}] ${r.category.padEnd(35)} -> ${r.classification === "ACCEPTED" ? "✅ ACCEPTED" : "🛑 REJECTED"}`);
    console.log(`     Text: "${r.text}"`);
    console.log(`     Metrics: Extracted=${r.extractedCount}, Usable=${r.usableCount}, Rejected=${r.rejectedCount}`);
    if (r.reasons.length > 0) {
      console.log(`     Reason(s): ${r.reasons.join(" | ")}`);
    }
    console.log(`     Correctness: ${r.classifierMatch ? "MATCHES EXPECTATION ✓" : "MISMATCH ✗"}\n`);
  }

  const matches = results.filter((r) => r.classifierMatch).length;
  console.log("================================================================================");
  console.log(`  CLASSIFIER ACCURACY OVER TEST POSTS: ${matches}/${results.length} (${((100 * matches) / results.length).toFixed(1)}%)`);
  console.log("================================================================================");
}

main().catch(console.error);
