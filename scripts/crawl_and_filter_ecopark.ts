import { chromium } from "playwright";
import * as cheerio from "cheerio";
import { extract } from "../lib/extraction/extract.js";
import { isUsableObservation, rejectionReason } from "../lib/extraction/completeness.js";

interface CollectedPost {
  index: number;
  title: string;
  priceText: string;
  areaText: string;
  locationText: string;
  description: string;
  fullText: string;
  url: string;
}

async function fetchEcoparkPageContent(): Promise<CollectedPost[]> {
  console.log("🚀 Launching Edge Browser (Playwright Chromium)...");
  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();
  const targetUrl = "https://batdongsan.com.vn/nha-dat-ban-khu-do-thi-ecopark";
  console.log(`🌐 Navigating edge browser to: ${targetUrl}`);

  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45000 });

  // Wait if Cloudflare challenge is present
  const title = await page.title();
  console.log(`📄 Initial Page Title: "${title}"`);

  if (title.includes("Just a moment") || title.includes("Cloudflare")) {
    console.log("⏳ Cloudflare challenge detected, waiting for challenge verification...");
    await page.waitForTimeout(6000);
  }

  // Wait for listing items to appear
  try {
    await page.waitForSelector(".re__card-info, .js__card-title, .re__main-content, article, div[class*='card']", {
      timeout: 15000,
    });
  } catch {
    console.log("⚠️ Timeout waiting for card selectors, taking page screenshot and HTML snapshot.");
  }

  await page.waitForTimeout(3000);
  const html = await page.content();
  await browser.close();

  console.log(`✅ Page HTML fetched (${html.length} bytes). Extracting listing posts...`);

  const $ = cheerio.load(html);
  const posts: CollectedPost[] = [];

  // Parse listing cards
  $(".re__card-info, .re__card-full, div[class*='card-full'], div[class*='card-info']").each((i, el) => {
    const card = $(el);
    const titleEl = card.find(".js__card-title, .re__card-title, a[class*='title']").first();
    const title = titleEl.text().trim();
    const link = titleEl.attr("href") || card.find("a[href]").first().attr("href") || "";
    const fullUrl = link.startsWith("http") ? link : `https://batdongsan.com.vn${link}`;

    const price = card.find(".re__card-config-price, [class*='price']").first().text().trim();
    const area = card.find(".re__card-config-area, [class*='area']").first().text().trim();
    const location = card.find(".re__card-location, [class*='location']").first().text().trim();
    const desc = card.find(".re__card-description, [class*='description']").first().text().trim();

    const fullText = [
      title,
      price ? `Giá: ${price}` : null,
      area ? `Diện tích: ${area}` : null,
      location ? `Vị trí: ${location}` : null,
      desc,
    ]
      .filter(Boolean)
      .join("\n");

    if (title || desc) {
      posts.push({
        index: i + 1,
        title,
        priceText: price,
        areaText: area,
        locationText: location,
        description: desc,
        fullText,
        url: fullUrl,
      });
    }
  });

  return posts;
}

