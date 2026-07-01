import { describe, test, expect } from 'bun:test';
import {
  getDefaultOCRModelPaths,
  getDefaultOCRModelRoot,
  resolveOCRFileDownloadCandidates,
  resolveOCRModelDownloadCandidates,
  OCRRuntime,
} from '../../src/core/ocr-runtime.js';

describe('OCR runtime model paths', () => {
  test('returns default OCR model root', () => {
    const root = getDefaultOCRModelRoot();
    expect(typeof root).toBe('string');
    expect(root).toContain('monkt');
    expect(root).toContain('paddleocr-onnx');
  });

  test('returns detection, recognition, and dictionary paths', () => {
    const paths = getDefaultOCRModelPaths({ root: '/tmp/ocr-models' });
    expect(paths.detPath).toContain('detection/v5/det.onnx');
    expect(paths.recPath).toContain('languages/chinese/rec.onnx');
    expect(paths.dictPath).toContain('languages/chinese/dict.txt');
  });
});

describe('resolveOCRFileDownloadCandidates', () => {
  test('uses Hugging Face style resolve URLs', () => {
    const candidates = resolveOCRFileDownloadCandidates('detection/v5/det.onnx');
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]).toContain('huggingface.co');
    expect(candidates[0]).toContain('detection/v5/det.onnx');
  });

  test('respects custom repo option', () => {
    const candidates = resolveOCRFileDownloadCandidates('rec.onnx', {
      repo: 'example/ocr',
    });
    expect(candidates.some((url) => url.includes('example/ocr'))).toBe(true);
  });
});

describe('resolveOCRModelDownloadCandidates', () => {
  test('returns candidates for every OCR asset', () => {
    const candidates = resolveOCRModelDownloadCandidates();
    expect(candidates.det.length).toBeGreaterThan(0);
    expect(candidates.rec.length).toBeGreaterThan(0);
    expect(candidates.dict.length).toBeGreaterThan(0);
  });
});

describe('OCRRuntime', () => {
  test('inspect() reports model file status without downloading', async () => {
    const runtime = new OCRRuntime({
      root: '/tmp/missing-ocr-models',
      autoDownload: false,
    });
    const info = await runtime.inspect();
    expect(info.initialized).toBe(false);
    expect(info.files.det.exists).toBe(false);
    expect(info.files.rec.exists).toBe(false);
    expect(info.files.dict.exists).toBe(false);
    expect(info.autoDownload).toBe(false);
  });
});
