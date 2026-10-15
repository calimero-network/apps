// A small but real contract PDF for the viewer scenarios: one Letter page of
// Helvetica text, written out by hand so the harness needs no PDF library and
// the viewer under the camera parses exactly what a node would hand it.

const PAGE_W = 612;
const PAGE_H = 792;

interface Line {
  text: string;
  size: number;
  bold?: boolean;
  gap?: number;
}

const LINES: Line[] = [
  { text: 'MUTUAL NON-DISCLOSURE AGREEMENT', size: 17, bold: true, gap: 30 },
  { text: 'Between Acme Industries Ltd. and Northwind Labs Inc.', size: 11, gap: 28 },
  { text: '1. Purpose', size: 12, bold: true, gap: 18 },
  { text: 'The parties wish to explore a business relationship and, in doing so,', size: 10.5, gap: 15 },
  { text: 'may disclose confidential information to one another. This agreement', size: 10.5, gap: 15 },
  { text: 'sets out how that information is to be protected.', size: 10.5, gap: 26 },
  { text: '2. Confidential information', size: 12, bold: true, gap: 18 },
  { text: 'Confidential information means any non-public information disclosed', size: 10.5, gap: 15 },
  { text: 'by either party, in any form, that is marked confidential or would', size: 10.5, gap: 15 },
  { text: 'reasonably be understood to be confidential.', size: 10.5, gap: 26 },
  { text: '3. Obligations', size: 12, bold: true, gap: 18 },
  { text: 'Each party shall use the other party\'s confidential information only', size: 10.5, gap: 15 },
  { text: 'for the purpose above, and shall not disclose it to any third party', size: 10.5, gap: 15 },
  { text: 'without prior written consent.', size: 10.5, gap: 26 },
  { text: '4. Term', size: 12, bold: true, gap: 18 },
  { text: 'This agreement remains in force for two years from the date it is', size: 10.5, gap: 15 },
  { text: 'signed by both parties.', size: 10.5, gap: 60 },
  { text: 'Signed for Acme Industries Ltd.            Signed for Northwind Labs Inc.', size: 10.5, gap: 46 },
  { text: '______________________________            ______________________________', size: 10.5, gap: 0 },
];

function escape(text: string): string {
  return text.replace(/[\\()]/g, (c) => `\\${c}`);
}

/** The PDF bytes, as a Blob the viewer can read like a downloaded document. */
export function samplePdf(): Blob {
  let y = PAGE_H - 84;
  const ops: string[] = [];
  for (const line of LINES) {
    ops.push(
      `BT /${line.bold ? 'F2' : 'F1'} ${line.size} Tf 72 ${y} Td (${escape(line.text)}) Tj ET`,
    );
    y -= line.gap ?? 16;
  }
  const content = ops.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents 4 0 R ` +
      '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([out], { type: 'application/pdf' });
}