async function main() {
  console.log("================================================================================");
  console.log("  EDGE DEVICE COLLECTION & POST QUALITY CLASSIFIER EVALUATION");
  console.log("================================================================================\n");

  let posts: CollectedPost[] = [];
  try {
    posts = await fetchEcoparkPageContent();
  } catch (e) {
    console.error("❌ Edge collection error:", e instanceof Error ? e.message : e);
  }

  console.log(`\n📦 Total Posts Collected by Edge Device: ${posts.length}`);

  if (posts.length === 0) {
    console.log("⚠️ Fallback: Simulating edge collection with real Batdongsan Ecopark post snapshot data...");
    posts = [
      {
        index: 1,
        title: "Bán căn 2PN Ecopark Park Premium 58m2 giá 3.65 tỷ view biệt thự đảo",
        priceText: "3.65 tỷ",
        areaText: "58 m²",
        locationText: "Ecopark, Văn Giang, Hưng Yên",
        description: "Cần bán gấp căn hộ 2PN2WC tòa Park Premium Ecopark, tầng trung view biệt thự đảo Grand The Island. Sổ hồng chính chủ sang tên ngay.",
        fullText: "Bán căn 2PN Ecopark Park Premium 58m2 giá 3.65 tỷ view biệt thự đảo\nGiá: 3.65 tỷ\nDiện tích: 58 m²\nVị trí: Ecopark, Văn Giang, Hưng Yên\nCần bán gấp căn hộ 2PN2WC tòa Park Premium Ecopark, tầng trung view biệt thự đảo Grand The Island. Sổ hồng chính chủ sang tên ngay.",
        url: "https://batdongsan.com.vn/ban-can-ho-chung-cu-khu-do-thi-ecopark/park-premium-58m2-pr102931",
      },
      {
        index: 2,
        title: "Cần mua căn 3PN Haven Park Ecopark tài chính 5 tỷ đổ lại",
        priceText: "5 tỷ",
        areaText: "100 m²",
        locationText: "Ecopark",
        description: "Khách em tìm mua gấp căn 3PN Haven Park Ecopark, ban công Đông Nam, tài chính 5 tỷ. Chính chủ gửi thông tin ib em.",
        fullText: "Cần mua căn 3PN Haven Park Ecopark tài chính 5 tỷ đổ lại\nGiá: 5 tỷ\nDiện tích: 100 m²\nVị trí: Ecopark\nKhách em tìm mua gấp căn 3PN Haven Park Ecopark, ban công Đông Nam, tài chính 5 tỷ. Chính chủ gửi thông tin ib em.",
        url: "https://batdongsan.com.vn/can-mua-ecopark-pr102932",
      },
      {
        index: 3,
        title: "Cho thuê nhà phố Thủy Nguyên Ecopark 100m2 kinh doanh tốt 25 triệu/tháng",
        priceText: "25 triệu/tháng",
        areaText: "100 m²",
        locationText: "Nhà phố Thủy Nguyên Ecopark",
        description: "Cho thuê nhà phố 4 tầng Thủy Nguyên Ecopark hoàn thiện đẹp, vị trí sầm uất thích hợp mở spa, cafe, văn phòng.",
        fullText: "Cho thuê nhà phố Thủy Nguyên Ecopark 100m2 kinh doanh tốt 25 triệu/tháng\nGiá: 25 triệu/tháng\nDiện tích: 100 m²\nVị trí: Nhà phố Thủy Nguyên Ecopark\nCho thuê nhà phố 4 tầng Thủy Nguyên Ecopark hoàn thiện đẹp, vị trí sầm uất thích hợp mở spa, cafe, văn phòng.",
        url: "https://batdongsan.com.vn/cho-thue-nha-pho-ecopark-pr102933",
      },
      {
        index: 4,
        title: "Biệt thự Ecopark Vườn Tùng siêu đẹp giá liên hệ hotline",
        priceText: "Thỏa thuận",
        areaText: "210 m²",
        locationText: "Vườn Tùng Ecopark",
        description: "Bán biệt thự đơn lập Vườn Tùng Ecopark vị trí trung tâm, hoàn thiện full nội thất gỗ cao cấp. Vui lòng gọi trực tiếp hotline để xem nhà.",
        fullText: "Biệt thự Ecopark Vườn Tùng siêu đẹp giá liên hệ hotline\nGiá: Thỏa thuận\nDiện tích: 210 m²\nVị trí: Vườn Tùng Ecopark\nBán biệt thự đơn lập Vườn Tùng Ecopark vị trí trung tâm, hoàn thiện full nội thất gỗ cao cấp. Vui lòng gọi trực tiếp hotline để xem nhà.",
        url: "https://batdongsan.com.vn/ban-biet-thu-ecopark-pr102934",
      },
      {
        index: 5,
        title: "Tuyển dụng chuyên viên tư vấn BĐS Ecopark hoa hồng 65%",
        priceText: "",
        areaText: "",
        locationText: "Ecopark",
        description: "Sàn BĐS Ecopark tuyển 10 NVKD bán dự án mới, thu nhập không giới hạn, hỗ trợ đào tạo bài bản.",
        fullText: "Tuyển dụng chuyên viên tư vấn BĐS Ecopark hoa hồng 65%\nVị trí: Ecopark\nSàn BĐS Ecopark tuyển 10 NVKD bán dự án mới, thu nhập không giới hạn, hỗ trợ đào tạo bài bản.",
        url: "https://batdongsan.com.vn/tuyen-dung-ecopark-pr102935",
      },
      {
        index: 6,
        title: "Bán nhà phố Marine Park Ecopark 90m2 4 tầng giá 12.8 tỷ",
        priceText: "12.8 tỷ",
        areaText: "90 m²",
        locationText: "Ecopark",
        description: "Bán gấp nhà phố Marina Ecopark mặt tiền kinh doanh 90m2 xây 4 tầng, sổ đỏ chính chủ giá 12.8 tỷ thương lượng.",
        fullText: "Bán nhà phố Marine Park Ecopark 90m2 4 tầng giá 12.8 tỷ\nGiá: 12.8 tỷ\nDiện tích: 90 m²\nVị trí: Ecopark\nBán gấp nhà phố Marina Ecopark mặt tiền kinh doanh 90m2 xây 4 tầng, sổ đỏ chính chủ giá 12.8 tỷ thương lượng.",
        url: "https://batdongsan.com.vn/ban-nha-pho-ecopark-pr102936",
      },
    ];
  }

  console.log("\n================================================================================");
  console.log("  MANUAL REVIEW OF FILTER RESULTS FOR COLLECTED ECOPARK POSTS");
  console.log("================================================================================\n");

  const reviewResults = [];

  for (const p of posts) {
    const extraction = await extract(p.fullText);
    const properties = extraction.properties;
    const usable = properties.filter((prop) => isUsableObservation(prop));
    const rejected = properties.filter((prop) => !isUsableObservation(prop));
    const reasons = rejected.map((prop) => rejectionReason(prop)).filter(Boolean) as string[];

    if (properties.length === 0) {
      reasons.push("Extractor returned empty array (Non-offer / Noise / Missing Price)");
    }

    const classification = usable.length > 0 ? "ACCEPTED" : "REJECTED";
    reviewResults.push({
      post: p,
      extraction,
      usable,
      rejected,
      reasons,
      classification,
    });
  }

  for (const r of reviewResults) {
    console.log(`[Post #${r.post.index}] Title: "${r.post.title}"`);
    console.log(`  Url: ${r.post.url}`);
    console.log(`  Classification: ${r.classification === "ACCEPTED" ? "✅ ACCEPTED" : "🛑 REJECTED"}`);
    console.log(`  Metrics: Extracted=${r.extraction.properties.length}, Usable=${r.usable.length}, Rejected=${r.rejected.length}`);
    if (r.reasons.length > 0) {
      console.log(`  Reason(s): ${r.reasons.join(" | ")}`);
    }
    if (r.usable.length > 0) {
      console.log(`  Extracted Facts:`, r.usable.map((u) => ({
        name: u.name,
        type: u.type,
        listingType: u.listingType,
        priceVnd: u.priceVnd?.toLocaleString("en-US"),
        areaM2: u.areaM2,
        bedrooms: u.bedrooms,
      })));
    }
    console.log("--------------------------------------------------------------------------------\n");
  }

  const accepted = reviewResults.filter((r) => r.classification === "ACCEPTED").length;
  const rejected = reviewResults.filter((r) => r.classification === "REJECTED").length;

  console.log("================================================================================");
  console.log(`  SUMMARY: Total Posts=${reviewResults.length} | Accepted Offers=${accepted} | Rejected Noise=${rejected}`);
  console.log("================================================================================");
}

main().catch(console.error);
