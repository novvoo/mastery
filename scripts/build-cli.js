/**
 * CLI 打包脚本
 */

import { execSync } from 'child_process';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');
const cliReleaseDir = join(rootDir, 'release', 'cli');

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function success(message) {
  log(`✅ ${message}`, 'green');
}

function info(message) {
  log(`ℹ️  ${message}`, 'blue');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

async function buildCLI() {
  info('Building CLI package...');
  
  try {
    // 先运行测试
    info('Running tests...');
    execSync('bun run test', { 
      cwd: rootDir, 
      stdio: 'inherit' 
    });
    
    // 创建 tarball
    info('Creating package tarball...');
    mkdirSync(cliReleaseDir, { recursive: true });
    execSync(`npm pack --pack-destination ${JSON.stringify(cliReleaseDir)}`, {
      cwd: rootDir, 
      stdio: 'inherit' 
    });
    
    success('CLI package built successfully!');
    return true;
  } catch (err) {
    logError('Failed to build CLI package');
    console.error(err);
    return false;
  }
}

async function main() {
  log('\n💻 AI Engineering Mastery Agent - CLI Build');
  log('==============================================\n');
  
  const success = await buildCLI();
  
  if (success) {
    log('\n==============================================');
    log(`📦 CLI package built!`);
    log(`   Output: ${cliReleaseDir}/`);
    log(`   Usage: npm install -g ./release/cli/ai-engineering-mastery-agent-*.tgz  # 或 bun install -g ...`);
  } else {
    process.exit(1);
  }
}

main().catch(console.error);
