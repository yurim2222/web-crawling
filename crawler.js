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
  const title = await frame.$eval(".title_text", (el) => el.textContent.trim()).catch(() => "");
  const views = await frame.$eval(".article_info .count", (el) => el.textContent.replace("조회", "").trim()).catch(() => "0");
  const comments = await frame.$eval(".button_comment .num", (el) => el.textContent.trim()).catch(() => "0");
  const likes = await frame.$eval(".u_cnt._count", (el) => el.textContent.trim()).catch(() => "0");

  return { url, title, views, comments, likes };
}

async function crawlUrls(urls, onProgress) {
  const CONCURRENCY = 3; // 동시에 3개씩 처리
  const browser = await chromium.launch({ headless: true });
  const results = [];
  let completed = 0;

  async function processUrl(url) {
    const page = await browser.newPage();
    let result = null;
    let error = null;

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });

      const iframeElement = await page.waitForSelector("#cafe_main", { timeout: 10000 });
      const frame = await iframeElement.contentFrame();

      if (!frame) throw new Error("iframe을 찾을 수 없습니다.");

      await frame.waitForLoadState("domcontentloaded");
      result = await crawlSingle(url, frame);
      results.push(result);
    } catch (err) {
      error = err.message;
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
    // CONCURRENCY 개씩 병렬 처리
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const batch = urls.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map((url) => processUrl(url)));
    }
  } finally {
    await browser.close();
  }

  return results;
}

function saveResultsToExcel(results, filePath) {
  const header = ["URL", "제목", "조회수", "댓글수", "좋아요"];
  const rows = results.map((r) => [r.url, r.title, r.views, r.comments, r.likes]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "결과");
  XLSX.writeFile(wb, filePath);
}

module.exports = { getUrlsFromExcel, crawlUrls, saveResultsToExcel };
