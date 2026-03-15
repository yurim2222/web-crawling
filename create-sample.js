const XLSX = require("xlsx");

// 샘플 URL (본인의 네이버 카페 게시글 URL로 교체하세요)
const urls = [
  ["https://cafe.naver.com/skybluezw4rh/14395727"],
];

const workbook = XLSX.utils.book_new();
const sheet = XLSX.utils.aoa_to_sheet(urls);
XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
XLSX.writeFile(workbook, "input.xlsx");

console.log("input.xlsx 생성 완료!");
