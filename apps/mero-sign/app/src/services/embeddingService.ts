// src/services/embeddingService.ts
import * as tf from '@tensorflow/tfjs';
import * as use from '@tensorflow-models/universal-sentence-encoder';
import * as pdfjsLib from 'pdfjs-dist';

// Set the worker source for pdfjs-dist (required for browser)
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

const CONFIG = {
  MAX_CHUNK_SIZE: 400,
  MIN_SENTENCE_LENGTH: 20,
  CHUNK_PROCESSING_DELAY: 100,
  EMBEDDING_LOG_PREVIEW_LENGTH: 100,
} as const;

export interface DocumentChunk {
  text: string;
  embedding: number[];
  start_position: number;
  end_position: number;
}

export interface ProcessedDocument {
  text: string;
  fullTextEmbedding: number[];
  chunks: DocumentChunk[];
}

let embeddingModel: use.UniversalSentenceEncoder | null = null;

async function loadEmbeddingModel(): Promise<use.UniversalSentenceEncoder> {
  if (!embeddingModel) {
    try {
      await tf.setBackend('webgl');
      await tf.ready();
      embeddingModel = await use.load();
    } catch (error) {
      console.error('Error loading embedding model:', error);
      throw new Error('Failed to load embedding model');
    }
  }
  return embeddingModel;
}

function sanitizeText(text: string): string {
  if (!text || typeof text !== 'string') {
    throw new Error('Text must be a non-empty string');
  }

  const sanitized = text.trim().replace(/\0/g, '');
  if (!sanitized) {
    throw new Error('Text is empty after sanitization');
  }

  return sanitized;
}

function splitTextIntoChunks(
  text: string,
  maxChunkSize: number = CONFIG.MAX_CHUNK_SIZE,
): string[] {
  const sentences = text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > CONFIG.MIN_SENTENCE_LENGTH);

  if (sentences.length === 0) {
    return text.length > maxChunkSize
      ? [text.substring(0, maxChunkSize)]
      : [text];
  }

  const chunks: string[] = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    const wouldExceedLimit =
      currentChunk.length + sentence.length + 2 > maxChunkSize;
    const hasExistingContent = currentChunk.length > 0;

    if (wouldExceedLimit && hasExistingContent) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += (hasExistingContent ? '. ' : '') + sentence;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length > 0
    ? chunks
    : [text.substring(0, Math.min(text.length, maxChunkSize))];
}

export async function extractTextFromPDF(pdfFile: File): Promise<string> {
  try {
    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      fullText += pageText + ' ';
    }

    return fullText.trim() || 'No text extracted';
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    throw new Error('Failed to extract text from PDF');
  }
}

export async function generateEmbeddings(text: string): Promise<number[]> {
  try {
    const sanitized = sanitizeText(text);

    const model = await loadEmbeddingModel();
    const embeddings = await model.embed([sanitized]);

    if (!embeddings || embeddings.size === 0) {
      throw new Error('Embeddings are invalid or empty');
    }

    const dataArray = await embeddings.array();
    if (!Array.isArray(dataArray) || dataArray.length === 0) {
      throw new Error('Failed to convert embeddings to array');
    }

    return dataArray[0] as number[];
  } catch (error) {
    console.error('Error generating embeddings:', error);
    throw new Error(
      `Failed to generate embeddings: ${error instanceof Error ? error.message : error}`,
    );
  }
}

export async function generateQueryEmbedding(query: string): Promise<number[]> {
  if (!query?.trim()) {
    throw new Error('Query cannot be empty');
  }

  return generateEmbeddings(query.trim());
}

export async function generateChunkedEmbeddings(text: string): Promise<{
  fullTextEmbedding: number[];
  chunks: DocumentChunk[];
}> {
  try {
    if (!text?.trim()) {
      throw new Error('Text is empty or invalid');
    }

    const [fullTextEmbedding, textChunks] = await Promise.all([
      generateEmbeddings(text),
      Promise.resolve(splitTextIntoChunks(text, CONFIG.MAX_CHUNK_SIZE)),
    ]);

    const chunks: DocumentChunk[] = [];
    let currentPosition = 0;

    for (let i = 0; i < textChunks.length; i++) {
      const chunk = textChunks[i];

      const chunkEmbedding = await generateEmbeddings(chunk);
      const startPosition = currentPosition;
      const endPosition = currentPosition + chunk.length;

      chunks.push({
        text: chunk,
        embedding: chunkEmbedding,
        start_position: startPosition,
        end_position: endPosition,
      });

      currentPosition = endPosition + 1;

      if (i < textChunks.length - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, CONFIG.CHUNK_PROCESSING_DELAY),
        );
      }
    }

    return {
      fullTextEmbedding,
      chunks,
    };
  } catch (error) {
    console.error('Error generating chunked embeddings:', error);
    throw error;
  }
}

export async function processPDFAndGenerateEmbeddings(
  pdfFile: File,
): Promise<ProcessedDocument> {
  try {
    const text = await extractTextFromPDF(pdfFile);

    const { fullTextEmbedding, chunks } = await generateChunkedEmbeddings(text);

    return {
      text,
      fullTextEmbedding,
      chunks,
    };
  } catch (error) {
    console.error('Error processing PDF and generating embeddings:', error);
    throw error;
  }
}

export async function processPDFAndGenerateEmbeddingsLegacy(
  pdfFile: File,
): Promise<{ text: string; embeddings: number[] }> {
  try {
    const text = await extractTextFromPDF(pdfFile);
    const embeddings = await generateEmbeddings(text);
    return { text, embeddings };
  } catch (error) {
    console.error('Error processing PDF and generating embeddings:', error);
    throw error;
  }
}
