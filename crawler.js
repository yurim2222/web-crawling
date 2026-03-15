const { chromium } = require("playwright");
const XLSX = require("xlsx");

function getUrlsFromExcel(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  return data
    .map((row) => row[0])
    .filter((url) => url && typeof url === "string" && url.startsWith("http"));
}

async function crawlSingle(url, frame) {
  // 본문 영역이 로드될 때까지 대기
  await frame.waitForSelector(".article_viewer, .se-main-container", { timeout: 10000 }).catch(() => {});

  const title = await frame.$eval(".title_text", (el) => el.textContent.trim())
    .catch(() => frame.$eval("h3.title_text", (el) => el.textContent.trim()))
    .catch(() => "");

  const views = await frame.$eval(".article_info .count", (el) => el.textContent.replace(/[^0-9]/g, ""))
    .catch(() => frame.$eval(".article_info span.count", (el) => el.textContent.replace(/[^0-9]/g, "")))
    .catch(() => frame.$eval("[class*='article_info'] [class*='count']", (el) => el.textContent.replace(/[^0-9]/g, "")))
    .catch(() => "0");

  const comments = await frame.$eval(".comment_info .num", (el) => el.textContent.replace(/[^0-9]/g, ""))
    .catch(() => frame.$eval(".button_comment .num", (el) => el.textContent.replace(/[^0-9]/g, "")))
    .catch(() => frame.$eval("[class*='comment'] .num", (el) => el.textContent.replace(/[^0-9]/g, "")))
    .catch(() => "0");

  const likes = await frame.$eval(".u_cnt._count", (el) => el.textContent.replace(/[^0-9]/g, ""))
    .catch(() => frame.$eval(".like_article ._count", (el) => el.textContent.replace(/[^0-9]/g, "")))
    .catch(() => frame.$eval("[class*='like'] [class*='count']", (el) => el.textContent.replace(/[^0-9]/g, "")))
    .catch(() => "0");

  console.log(`[크롤링] ${url} => 제목: "${title}", 조회: ${views}, 댓글: ${comments}, 좋아요: ${likes}`);

  return { url, title, views, comments, likes };
}

async function crawlUrls(urls, onProgress) {
  const CONCURRENCY = 2;
  const browser = await chromium.launch({ headless: true });
  const results = [];
  const failures = [];
  let completed = 0;

  async function processUrl(url) {
    const page = await browser.newPage();
    let result = null;
    let error = null;

    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });

      const iframeElement = await page.waitForSelector("#cafe_main", { timeout: 20000 });
      const frame = await iframeElement.contentFrame();

      if (!frame) throw new Error("iframe을 찾을 수 없습니다.");

      await frame.waitForLoadState("load");
      await frame.waitForTimeout(1000);
      result = await crawlSingle(url, frame);
      results.push(result);
    } catch (err) {
      error = err.message;
      failures.push({ url, error: err.message });
      console.log(`[실패] ${url} => ${err.message}`);
    } finally {
      await page.close();
    }

    completed++;
    if (onProgress) {
      onProgress({
        current: completed,
        total: urls.length,
        url,
        result,
        error,
      });
    }
  }

  try {
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const batch = urls.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map((url) => processUrl(url)));
    }
  } finally {
    await browser.close();
  }

  return { results, failures };
}

function saveResultsToExcel(results, failures, filePath) {
  const header = ["URL", "제목", "조회수", "댓글수", "좋아요"];
  const rows = results.map((r) => [r.url, r.title, r.views, r.comments, r.likes]);

  const data = [header, ...rows];

  // 성공 결과 아래에 실패 목록 추가
  if (failures.length > 0) {
    data.push([]); // 빈 줄
    data.push(["실패"]);
    failures.forEach((f) => data.push([f.url]));
  }

  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "결과");
  XLSX.writeFile(wb, filePath);
}

module.exports = { getUrlsFromExcel, crawlUrls, saveResultsToExcel };
