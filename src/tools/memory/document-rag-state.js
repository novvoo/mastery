/**
 * Shared mutable state and persistence for Document RAG.
 *
 * This module owns the central documents map, chunks array, BM25 cache
 * stamp, embedder singleton, and the save/load cycle.
 */

import { readFile, mkdir, writeFile } from 'fs/promises';
import { resolve, join } from 'path';
import { Embedder } from '../../core/embedder.js';

/* ─── shared mutable state ────────────────────────────────────────── */
export const documents = new Map();
export const chunks = [];
export let embedderPromise = null;
export let bm25Cache = null;
export let bm25CacheKey = 0;

/* ─── persistence state ────────────────────────────────────────────── */
let loadedPersistDir = null;

/* ─── state mutators ───────────────────────────────────────────────── */
export function invalidateBM25Cache() {
  bm25Cache = null;
  bm25CacheKey++;
}

export function resetState() {
  documents.clear();
  chunks.length = 0;
  bm25Cache = null;
  bm25CacheKey++;
}

/* ─── persistence ───────────────────────────────────────────────────── */
export function getPersistDir(workingDir) {
  return join(resolve(workingDir || process.cwd()), '.agent-data', 'doc-rag');
}

export async function ensureState(workingDir) {
  const dir = getPersistDir(workingDir);
  if (loadedPersistDir === dir) {
    return;
  }
  documents.clear();
  chunks.length = 0;
  bm25Cache = null;
  bm25CacheKey++;
  try {
    const docJson = await readFile(join(dir, 'documents.json'), 'utf-8');
    const chunkJson = await readFile(join(dir, 'chunks.json'), 'utf-8');
    const loadedDocs = JSON.parse(docJson);
    const loadedChunks = JSON.parse(chunkJson);
    for (const [key, val] of Object.entries(loadedDocs)) {
      documents.set(key, val);
    }
    chunks.push(...loadedChunks);
    loadedPersistDir = dir;
  } catch {
    // No persisted document index yet.
  }
}

export async function saveState(workingDir) {
  const dir = getPersistDir(workingDir);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'documents.json'),
    JSON.stringify(Object.fromEntries(documents)),
    'utf-8',
  );
  // Strip ephemeral fields before serializing to keep file small
  const serializable = chunks.map((c) => {
    const { embedding, ...rest } = c;
    return embedding ? { ...rest, embedding } : rest;
  });
  await writeFile(join(dir, 'chunks.json'), JSON.stringify(serializable), 'utf-8');
}

/* ─── embedder factory ─────────────────────────────────────────────── */
export async function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const embedder = new Embedder();
      await embedder.initialize();
      return embedder;
    })();
  }
  return embedderPromise;
}
