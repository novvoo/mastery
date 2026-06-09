#!/bin/bash
# AI Engineering Mastery Agent - 打包脚本

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║     AI Engineering Mastery Agent - Build Package          ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# 版本号
VERSION=$(node -p "require('./package.json').version")
PACKAGE_NAME="ai-engineering-mastery-agent"
BUILD_DIR="./dist"
ARCHIVE_NAME="${PACKAGE_NAME}-v${VERSION}.tar.gz"

echo "📦 Package: ${PACKAGE_NAME}"
echo "📋 Version: ${VERSION}"
echo ""

# 清理旧构建
echo "🧹 Cleaning old builds..."
rm -rf ${BUILD_DIR}
mkdir -p ${BUILD_DIR}

# 创建目录结构
echo "📁 Creating directory structure..."
mkdir -p ${BUILD_DIR}/${PACKAGE_NAME}/{src,config,docs,tests}

# 复制核心源代码
echo "📄 Copying source files..."
cp -r src/* ${BUILD_DIR}/${PACKAGE_NAME}/src/

# 复制配置文件
echo "⚙️  Copying configuration files..."
cp package.json ${BUILD_DIR}/${PACKAGE_NAME}/
cp package-lock.json ${BUILD_DIR}/${PACKAGE_NAME}/ 2>/dev/null || true
cp .env.example ${BUILD_DIR}/${PACKAGE_NAME}/
cp .gitignore ${BUILD_DIR}/${PACKAGE_NAME}/

# 复制文档
echo "📚 Copying documentation..."
cp README.md ${BUILD_DIR}/${PACKAGE_NAME}/

# 复制测试文件
echo "🧪 Copying test files..."
cp test-*.mjs ${BUILD_DIR}/${PACKAGE_NAME}/

# 复制验证脚本
cp verify-all.mjs ${BUILD_DIR}/${PACKAGE_NAME}/ 2>/dev/null || true

# 创建启动脚本
echo "🚀 Creating startup scripts..."
cat > ${BUILD_DIR}/${PACKAGE_NAME}/start.sh << 'EOF'
#!/bin/bash
# AI Engineering Mastery Agent 启动脚本

echo "🚀 Starting AI Engineering Mastery Agent..."

# 检查 Node.js 版本
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Error: Node.js 18+ required. Current: $(node --version)"
    exit 1
fi

# 检查 .env 文件
if [ ! -f .env ]; then
    echo "⚠️  Warning: .env file not found. Copying from .env.example..."
    cp .env.example .env
    echo "📝 Please edit .env file with your API keys before running."
fi

# 安装依赖（如果需要）
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# 启动应用
echo "✨ Starting agent..."
node src/index.js "$@"
EOF

chmod +x ${BUILD_DIR}/${PACKAGE_NAME}/start.sh

# 创建 Windows 启动脚本
cat > ${BUILD_DIR}/${PACKAGE_NAME}/start.bat << 'EOF'
@echo off
chcp 65001 >nul
echo 🚀 Starting AI Engineering Mastery Agent...

:: Check Node.js version
for /f "tokens=1 delims=." %%a in ('node --version') do (
    set NODE_MAJOR=%%a
)
set NODE_MAJOR=%NODE_MAJOR:~1%

if %NODE_MAJOR% LSS 18 (
    echo ❌ Error: Node.js 18+ required.
    exit /b 1
)

:: Check .env file
if not exist .env (
    echo ⚠️  Warning: .env file not found. Copying from .env.example...
    copy .env.example .env
    echo 📝 Please edit .env file with your API keys before running.
)

:: Install dependencies if needed
if not exist node_modules (
    echo 📦 Installing dependencies...
    npm install
)

:: Start application
echo ✨ Starting agent...
node src/index.js %*
EOF

# 创建安装脚本
cat > ${BUILD_DIR}/${PACKAGE_NAME}/install.sh << 'EOF'
#!/bin/bash
# AI Engineering Mastery Agent 安装脚本

echo "╔════════════════════════════════════════════════════════════╗"
echo "║     AI Engineering Mastery Agent - Installation           ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 18+ first."
    echo "   Visit: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node --version)
echo "✅ Node.js version: ${NODE_VERSION}"

# 检查 npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm not found. Please install npm."
    exit 1
fi

echo "✅ npm version: $(npm --version)"
echo ""

# 安装依赖
echo "📦 Installing dependencies..."
npm install

# 创建 .env 文件
if [ ! -f .env ]; then
    echo ""
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "⚠️  Please edit .env file and add your API keys:"
    echo "   - OPENAI_API_KEY"
    echo "   - OPENROUTER_API_KEY (optional)"
    echo "   - DEEPSEEK_API_KEY (optional)"
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "🚀 To start the agent, run:"
echo "   ./start.sh"
echo ""
echo "🧪 To run tests:"
echo "   npm test"
echo ""
EOF

chmod +x ${BUILD_DIR}/${PACKAGE_NAME}/install.sh

# 创建验证脚本
cat > ${BUILD_DIR}/${PACKAGE_NAME}/verify.sh << 'EOF'
#!/bin/bash
# AI Engineering Mastery Agent 验证脚本

echo "╔════════════════════════════════════════════════════════════╗"
echo "║     AI Engineering Mastery Agent - Verification           ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# 检查 Node.js
echo "🔍 Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found"
    exit 1
fi
NODE_VERSION=$(node --version | cut -d'v' -f2)
NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "❌ Node.js 18+ required. Current: ${NODE_VERSION}"
    exit 1
fi
echo "✅ Node.js ${NODE_VERSION}"

# 检查依赖
echo "🔍 Checking dependencies..."
if [ ! -d "node_modules" ]; then
    echo "❌ Dependencies not installed. Run: npm install"
    exit 1
fi
echo "✅ Dependencies installed"

# 检查 .env
echo "🔍 Checking configuration..."
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Copying from .env.example..."
    cp .env.example .env
fi
echo "✅ Configuration file exists"

# 运行测试
echo ""
echo "🧪 Running tests..."
npm test

echo ""
echo "✅ Verification complete!"
EOF

chmod +x ${BUILD_DIR}/${PACKAGE_NAME}/verify.sh

# 创建打包清单
cat > ${BUILD_DIR}/${PACKAGE_NAME}/MANIFEST.md << EOF
# AI Engineering Mastery Agent - Package Manifest

## Version
${VERSION}

## Package Contents

### Source Code
- \`src/\` - Core application source code
  - \`cli/\` - Command line interface
  - \`core/\` - Core modules (agent, tools, memory, etc.)
  - \`models/\` - LLM provider implementations
  - \`tools/\` - Tool implementations
  - \`memory/\` - Memory management
  - \`prompts/\` - System prompts
  - \`scheduler/\` - Task scheduling
  - \`errors/\` - Error handling

### Configuration
- \`package.json\` - Node.js package configuration
- \`.env.example\` - Environment variables template
- \`.gitignore\` - Git ignore rules

### Documentation
- \`README.md\` - Project documentation

### Tests
- \`test-unit.mjs\` - Unit tests (39 tests)
- \`test-integration.mjs\` - Integration tests (18 tests)
- \`test-core.mjs\` - Core feature tests (49 tests)
- \`test-security.mjs\` - Security tests (13 tests)
- \`test-all.mjs\` - Test runner

### Scripts
- \`start.sh\` / \`start.bat\` - Start the application
- \`install.sh\` - Install dependencies
- \`verify.sh\` - Verify installation

## Installation

1. Extract the package
2. Run \`./install.sh\` (Linux/Mac) or follow Windows instructions
3. Edit \`.env\` file with your API keys
4. Run \`./start.sh\` to start the agent

## Requirements

- Node.js 18+
- npm 9+
- API keys for LLM providers (OpenAI, OpenRouter, etc.)

## Total Tests
119 tests covering:
- Unit tests (39)
- Integration tests (18)
- Core features (49)
- Security tests (13)
EOF

# 创建压缩包
echo "📦 Creating archive..."
cd ${BUILD_DIR}
tar -czf ../${ARCHIVE_NAME} ${PACKAGE_NAME}
cd ..

# 计算文件大小
ARCHIVE_SIZE=$(du -h ${ARCHIVE_NAME} | cut -f1)

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                    Build Complete!                         ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "📦 Package: ${ARCHIVE_NAME}"
echo "📊 Size: ${ARCHIVE_SIZE}"
echo "📍 Location: $(pwd)/${ARCHIVE_NAME}"
echo ""
echo "✅ Package created successfully!"
echo ""
