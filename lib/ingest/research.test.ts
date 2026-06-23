import { test } from "node:test";
import assert from "node:assert/strict";
import { rewriteSearchQueries } from "./research";

test("rewriteSearchQueries turns broker prose into shared DB and internet queries in MOCK_AI", async () => {
  const previous = process.env.MOCK_AI;
  process.env.MOCK_AI = "1";
  const rewrite = await rewriteSearchQueries(
    `💎CC cần bán căn 58m2 có 2PN1VS, bán công Đông Nam tầng cao siêu thoáng, mát quanh năm. Căn hộ ở tòa Park
Premium- mỗi tầng chỉ có 8 căn hộ rất riêng tư và yên bình.
💰Giá bán 3.6x tỷ bao phí- đang là rẻ nhất thị trường cho căn ban công Đông Nam tòa xịn sò ở Ecopark ạ.`,
  );
  if (previous === undefined) delete process.env.MOCK_AI;
  else process.env.MOCK_AI = previous;

  assert.equal(rewrite.method, "mock");
  assert.equal(rewrite.dbQuery, "Ecopark Park Premium thông tin dự án tòa nhà mặt bằng");
  assert.equal(rewrite.internetQuery, "Ecopark Park Premium thông tin dự án tòa nhà mặt bằng");
  assert.ok(!rewrite.internetQuery.includes("bán"));
  assert.ok(!rewrite.internetQuery.includes("giá"));
});
