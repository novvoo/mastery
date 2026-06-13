/**
 * Desktop 发布脚本
 */

import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');
const desktopReleaseDir = join(rootDir, 'release', 'desktop');

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

async function publishDesktop() {
  info('Publishing Desktop application to GitHub Releases...');
  
  try {
    info('Building Desktop renderer...');
    execSync('bun run desktop:renderer:build', {
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
  log('\n🖥️  Desktop Release Script');
  log('===========================\n');
  
  const success = await publishDesktop();
  
  if (success) {
    log('\n===========================');
    success('Desktop app published to GitHub Releases!');
    log(`   Local artifacts: ${desktopReleaseDir}/`);
  } else {
    process.exit(1);
  }
}

main().catch(console.error);
