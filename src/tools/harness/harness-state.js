/**
 */**
 * Per-working-directory harness state — shared between `harness_*` tools
 * and the default edit_file/write_file handlers.
 *
 * The goal: ensure both explicit harness tools and implicit file editing
 * operate on the same `ContentAddressableStore` / `HashAn/**
 * Per-working-directory harness state — shared between `harness_*` tools
 * and the default edit_file/write_file handlers.
 *
 * The goal: ensure both explicit harness tools and implicit file editing
 * operate on the same `ContentAddressableStore` / `HashAnchoredPatcher`
 * / `StateGraph`, so that `edit_file` output is audit-able in a
 * content-addressable way.
 */

import {
  ContentAddress/**
 * Per-working-directory harness state — shared between `harness_*` tools
 * and the default edit_file/write_file handlers.
 *
 * The goal: ensure both explicit harness tools and implicit file editing
 * operate on the same `ContentAddressableStore` / `HashAnchoredPatcher`
 * / `StateGraph`, so that `edit_file` output is audit-able in a
 * content-addressable way.
 */

import {
  ContentAddressableStore,
  FileAnalyzer,
} from '../../core/harness/content-addressing.js';
import {
  HashAnchoredPatcher,
  PatchIntentBuilder,
  StateGraph,
} from '../../core/harness/**
 * Per-working-directory harness state — shared between `harness_*` tools
 * and the default edit_file/write_file handlers.
 *
 * The goal: ensure both explicit harness tools and implicit file editing
 * operate on the same `ContentAddressableStore` / `HashAnchoredPatcher`
 * / `StateGraph`, so that `edit_file` output is audit-able in a
 * content-addressable way.
 */

import {
  ContentAddressableStore,
  FileAnalyzer,
} from '../../core/harness/content-addressing.js';
import {
  HashAnchoredPatcher,
  PatchIntentBuilder,
  StateGraph,
} from '../../core/harness/hash-anchored-patch.js';

const instances = new Map();

export function getHarnessState(workingDirectory) {
  const key = String(workingDirectory || process.cwd());
  let entry = instances.get(key);
  if (!entry) {
/**
 * Per-working-directory harness state — shared between `harness_*` tools
 * and the default edit_file/write_file handlers.
 *
 * The goal: ensure both explicit harness tools and implicit file editing
 * operate on the same `ContentAddressableStore` / `HashAnchoredPatcher`
 * / `StateGraph`, so that `edit_file` output is audit-able in a
 * content-addressable way.
 */

import {
  ContentAddressableStore,
  FileAnalyzer,
} from '../../core/harness/content-addressing.js';
import {
  HashAnchoredPatcher,
  PatchIntentBuilder,
  StateGraph,
} from '../../core/harness/hash-anchored-patch.js';

const instances = new Map();

export function getHarnessState(workingDirectory) {
  const key = String(workingDirectory || process.cwd());
  let entry = instances.get(key);
  if (!entry) {
    const store = new ContentAddressableStore();
    const analyzer = new FileAnalyzer(store);
    const patcher = new HashAnchoredPatcher(store);
    const patchBuilder = new PatchIntentBuilder(store);
/**
 * Per-working-directory harness state — shared between `harness_*` tools
 * and the default edit_file/write_file handlers.
 *
 * The goal: ensure both explicit harness tools and implicit file editing
 * operate on the same `ContentAddressableStore` / `HashAnchoredPatcher`
 * / `StateGraph`, so that `edit_file` output is audit-able in a
 * content-addressable way.
 */

import {
  ContentAddressableStore,
  FileAnalyzer,
} from '../../core/harness/content-addressing.js';
import {
  HashAnchoredPatcher,
  PatchIntentBuilder,
  StateGraph,
} from '../../core/harness/hash-anchored-patch.js';

const instances = new Map();

export function getHarnessState(workingDirectory) {
  const key = String(workingDirectory || process.cwd());
  let entry = instances.get(key);
  if (!entry) {
    const store = new ContentAddressableStore();
    const analyzer = new FileAnalyzer(store);
    const patcher = new HashAnchoredPatcher(store);
    const patchBuilder = new PatchIntentBuilder(store);
    const stateGraph = new StateGraph(store);
    entry = {
      store,
      analyzer,
      patcher,
      patchBuilder,
      stateGraph,
    };
    instances.set(key, entry);