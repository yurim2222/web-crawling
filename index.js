const { chromium } = require("playwright");
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

async function getUrlsFromExcel(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  // Column A의 URL들을 추출 (빈 셀 제외)
  return data.map((row) => row[0]).filter((url) => url && typeof url === "string" && url.startsWith("http"));
}

async function crawl(url, browser) {
  const page = await browser.newPage();

  try {
    console.log(`\n▶ Visiting: ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

    // Naver Cafe는 콘텐츠를 #cafe_main iframe 안에 렌더링함
    const iframeElement = await page.waitForSelector("#cafe_main", { timeout: 10000 });
    const frame = await iframeElement.contentFrame();

    if (!frame) {
      console.error("  ✗ iframe의 contentFrame을 가져올 수 없습니다.");
      return;
    }

    // iframe 내부 콘텐츠가 로드될 때까지 대기
    await frame.waitForLoadState("domcontentloaded");

    // 데이터 추출
    const title = await frame.$eval(".title_text", (el) => el.textContent.trim()).catch(() => "");
    const views = await frame.$eval(".article_info .count", (el) => el.textContent.replace("조회", "").trim()).catch(() => "0");
    const comments = await frame.$eval(".button_comment .num", (el) => el.textContent.trim()).catch(() => "0");
    const likes = await frame.$eval(".u_cnt._count", (el) => el.textContent.trim()).catch(() => "0");

    console.log(`  제목: ${title}`);
    console.log(`  조회수: ${views}`);
    console.log(`  댓글수: ${comments}`);
    console.log(`  좋아요: ${likes}`);

    return { url, title, views, comments, likes };
  } catch (err) {
    console.error(`  ✗ Error: ${err.message}`);
  } finally {
    await page.close();
  }
}

async function main() {
  const excelPath = path.resolve(__dirname, "input.xlsx");

  let urls;
  try {
    urls = await getUrlsFromExcel(excelPath);
  } catch (err) {
    console.error(`Excel 파일을 읽을 수 없습니다 (${excelPath}): ${err.message}`);
    process.exit(1);
  }

  if (urls.length === 0) {
    console.error("Excel 파일에서 URL을 찾을 수 없습니다.");
    process.exit(1);
  }

  console.log(`총 ${urls.length}개의 URL을 찾았습니다.\n`);

  const browser = await chromium.launch({ headless: false });

  const results = [];

  try {
    for (const url of urls) {
      const data = await crawl(url, browser);
      if (data) results.push(data);
    }
  } finally {
    await browser.close();
  }

  // 결과를 Excel로 저장
  if (results.length > 0) {
    const header = ["URL", "제목", "조회수", "댓글수", "좋아요"];
    const rows = results.map((r) => [r.url, r.title, r.views, r.comments, r.likes]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "결과");
    XLSX.writeFile(wb, "output.xlsx");
    console.log(`\n✓ ${results.length}건 결과 저장 → output.xlsx`);
  }

  console.log("\n완료!");
}

main();
