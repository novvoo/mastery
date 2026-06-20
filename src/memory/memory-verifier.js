import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

export class MemoryVerifier {
  #workingDir;

  constructor(workingDir) {
    this.#workingDir = workingDir;
  }

  async verifyFileReference(memory) {
    if (!memory.source || memory.source.type !== 'file') {
      return { valid: true, message: 'No file reference to verify' };
    }

    const filePath = join(this.#workingDir, memory.source.path);

    if (!existsSync(filePath)) {
      return {
        valid: false,
        message: `File not found: ${memory.source.path}`,
      };
    }

    const fileStat = statSync(filePath);
    const fileModified = fileStat.mtime.getTime();

    if (memory.timestamp < fileModified) {
      return {
        valid: false,
        message: `File was modified after memory was created. File: ${memory.source.path}`,
      };
    }

    if (memory.source.contentHash) {
      const content = readFileSync(filePath, 'utf-8');
      const hash = this.#simpleHash(content);
      if (hash !== memory.source.contentHash) {
        return {
          valid: false,
          message: `File content has changed. Expected hash: ${memory.source.contentHash}`,
        };
      }
    }

    return { valid: true, message: 'File reference verified' };
  }

  async verifyFunctionReference(memory) {
    if (!memory.source || memory.source.type !== 'function') {
      return { valid: true, message: 'No function reference to verify' };
    }

    const filePath = join(this.#workingDir, memory.source.file);
    if (!existsSync(filePath)) {
      return {
        valid: false,
        message: `File not found: ${memory.source.file}`,
      };
    }

    const content = readFileSync(filePath, 'utf-8');
    const functionName = memory.source.name;

    if (!content.includes(`function ${functionName}`) &&
        !content.includes(`${functionName} = `) &&
        !content.includes(`${functionName}: `)) {
      return {
        valid: false,
        message: `Function not found in file: ${functionName}`,
      };
    }

    return { valid: true, message: 'Function reference verified' };
  }

  async verifyFlag(memory) {
    if (!memory.source || memory.source.type !== 'flag') {
      return { valid: true, message: 'No flag reference to verify' };
    }

    const filePath = join(this.#workingDir, memory.source.file || '.env');
    if (!existsSync(filePath)) {
      return {
        valid: false,
        message: `Config file not found: ${filePath}`,
      };
    }

    const content = readFileSync(filePath, 'utf-8');
    const flagName = memory.source.name;

    if (!content.includes(flagName)) {
      return {
        valid: false,
        message: `Flag not found: ${flagName}`,
      };
    }

    const expectedValue = memory.source.value;
    if (expectedValue !== undefined) {
      const match = content.match(new RegExp(`${flagName}\\s*=\\s*["']?([^"'\n]+)["']?`));
      if (!match || match[1] !== expectedValue) {
        return {
          valid: false,
          message: `Flag value mismatch. Expected: ${expectedValue}, found: ${match ? match[1] : 'not found'}`,
        };
      }
    }

    return { valid: true, message: 'Flag verified' };
  }

  async verifyMemory(memory) {
    if (!memory.source) {
      return { valid: true, message: 'No source to verify' };
    }

    switch (memory.source.type) {
      case 'file':
        return this.verifyFileReference(memory);
      case 'function':
        return this.verifyFunctionReference(memory);
      case 'flag':
        return this.verifyFlag(memory);
      default:
        return { valid: true, message: `Unknown source type: ${memory.source.type}` };
    }
  }

  #simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }
}