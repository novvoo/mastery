/**
 * CLI 发布脚本
 */

import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

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

async function main() {
  log('\n💻 CLI Release Script');
  log('======================\n');
  
  const success = await publishCLI();
  
  if (success) {
    log('\n======================');
    log('📦 Published to npm!');
    log('   https://www.npmjs.com/package/mastery');
  } else {
    process.exit(1);
  }
}

main().catch(console.error);
