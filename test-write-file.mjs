
// 最小测试：write_file 工具能否真实写文件
import { writeFileSync, rmSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createFileSystemTools } from './src/tools/filesystem/filesystem-tools.js';

// 模拟 memoryManager
const memoryManager = {
  updateFileMap: () => {},
  save: async () => {},
};

const tools = createFileSystemTools();
const writeFileTool = tools.find(t => t.name === 'write_file');

// 创建临时目录
const tmpDir = join(process.cwd(), '.test-write-file-tmp');
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

console.log('测试 1: 直接调用 write_file.handler');
const result1 = await writeFileTool.handler(
  { path: 'test.txt', content: 'Hello, world! 你好，世界！' },
  { workingDirectory: tmpDir, memoryManager }
);
console.log('结果:', result1);
console.log('文件是否存在:', existsSync(join(tmpDir, 'test.txt')));

console.log('\n测试 2: 检查文件内容');
if (existsSync(join(tmpDir, 'test.txt'))) {
  console.log('文件内容:', readFileSync(join(tmpDir, 'test.txt'), 'utf-8'));
}

console.log('\n测试 3: 测试 safeResolvePath 对上层目录的限制');
const result3 = await writeFileTool.handler(
  { path: '../outside.txt', content: '应该失败' },
  { workingDirectory: tmpDir, memoryManager }
);
console.log('结果:', result3);

console.log('\n测试 4: 测试嵌套目录写入');
const result4 = await writeFileTool.handler(
  { path: 'nested/sub/test.txt', content: 'Nested content' },
  { workingDirectory: tmpDir, memoryManager }
);
console.log('结果:', result4);
console.log('文件是否存在:', existsSync(join(tmpDir, 'nested/sub/test.txt')));
if (existsSync(join(tmpDir, 'nested/sub/test.txt'))) {
  console.log('嵌套目录内容:', readFileSync(join(tmpDir, 'nested/sub/test.txt'), 'utf-8'));
}

console.log('\n测试 5: 测试 base64 解码内容');
const result5 = await writeFileTool.handler(
  { path: 'b64.txt', content: 'aGVsbG8=' },
  { workingDirectory: tmpDir, memoryManager }
);
console.log('结果:', result5);

console.log('\n清理');
rmSync(tmpDir, { recursive: true, force: true });
console.log('测试完成');
