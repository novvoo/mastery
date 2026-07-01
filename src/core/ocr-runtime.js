/**
 * OCR runtime model manager.
 *
 * Keeps OCR model discovery/download behavior aligned with the ONNX embedder:
 * Hugging Face endpoint candidates, optional mirrors, HEAD probes, timeouts,
 * progress callbacks, and atomic downloads.
 */

import { createWriteStream, existsSync } from 'fs';
import { mkdir, rename, rm, stat } from 'fs/promises';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';

const DEFAULT_OCR_REPO = 'monkt/paddleocr-onnx';
const DEFAULT_OCR_REVISION = 'main';
const DEFAULT_OCR_DET_FILE = 'detection/v5/det.onnx';
const DEFAULT_OCR_REC_FILE = 'languages/chinese/rec.onnx';
const DEFAULT_OCR_DICT_FILE = 'languages/chinese/dict.txt';
const DEFAULT_HF_ENDPOINT = 'https://huggingface.co';
const DEFAULT_HF_MIRROR = 'https://hf-mirror.com';
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30000;
const DEFAULT_PROBE_TIMEOUT_MS = 10000;

export function getDefaultOCRModelRoot() {
  return join(
    process.env.AEMA_MODEL_CACHE_DIR || join(homedir(), '.cache', 'mastery'),
    'models',
    process.env.OCR_MODEL_REPO || DEFAULT_OCR_REPO,
    process.env.OCR_MODEL_REVISION || DEFAULT_OCR_REVISION,
  );
}

export function getDefaultOCRModelPaths(options = {}) {
  const root = options.root || process.env.OCR_MODEL_ROOT || getDefaultOCRModelRoot();
  return {
    root,
    detPath: options.detPath || process.env.OCR_DET_MODEL_PATH || join(root, getOCRFile('det')),
    recPath: options.recPath || process.env.OCR_REC_MODEL_PATH || join(root, getOCRFile('rec')),
    dictPath: options.dictPath || process.env.OCR_DICT_PATH || join(root, getOCRFile('dict')),
  };
}

export function resolveOCRFileDownloadCandidates(file, options = {}) {
  const resolvedFile = file || options.file;

  if (!resolvedFile) {
    return [];
  }

  const specificUrl = options.url || envUrlForFile(resolvedFile);
  if (specificUrl) {
    return [specificUrl];
  }

  const repo = options.repo || process.env.OCR_MODEL_REPO || DEFAULT_OCR_REPO;
  const revision = options.revision || process.env.OCR_MODEL_REVISION || DEFAULT_OCR_REVISION;
  const extraMirrors = [
    options.hfEndpoint || process.env.HF_ENDPOINT,
    ...(options.mirrors || splitEnvList(process.env.OCR_MODEL_MIRRORS)),
    DEFAULT_HF_MIRROR,
  ];
  const endpoints = uniqueStrings([DEFAULT_HF_ENDPOINT, ...extraMirrors])
    .filter(Boolean)
    .map((endpoint) => endpoint.replace(/\/+$/, ''));

  return endpoints.map((endpoint) => `${endpoint}/${repo}/resolve/${revision}/${resolvedFile}`);
}

export function resolveOCRModelDownloadCandidates(options = {}) {
  return {
    det: resolveOCRFileDownloadCandidates(options.detFile || getOCRFile('det'), options),
    rec: resolveOCRFileDownloadCandidates(options.recFile || getOCRFile('rec'), options),
    dict: resolveOCRFileDownloadCandidates(options.dictFile || getOCRFile('dict'), options),
  };
}

export class OCRRuntime {
  #paths;
  #autoDownload;
  #downloadTimeoutMs;
  #probeTimeoutMs;
  #runtimePackageName;
  #runtimeModule;
  #initialized;
  #fallbackReason;

