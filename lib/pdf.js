// Stub for future PDF generation. v1 ships the analysis as an HTML email.
// Recommended v2 implementation: puppeteer renders /analysis/:id (server-rendered
// HTML using the same template as the email) to PDF, attached to the receipt.
export function buildAnalysisPdf() {
  throw new Error("PDF generation not implemented in v1 — analysis is delivered as HTML email.");
}
