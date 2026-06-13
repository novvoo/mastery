/**
 * 统一打包脚本
 * 构建 CLI 和 Desktop 两个版本
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');
const cliReleaseDir = join(rootDir, 'release', 'cli');
const desktopReleaseDir = join(rootDir, 'release', 'desktop');

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

function warn(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

// 解析命令行参数
const args = process.argv.slice(2);
const platforms = {
  win: args.includes('--win'),
  mac: args.includes('--mac'),
  linux: args.includes('--linux'),
};

// 如果没有指定平台，默认构建所有
const buildAll = !platforms.win && !platforms.mac && !platforms.linux;
if (buildAll) {
  platforms.win = true;
  platforms.mac = true;
  platforms.linux = true;
}

async function buildCLI() {
  info('Building CLI package...');
  
  try {
    // 使用 npm pack 创建 tarball
    mkdirSync(cliReleaseDir, { recursive: true });
    execSync(`npm pack --pack-destination ${JSON.stringify(cliReleaseDir)}`, {
      cwd: rootDir, 
      stdio: 'inherit' 
    });
    
    success('CLI package built successfully');
    return true;
  } catch (err) {
    logError('Failed to build CLI package');
    console.error(err);
    return false;
  }
}

async function buildDesktop() {
  info('Building Desktop application...');
  
  try {
    info('Building Desktop renderer...');
    execSync('bun run desktop:renderer:build', {
      cwd: rootDir,
      stdio: 'inherit'
    });

    let cmd = 'npx electron-builder';
    
    if (platforms.win) cmd += ' --win';
    if (platforms.mac) cmd += ' --mac';
    if (platforms.linux) cmd += ' --linux';
    cmd += ' --publish never';
    
    execSync(cmd, { 
      cwd: rootDir, 
      stdio: 'inherit' 
    });

    info('Verifying Desktop package contents...');
    execSync('node scripts/verify-desktop-package.mjs', {
      cwd: rootDir,
      stdio: 'inherit'
    });
    
    success('Desktop application built successfully');
    return true;
  } catch (err) {
    logError('Failed to build Desktop application');
    console.error(err);
    return false;
  }
}

async function main() {
  log('\n🎯 AI Engineering Mastery Agent - Build Script');
  log('================================================\n');
  
  // 确保 release 目录存在
  const releaseDir = join(rootDir, 'release');
  if (!existsSync(releaseDir)) {
    mkdirSync(releaseDir, { recursive: true });
  }
  mkdirSync(cliReleaseDir, { recursive: true });
  mkdirSync(desktopReleaseDir, { recursive: true });
  
  // 构建 CLI
  const cliSuccess = await buildCLI();
  
  // 构建 Desktop
  const desktopSuccess = await buildDesktop();
  
  // 输出结果
  log('\n================================================');
  if (cliSuccess && desktopSuccess) {
    success('All builds completed successfully!');
    log('\n📦 Build artifacts:');
    log(`   - CLI: ${cliReleaseDir}/`);
    log(`   - Desktop: ${desktopReleaseDir}/`);
  } else {
    logError('Some builds failed');
    process.exit(1);
  }
}

main().catch(console.error);
