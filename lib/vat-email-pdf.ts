import "server-only";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/** WinAnsi (the standard PDF fonts) cannot encode every character: swap common ones, drop the rest. */
function sanitize(text: string) {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^\x20-\x7e\xa0-\xff€\n]/g, "");
}

/** Renders an email-body receipt as a simple PDF so every saved invoice has a document. */
export async function vatEmailToPdf(email: { fromName: string | null; fromEmail: string | null; subject: string | null; receivedAt: Date; bodyText: string }) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const size = 10;
  const margin = 50;
  const [width, height] = [595, 842];
  const maxWidth = width - margin * 2;
  let page = pdf.addPage([width, height]);
  let y = height - margin;

  const line = (text: string, typeface = font) => {
    if (y < margin) {
      page = pdf.addPage([width, height]);
      y = height - margin;
    }
    page.drawText(text, { x: margin, y, size, font: typeface, color: rgb(0.1, 0.1, 0.1) });
    y -= size * 1.4;
  };
  const wrap = (text: string, typeface = font) => {
    for (const paragraph of sanitize(text).split("\n")) {
      let current = "";
      for (const word of paragraph.split(/\s+/)) {
        const next = current ? `${current} ${word}` : word;
        if (typeface.widthOfTextAtSize(next, size) > maxWidth && current) {
          line(current, typeface);
          current = word;
        } else current = next;
      }
      line(current, typeface);
    }
  };

  wrap(`From: ${[email.fromName, email.fromEmail && `<${email.fromEmail}>`].filter(Boolean).join(" ")}`, bold);
  wrap(`Subject: ${email.subject ?? ""}`, bold);
  wrap(`Date: ${email.receivedAt.toUTCString()}`, bold);
  y -= size;
  wrap(email.bodyText);
  return Buffer.from(await pdf.save());
}
