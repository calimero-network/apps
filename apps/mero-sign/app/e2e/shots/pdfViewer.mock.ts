// The PDF viewer pulls in pdfjs and a worker; the screenshots do not exercise
// it, and bundling it would make the harness build minutes long.
export default function PDFViewerStub() {
  return null;
}