  constructor(options = {}) {
    this.#paths = getDefaultOCRModelPaths(options);
    this.#autoDownload = options.autoDownload ?? process.env.OCR_MODEL_AUTO_DOWNLOAD !== 'false';
    this.#downloadTimeoutMs = Number(
      options.downloadTimeoutMs ||
        process.env.OCR_MODEL_DOWNLOAD_TIMEOUT_MS ||
        DEFAULT_DOWNLOAD_TIMEOUT_MS,
    );
    this.#probeTimeoutMs = Number(
      options.probeTimeoutMs || process.env.OCR_MODEL_PROBE_TIMEOUT_MS || DEFAULT_PROBE_TIMEOUT_MS,
    );
    this.#runtimePackageName =
      options.runtimePackageName || process.env.OCR_RUNTIME_PACKAGE || null;
    this.#runtimeModule = null;
    this.#initialized = false;
    this.#fallbackReason = null;
  }

  async inspect() {
    const [detFile, recFile, dictFile] = await Promise.all([
      this.#getFileStatus(this.#paths.detPath),
      this.#getFileStatus(this.#paths.recPath),
      this.#getFileStatus(this.#paths.dictPath),
    ]);
    const runtime = await this.#inspectRuntimePackage();
    return {
      initialized: this.#initialized,
      runtime,
      ready:
        runtime.available &&
        detFile.exists &&
        recFile.exists &&
        dictFile.exists &&
        !this.#fallbackReason,
      fallbackReason: this.#fallbackReason,
      modelRoot: this.#paths.root,
      files: {
        det: { path: this.#paths.detPath, file: getOCRFile('det'), ...detFile },
        rec: { path: this.#paths.recPath, file: getOCRFile('rec'), ...recFile },
        dict: { path: this.#paths.dictPath, file: getOCRFile('dict'), ...dictFile },
      },
      autoDownload: this.#autoDownload,
      downloadTimeoutMs: this.#downloadTimeoutMs,
      probeTimeoutMs: this.#probeTimeoutMs,
      downloadCandidates: resolveOCRModelDownloadCandidates(),
    };
  }

  async prepareModel(options = {}) {
    await this.#ensureFileAvailable('det', this.#paths.detPath, getOCRFile('det'), options);
    await this.#ensureFileAvailable('rec', this.#paths.recPath, getOCRFile('rec'), options);
    await this.#ensureFileAvailable('dict', this.#paths.dictPath, getOCRFile('dict'), options);
    return await this.inspect();
  }

  async initialize() {
    if (this.#initialized) {
      return;
    }

    try {
      this.#runtimeModule = await this.#loadRuntimePackage();
      await this.prepareModel({ probeCandidates: false });
      this.#initialized = true;
      this.#fallbackReason = null;
    } catch (error) {
      this.#fallbackReason = error.message;
      this.#initialized = true;
    }
  }

  async recognize(imagePath, options = {}) {
    if (!imagePath) {
      throw new Error('OCR image path is required.');
    }

    await this.prepareModel(options);
    const runtimeModule = this.#runtimeModule || (await this.#loadRuntimePackage());
    return await this.#invokeRuntimeOCR(runtimeModule, imagePath, options);
  }

  async #inspectRuntimePackage() {
    const candidates = runtimePackageCandidates(this.#runtimePackageName);
    for (const packageName of candidates) {
      try {
        await import(packageName);
        return { available: true, packageName, candidates };
      } catch (error) {
        if (!isModuleNotFound(error, packageName)) {
          return { available: false, packageName, candidates, error: error.message };
        }
      }
    }
    return {
      available: false,
      packageName: null,
      candidates,
      error: `OCR runtime package not available. Tried: ${candidates.join(', ')}`,
    };
  }

  async #loadRuntimePackage() {
    const runtime = await this.#inspectRuntimePackage();
    if (!runtime.available) {
      throw new Error(runtime.error);
    }
    return await import(runtime.packageName);
  }

  async #invokeRuntimeOCR(runtimeModule, imagePath, options = {}) {
    const runtimeOptions = {
      ...options,
      imagePath,
      detModelPath: this.#paths.detPath,
      recModelPath: this.#paths.recPath,
      dictPath: this.#paths.dictPath,
      modelRoot: this.#paths.root,
    };
    const directFunction =
      firstFunction(runtimeModule, ['recognize', 'ocr', 'runOCR', 'run', 'default']) || null;

    if (directFunction) {
      return await directFunction(imagePath, runtimeOptions);
    }

    const createFunction = firstFunction(runtimeModule, ['createOCR', 'createOcr', 'create']);
    if (createFunction) {
      const engine = await createFunction(runtimeOptions);
      return await invokeEngine(engine, imagePath, runtimeOptions);
    }

    const OCRClass = runtimeModule.OCR || runtimeModule.Ocr || null;
    if (typeof OCRClass === 'function') {
      const engine = new OCRClass(runtimeOptions);
      return await invokeEngine(engine, imagePath, runtimeOptions);
    }

    throw new Error(
      'OCR runtime package loaded, but no supported OCR API was found. Expected recognize(), ocr(), createOCR(), or OCR.',
    );
  }

  async #ensureFileAvailable(kind, destinationPath, file, options = {}) {
    if (existsSync(destinationPath) || !this.#autoDownload) {
      return;
    }

    await mkdir(dirname(destinationPath), { recursive: true });
    const candidates = resolveOCRFileDownloadCandidates(file);
    const rankedCandidates = await this.#rankDownloadCandidates(candidates, {
      ...options,
      kind,
    });
    const selected = rankedCandidates[0];

    if (!selected) {
      throw new Error(`${file} is missing and no download candidates are configured.`);
    }

    try {
      options.onDownloadSelected?.({ ...selected, kind, file, destinationPath });
      await this.#downloadFile(selected.url, destinationPath, {
        ...options,
        kind,
        file,
        destinationPath,
      });
    } catch (error) {
      const probeSummary = rankedCandidates
        .map(
          (candidate) =>
            `${candidate.url}: ${candidate.available ? 'available' : candidate.error || 'unavailable'}`,
        )
        .join('; ');
      throw new Error(
        `${file} is missing and selected download failed. Selected: ${selected.url}: ${error.message}. Probes: ${probeSummary}`,
      );
    }
  }

  async #rankDownloadCandidates(candidates, options = {}) {
    if (candidates.length <= 1 || options.probeCandidates === false) {
      return candidates.map((url, index) => ({
        url,
        index,
        available: true,
        durationMs: 0,
        totalBytes: null,
      }));
    }

    options.onDownloadProbeStart?.({
      kind: options.kind,
      candidates,
      timeoutMs: this.#probeTimeoutMs,
    });
    const probes = await Promise.all(
      candidates.map((url, index) => this.#probeDownloadCandidate(url, index)),
    );

    for (const probe of probes) {
      options.onDownloadProbeResult?.({ ...probe, kind: options.kind });
    }

    const available = probes
      .filter((probe) => probe.available)
      .sort((a, b) => a.durationMs - b.durationMs || a.index - b.index);

    if (available.length > 0) {
      return available;
    }

    return probes.sort((a, b) => a.index - b.index);
  }

  async #probeDownloadCandidate(url, index) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#probeTimeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
      });
      const durationMs = Date.now() - startedAt;
      const totalBytes =
        Number(
          response.headers?.get?.('content-length') || response.headers?.get?.('x-linked-size'),
        ) || null;

      if (!response.ok) {
        return {
          url,
          index,
          available: false,
          status: response.status,
          durationMs,
          totalBytes,
          error: `HTTP ${response.status}`,
        };
      }

      return {
        url,
        index,
        available: true,
        status: response.status,
        durationMs,
        totalBytes,
        error: null,
      };
    } catch (error) {
      return {
        url,
        index,
        available: false,
        status: null,
        durationMs: Date.now() - startedAt,
        totalBytes: null,
        error:
          error?.name === 'AbortError'
            ? `probe timed out after ${this.#probeTimeoutMs}ms`
            : error.message,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async #downloadFile(url, destinationPath, options = {}) {
    const tmpPath = `${destinationPath}.download`;
    await rm(tmpPath, { force: true });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#downloadTimeoutMs);
    try {
      options.onDownloadStart?.({ ...options, url, timeoutMs: this.#downloadTimeoutMs });
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const totalBytes = Number(response.headers?.get?.('content-length')) || null;
      let downloadedBytes = 0;
      options.onDownloadProgress?.({ ...options, url, downloadedBytes, totalBytes });

      const progress = new Transform({
        transform(chunk, encoding, callback) {
          downloadedBytes += chunk.length;
          options.onDownloadProgress?.({ ...options, url, downloadedBytes, totalBytes });
          callback(null, chunk);
        },
      });

      await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(tmpPath));
      const fileStat = await stat(tmpPath);
      if (fileStat.size === 0) {
        throw new Error('Downloaded file is empty');
      }
      await rename(tmpPath, destinationPath);
      options.onDownloadComplete?.({ ...options, url, bytes: fileStat.size });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`download timed out after ${this.#downloadTimeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      await rm(tmpPath, { force: true });
    }
  }

  async #getFileStatus(path) {
    try {
      const fileStat = await stat(path);
      return {
        exists: true,
        bytes: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString(),
      };
    } catch {
      return {
        exists: false,
        bytes: 0,
        modifiedAt: null,
      };
    }
  }
}

function getOCRFile(kind) {
  if (kind === 'det') {
    return process.env.OCR_DET_MODEL_FILE || DEFAULT_OCR_DET_FILE;
  }
  if (kind === 'rec') {
    return process.env.OCR_REC_MODEL_FILE || DEFAULT_OCR_REC_FILE;
  }
  if (kind === 'dict') {
    return process.env.OCR_DICT_FILE || DEFAULT_OCR_DICT_FILE;
  }
  return '';
}

function envUrlForFile(file) {
  if (file === getOCRFile('det')) {
    return process.env.OCR_DET_MODEL_URL || null;
  }
  if (file === getOCRFile('rec')) {
    return process.env.OCR_REC_MODEL_URL || null;
  }
  if (file === getOCRFile('dict')) {
    return process.env.OCR_DICT_URL || null;
  }
  return null;
}

function splitEnvList(value) {
  return String(value || '')
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function runtimePackageCandidates(preferred) {
  return uniqueStrings([preferred, 'ulimit-orc', 'ulimit-ocr']);
}

function isModuleNotFound(error, packageName) {
  return (
    error?.code === 'ERR_MODULE_NOT_FOUND' &&
    String(error.message || '').includes(`'${packageName}'`)
  );
}

function firstFunction(moduleObject, names) {
  for (const name of names) {
    if (typeof moduleObject?.[name] === 'function') {
      return moduleObject[name].bind(moduleObject);
    }
  }
  return null;
}

async function invokeEngine(engine, imagePath, options) {
  const method = firstFunction(engine, ['recognize', 'ocr', 'runOCR', 'run', 'process']);
  if (!method) {
    throw new Error('OCR engine was created, but no recognize/ocr/run method was found.');
  }
  return await method(imagePath, options);
}
