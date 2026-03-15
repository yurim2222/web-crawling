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
  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const page = await browser.newPage();
      let result = null;
      let error = null;

      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

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

      if (onProgress) {
        onProgress({
          current: i + 1,
          total: urls.length,
          url,
          result,
          error,
        });
      }
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
