/**
 * 统一发布脚本
 * 发布 CLI 和 Desktop 两个版本
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

function warn(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

async function publishCLI() {
  info('Publishing CLI package to npm...');
  
  try {
    // 发布到 npm
    execSync('npm publish --access public', { 
      cwd: rootDir, 
      stdio: 'inherit' 
    });
    
    success('CLI package published successfully!');
    return true;
  } catch (err) {
    logError('Failed to publish CLI package');
    console.error(err);
    return false;
  }
}

async function publishDesktop() {
  info('Publishing Desktop application to GitHub Releases...');
  
  try {
    info('Building Desktop renderer...');
    execSync('npm run desktop:renderer:build', {
      cwd: rootDir,
      stdio: 'inherit'
    });

    // 发布 Desktop 到 GitHub
    execSync('npx electron-builder --publish always', { 
      cwd: rootDir, 
      stdio: 'inherit' 
    });

    info('Verifying Desktop package contents...');
    execSync('node scripts/verify-desktop-package.mjs', {
      cwd: rootDir,
      stdio: 'inherit'
    });
    
    success('Desktop application published successfully!');
    return true;
  } catch (err) {
    logError('Failed to publish Desktop application');
    console.error(err);
    return false;
  }
}

async function main() {
  log('\n🚀 AI Engineering Mastery Agent - Release Script');
  log('==================================================\n');
  
  // 检查是否在 CI 环境
  const isCI = process.env.CI === 'true';
  if (!isCI) {
    warn('Not in CI environment. You may need to authenticate first.');
    warn('Make sure you have logged in to npm and GitHub.\n');
  }
  
  // 发布 CLI
  const cliSuccess = await publishCLI();
  
  // 发布 Desktop
  const desktopSuccess = await publishDesktop();
  
  // 输出结果
  log('\n==================================================');
  if (cliSuccess && desktopSuccess) {
    success('All releases published successfully!');
    log('\n📦 Release artifacts:');
    log('   - npm: https://www.npmjs.com/package/ai-engineering-mastery-agent');
    log('   - GitHub Releases: Check your repository');
  } else {
    logError('Some releases failed');
    process.exit(1);
  }
}

main().catch(console.error);
