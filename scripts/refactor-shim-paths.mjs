#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, statSync, unlinkSync } from 'fs';
import { join, dirname, relative, resolve, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const coreDir = join(projectRoot, 'src', 'core');

function findShimFiles(dir) {
  const shims = new Map();
  const files = readdirSync(dir).filter(f => f.endsWith('.js'));
  for (const file of files) {
    const filePath = join(dir, file);
    const content = readFileSync(filePath, 'utf-8');
    const match = content.match(/^export \* from ['"](\.\/[^'"]+)['"];?\s*$/m);
    if (match) {
      const targetRel = match[1];
      const targetAbs = resolve(dir, targetRel);
      shims.set(filePath, targetAbs);
    }
  }
  return shims;
}

function findAllJsFiles(dir, result = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'build', 'release'].includes(entry.name)) continue;
      findAllJsFiles(fullPath, result);
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.jsx') || entry.name.endsWith('.mjs')) {
      result.push(fullPath);
    }
  }
  return result;
}

function resolveImportPath(importPath, fromFile) {
  if (!importPath.startsWith('.')) return null;
  return resolve(dirname(fromFile), importPath);
}

function normalizeRelPath(p) {
  if (!p.startsWith('.')) {
    p = './' + p;
  }
  return p;
}

function replaceShimImports(shims, allFiles) {
  let totalReplacements = 0;
  const shimAbsPaths = new Set(shims.keys());

  for (const filePath of allFiles) {
    let content = readFileSync(filePath, 'utf-8');
    let changed = false;

    const importRegex = /(from\s+['"])([^'"]+)(['"])/g;
    let match;
    const replacements = [];

    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[2];
      const importAbs = resolveImportPath(importPath, filePath);
      if (!importAbs) continue;

      if (shimAbsPaths.has(importAbs)) {
        const targetAbs = shims.get(importAbs);
        let newRel = relative(dirname(filePath), targetAbs);
        newRel = normalizeRelPath(newRel);
        replacements.push({
          start: match.index + match[1].length,
          end: match.index + match[1].length + importPath.length,
          oldPath: importPath,
          newPath: newRel,
        });
      }
    }

    if (replacements.length > 0) {
      let newContent = content;
      for (let i = replacements.length - 1; i >= 0; i--) {
        const r = replacements[i];
        newContent = newContent.slice(0, r.start) + r.newPath + newContent.slice(r.end);
      }
      writeFileSync(filePath, newContent, 'utf-8');
      console.log(`  ${replacements.length} replacements in ${relative(projectRoot, filePath)}`);
      totalReplacements += replacements.length;
      changed = true;
    }
  }

  return totalReplacements;
}

function deleteShimFiles(shims) {
  let count = 0;
  for (const shimPath of shims.keys()) {
    unlinkSync(shimPath);
    console.log(`  Deleted: ${relative(projectRoot, shimPath)}`);
    count++;
  }
  return count;
}

console.log('=== Phase 1: Find shim files in src/core/ ===');
const shims = findShimFiles(coreDir);
console.log(`Found ${shims.size} shim files`);

console.log('\n=== Phase 2: Find all JS/JSX files ===');
const allFiles = findAllJsFiles(projectRoot);
console.log(`Found ${allFiles.length} JS/JSX files`);

console.log('\n=== Phase 3: Replace shim imports ===');
const totalReplacements = replaceShimImports(shims, allFiles);
console.log(`Total replacements: ${totalReplacements}`);

console.log('\n=== Phase 4: Delete shim files ===');
const deleted = deleteShimFiles(shims);
console.log(`Deleted ${deleted} shim files`);

console.log('\n=== Done ===');
