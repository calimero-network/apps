import * as pdfjsLib from 'pdfjs-dist';
import { jsPDF } from 'jspdf';
import { PDFDocument } from 'pdf-lib';

// Configure PDF.js worker for version 5.x
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.3.93/pdf.worker.min.mjs`;

export interface PDFPage {
  pageNumber: number;
  canvas: HTMLCanvasElement;
  viewport: pdfjsLib.PageViewport;
  width: number;
  height: number;
}

export interface SignaturePosition {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pageNumber: number;
  signatureData: string;
  timestamp: number;
}

class PDFService {
  async loadPDF(file: File): Promise<pdfjsLib.PDFDocumentProxy> {
    try {
      const arrayBuffer = await file.arrayBuffer();

      const loadingTask = pdfjsLib.getDocument({
        data: arrayBuffer,
      });

      const doc = await loadingTask.promise;

      return doc;
    } catch (error) {
      console.error('Detailed error loading PDF:', error);

      if (error instanceof Error) {
        if (error.message.includes('Invalid PDF')) {
          throw new Error('The uploaded file is not a valid PDF document.');
        } else if (error.message.includes('worker')) {
          throw new Error(
            'PDF processing failed. Please try refreshing the page.',
          );
        } else {
          throw new Error(`PDF loading failed: ${error.message}`);
        }
      } else {
        throw new Error(
          'Failed to load PDF document. Please ensure it is a valid PDF file.',
        );
      }
    }
  }

  async renderPage(
    pdf: pdfjsLib.PDFDocumentProxy,
    pageNumber: number,
    scale: number = 1.5,
  ): Promise<PDFPage> {
    try {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');

      if (!context) {
        throw new Error('Unable to get 2D context');
      }

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const renderContext = {
        canvasContext: context,
        viewport: viewport,
        enableWebGL: false,
      };

      await page.render(renderContext).promise;

      return {
        pageNumber,
        canvas,
        viewport,
        width: viewport.width,
        height: viewport.height,
      };
    } catch (error) {
      console.error('Error rendering PDF page:', error);
      throw new Error(`Failed to render page ${pageNumber}`);
    }
  }

  async renderAllPages(
    pdf: pdfjsLib.PDFDocumentProxy,
    scale: number = 1.5,
  ): Promise<PDFPage[]> {
    const numPages = pdf.numPages;
    const pages: PDFPage[] = [];

    for (let i = 1; i <= numPages; i++) {
      const page = await this.renderPage(pdf, i, scale);
      pages.push(page);
    }

    return pages;
  }

  async addSignatureToCanvas(
    canvas: HTMLCanvasElement,
    signature: SignaturePosition,
    scale: number = 1.5,
  ): Promise<void> {
    const context = canvas.getContext('2d');
    if (!context) return;

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          context.drawImage(
            img,
            signature.x,
            signature.y,
            signature.width,
            signature.height,
          );
          resolve();
        } catch (error) {
          console.error('Error drawing signature on canvas:', error);
          reject(error);
        }
      };
      img.onerror = () => {
        console.error('Failed to load signature image');
        reject(new Error('Failed to load signature image'));
      };
      img.src = signature.signatureData;
    });
  }

  private dataUrlToBytes(dataUrl: string): Uint8Array {
    const base64 = dataUrl.split(',')[1];
    const binaryStr = atob(base64);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return bytes;
  }

  async generateSignedPDF(
    originalFile: File,
    signatures: SignaturePosition[],
    renderScale: number = 1.5,
  ): Promise<Blob> {
    if (signatures.length === 0) {
      return originalFile;
    }

    const pdfBytes = await originalFile.arrayBuffer();

    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();

    for (const signature of signatures) {
      const pageIndex = signature.pageNumber - 1;
      if (pageIndex < 0 || pageIndex >= pages.length) {
        console.warn(
          `Invalid page number ${signature.pageNumber} for signature.`,
        );
        continue;
      }
      const page = pages[pageIndex];

      try {
        const imageBytes = this.dataUrlToBytes(signature.signatureData);
        const image = await pdfDoc.embedPng(imageBytes);

        const { height: pageHeight } = page.getSize();

        const signatureCoords = {
          x: signature.x / renderScale,

          y:
            pageHeight -
            signature.y / renderScale -
            signature.height / renderScale,

          width: signature.width / renderScale,
          height: signature.height / renderScale,
        };

        page.drawImage(image, signatureCoords);
      } catch (error) {
        console.error('Error embedding signature:', error);
      }
    }

    const signedPdfBytes = await pdfDoc.save();

    return new Blob([new Uint8Array(signedPdfBytes)], {
      type: 'application/pdf',
    });
  }

  downloadPDF(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Test function to verify PDF.js is working
  async testPDFJS(): Promise<boolean> {
    try {
      // Create a simple test PDF
      const testPDF = new jsPDF();
      testPDF.text('Test PDF for verification', 10, 10);
      const pdfBlob = testPDF.output('blob');

      // Convert to ArrayBuffer and try to load
      const arrayBuffer = await pdfBlob.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const doc = await loadingTask.promise;

      const numPages = doc.numPages;
      console.log(`Test PDF loaded successfully with ${numPages} pages`);

      return true;
    } catch (error) {
      console.error('PDF.js test failed:', error);
      return false;
    }
  }
}

export const pdfService = new PDFService();
