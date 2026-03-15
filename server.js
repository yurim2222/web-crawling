const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { getUrlsFromExcel, crawlUrls, saveResultsToExcel } = require("./crawler");

const app = express();
const PORT = process.env.PORT || 3000;

// 디렉토리 생성
const uploadsDir = path.join(__dirname, "uploads");
const resultsDir = path.join(__dirname, "results");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir);

// 미들웨어
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// 파일 업로드 설정
const upload = multer({
  dest: uploadsDir,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ext === ".xlsx" || ext === ".xls");
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

// 작업 저장소
const jobs = new Map();

// 크롤링 시작
app.post("/api/crawl", upload.single("file"), (req, res) => {
  let urls = [];

  try {
    if (req.file) {
      urls = getUrlsFromExcel(req.file.path);
    } else if (req.body.urls) {
      urls = req.body.urls
        .split("\n")
        .map((u) => u.trim())
        .filter((u) => u.startsWith("http"));
    }
  } catch (err) {
    return res.status(400).json({ error: "파일을 읽을 수 없습니다." });
  }

  if (urls.length === 0) {
    return res.status(400).json({ error: "URL을 찾을 수 없습니다." });
  }

  const jobId = crypto.randomUUID();
  const job = {
    status: "running",
    total: urls.length,
    current: 0,
    results: [],
    errors: [],
    sseClients: [],
  };
  jobs.set(jobId, job);

  res.json({ jobId, total: urls.length });

  // 백그라운드 크롤링 실행
  crawlUrls(urls, (progress) => {
    job.current = progress.current;

    if (progress.result) {
      job.results.push(progress.result);
    }
    if (progress.error) {
      job.errors.push({ url: progress.url, error: progress.error });
    }

    // SSE로 진행 상황 전송
    const eventData = JSON.stringify({
      current: progress.current,
      total: progress.total,
      url: progress.url,
      result: progress.result,
      error: progress.error,
    });

    job.sseClients.forEach((client) => {
      client.write(`data: ${eventData}\n\n`);
    });
  })
    .then((results) => {
      job.status = "done";

      // 결과 Excel 저장
      if (results.length > 0) {
        const outputPath = path.join(resultsDir, `${jobId}.xlsx`);
        saveResultsToExcel(results, outputPath);
      }

      // 완료 이벤트 전송
      job.sseClients.forEach((client) => {
        client.write(`event: done\ndata: ${JSON.stringify({ jobId, resultCount: results.length })}\n\n`);
      });
    })
    .catch((err) => {
      job.status = "error";
      job.sseClients.forEach((client) => {
        client.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
      });
    });
});

// SSE 진행 상황 스트림
app.get("/api/progress/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "작업을 찾을 수 없습니다." });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  job.sseClients.push(res);

  req.on("close", () => {
    job.sseClients = job.sseClients.filter((c) => c !== res);
  });
});

// 결과 다운로드
app.get("/api/download/:jobId", (req, res) => {
  const filePath = path.join(resultsDir, `${req.params.jobId}.xlsx`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "결과 파일이 없습니다." });
  }
  res.download(filePath, "crawl-result.xlsx");
});

app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});
