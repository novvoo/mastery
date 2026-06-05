/**
 * Desktop 打包脚本
 */

import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

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

// 解析命令行参数
const args = process.argv.slice(2);
const platforms = {
  win: args.includes('--win'),
  mac: args.includes('--mac'),
  linux: args.includes('--linux'),
};

// 如果没有指定平台，默认构建当前平台
const buildAll = !platforms.win && !platforms.mac && !platforms.linux;
const currentPlatform = process.platform;
if (buildAll) {
  platforms.win = currentPlatform === 'win32';
  platforms.mac = currentPlatform === 'darwin';
  platforms.linux = currentPlatform === 'linux';
}

async function buildDesktop() {
  info('Building Desktop application...');
  
  try {
    info('Building Desktop renderer...');
    execSync('npm run desktop:renderer:build', {
      cwd: rootDir,
      stdio: 'inherit'
    });

    let cmd = 'npx electron-builder';
    
    if (platforms.win) cmd += ' --win';
    if (platforms.mac) cmd += ' --mac';
    if (platforms.linux) cmd += ' --linux';
    
    // 添加额外参数
    if (args.includes('--dir')) cmd += ' --dir';
    if (args.includes('--publish')) cmd += ' --publish always';
    
    execSync(cmd, { 
      cwd: rootDir, 
      stdio: 'inherit' 
    });
    
    success('Desktop application built successfully!');
    return true;
  } catch (err) {
    logError('Failed to build Desktop application');
    console.error(err);
    return false;
  }
}

async function main() {
  log('\n🖥️  AI Engineering Mastery Agent - Desktop Build');
  log('==================================================\n');
  
  const success = await buildDesktop();
  
  if (success) {
    log('\n==================================================');
    log(`📦 Desktop build complete!`);
    log(`   Output: ${rootDir}/release/`);
  } else {
    process.exit(1);
  }
}

main().catch(console.error);
