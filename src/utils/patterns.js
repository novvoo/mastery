export const TERMINATION_KEYWORDS = ['FINAL_ANSWER:', 'Answer:', 'TASK_COMPLETE'];

export const CODING_CONTEXT_KEYWORDS = [
  /代码|程序|脚本|html|css|javascript|typescript|js|单元测试|集成测试|函数|模块|功能|框架|库|接口|游戏引擎|游戏开发/,
  /文件|文档|文本|路径|目录|文件夹|读写|编辑|修改|删除|创建|新增|保存|读取|写入|复制|移动|重命名|替换|查找|搜索|解析|格式化/,
  /\b(html|css|javascript|typescript|jsx|tsx|python|java|go|golang|rust|c\+\+|c#|ruby|php|shell|bash|sql|json|yaml|yml|markdown|nodejs|node\.js|react|vue|angular|django|flask|spring|express|pygame|pandas|numpy|tensorflow|pytorch|api|cli|sdk|library|framework)\b/,
  /\b(file|files|document|text|path|directory|folder|read|write|edit|delete|create|add|save|load|copy|move|rename|replace|find|search|parse|format|filesystem|file system)\b/,
  /\b(code|coding|refactor|unit test|integration test|write tests?|add tests?|debug|compile|build|deploy)\b/,
];

export const MODIFICATION_VERB_PATTERNS = [
  /(写|创建|新建|修改|修复|实现|生成|开发|重构|编写|制作|做|做一个|添加|增加|更新|调试|重构|优化|改进|变更|删除|移除|插入|替换).*(代码|文件|程序|脚本|html|css|js|功能|模块|函数|游戏|库|框架|插件|扩展|接口|配置|工具|命令行|cli|网站|应用|系统|平台)/,
  /\b(implement|create|build|write|develop|generate|add|edit|modify|fix|update|refactor|debug|compile|deploy|remove|delete|insert|replace|change|improve|optimize)\b.*\b(file|files|code|program|script|function|module|class|component|feature|api|endpoint|service|database|db|table|schema|test|auth|login|jwt|token|route|router|server|client|middleware|model|config|setting|pipeline|workflow|plugin|extension|library|framework|dependency|game|app|application|website|site|page|ui|interface|command|cli|tool|package)\b/,
];

export const CODING_VERB_CONTEXT_PATTERNS = [
  /写.*(代码|程序|文件|脚本|html|css|js|功能|模块|函数|游戏|库|框架|插件|扩展|接口|配置|工具|命令行|cli)|(创建|新建|修改|修复|实现|生成|开发|重构|编写|制作|做|做一个|添加|增加|更新|调试).*(代码|文件|程序|脚本|html|css|js|功能|模块|函数|游戏|库|框架|插件|扩展|接口|配置|工具|命令行|cli|网站|应用|系统|平台)/,
  /\b(implement|create|build|write|develop|generate|add|edit|modify|fix|update)\b.*\b(file|files|code|program|script|function|module|class|component|feature|api|endpoint|service|database|db|table|schema|test|auth|login|jwt|token|route|router|server|client|middleware|model|config|setting|pipeline|workflow|plugin|extension|library|framework|dependency|game|app|application|website|site|page|ui|interface|command|cli|tool|package)\b/,
  /\b(file|files|code|program|script|function|module|class|component|feature|api|endpoint|service|database|db|table|schema|test|auth|login|jwt|token|route|router|server|client|middleware|model|config|setting|pipeline|workflow|plugin|extension|library|framework|dependency|game|app|application|website|site|page|ui|interface|command|cli|tool|package)\b.*\b(implement|create|build|write|develop|generate|add|edit|modify|fix|update)\b/,
];

export const READ_ONLY_PATTERNS = [
  /查看|检查|看下|分析|阅读|读|统计|列出|浏览|查找|搜索/,
  /\b(inspect|check|view|read|list|count|show|search|find|browse|analyze|review)\b/,
];

export const PLAN_BLACKLIST_PATTERNS = [
  /\b(是什么|什么是|how to|how do i|what is|explain|解释|说明|介绍)\b/i,
  /\b(帮助|help|命令|command|怎么用|how to use|usage)\b/i,
  /\b(状态|status|当前|current|现在|now|版本|version)\b/i,
  /\b(列出|list|显示|show|查看|view|看看|看看有哪些)\b/i,
  /\b(搜索|search|查找|find|grep|locate)\b/i,
  /\b(阅读|read|分析|analyze|审查|review|检查|check)\b/i,
  /\b(统计|count|数量|number|多少|how many)\b/i,
];

export const SEMANTIC_RISK_DOMAINS = [
  {
    id: 'units_timing',
    label: 'units/time/animation semantics',
    weight: 3,
    pattern:
      /时间|速度|帧|毫秒|秒|定时|计时|循环|动画|游戏|物理|实时|fps|frame|clock|tick|speed|interval|timeout|timer|animation|game|physics|realtime|real-time/i,
    checklist:
      'track units in variable names and API arguments; separate render FPS from simulation/update intervals; verify user-visible timing or movement behavior',
  },
  {
    id: 'api_semantics',
    label: 'third-party API semantics',
    weight: 3,
    pattern:
      /api|sdk|库|框架|pygame|three\.js|react|vue|express|fastapi|requestanimationframe|setinterval|settimeout|websocket|http|fetch/i,
    checklist:
      'confirm parameter meanings, return values, lifecycle constraints, and error behavior before treating a call as correct',
  },
  {
    id: 'state_transitions',
    label: 'state transition invariants',
    weight: 3,
    pattern:
      /状态|状态机|胜负|分数|移动|碰撞|合并|撤销|重试|缓存|session|state|fsm|transition|score|collision|merge|retry|cache/i,
    checklist:
      'verify state invariants, edge transitions, reset behavior, and repeated-action behavior',
  },
  {
    id: 'concurrency_io',
    label: 'async/concurrency/io semantics',
    weight: 4,
    pattern:
      /并发|异步|队列|锁|流|文件|网络|超时|重试|async|await|promise|concurrent|parallel|queue|lock|stream|file|network|timeout|retry/i,
    checklist:
      'check ordering, cancellation, timeout/retry behavior, idempotency, and partial failure handling',
  },
  {
    id: 'security_boundary',
    label: 'security/input boundary semantics',
    weight: 5,
    pattern:
      /安全|权限|认证|登录|密钥|token|注入|沙箱|secret|password|auth|permission|sanitize|injection|sandbox|xss|csrf/i,
    checklist:
      'validate trust boundaries, secrets handling, escaping/sanitization, and permission checks',
  },
];

export const HIGH_RISK_FILE_PATTERNS = [
  /(index|main|app|server|router|route|controller|service|middleware|handler)\.(js|ts|jsx|tsx|py|go|rs)$/i,
  /(auth|security|permission|session|token|secret|password)\.(js|ts|jsx|tsx|py|go)$/i,
  /(package\.json|tsconfig\.json|webpack\.config|vite\.config|babel\.config|\.eslintrc|\.gitignore)$/i,
  /\.(test|spec)\.(js|ts|jsx|tsx|py)$/i,
];

export const LOW_RISK_FILE_PATTERNS = [
  /\.(md|txt|csv|log|yml|yaml|toml)$/i,
  /(readme|changelog|todo|notes?)\./i,
];

export const TRIVIAL_TEXT_PATTERNS = [
  /\b(typo|拼写|文案|注释|comment|rename only|只改名)\b/i,
  /\b(simple|standalone|single[- ]file|demo|示例|quick|小)\b/i,
  /(创建|新建|写)\s*(一个|单个|独立)?\s*(html|\.html)\s*(文件)?/i,
];

export const RUNTIME_VERIFICATION_COMMAND_PATTERNS = [
  /\b(test|tests|testing|spec)\b/i,
  /\b(lint|linting|eslint|prettier)\b/i,
  /\b(build|compile|bundle|tsc|webpack|rollup|vite build|babel)\b/i,
  /\b(type.?check|typecheck|check|type-?check)\b/i,
  /\b(npm|pnpm|yarn|bun|node|python|pytest|vitest|jest|mocha|cargo|go test|dotnet test|mvn test|gradle test)\b/i,
  /\b(verify|validate|audit)\b/i,
];

export const MUTATION_SHELL_COMMAND_PATTERNS = [
  /(^|\s)(bun|npm|pnpm|yarn|npx|node|python|pytest|vitest|jest|eslint|tsc|git|mkdir|touch|cp|mv|rm|sed|perl)\b/i,
  /(>|>>|tee)\s*\w/i,
  /apply_patch/i,
];

export const SECTION_KEYWORDS_EN = [
  'experience',
  'work experience',
  'professional experience',
  'education',
  'academic background',
  'skills',
  'technical skills',
  'projects',
  'project',
  'summary',
  'objective',
  'about',
  'certifications',
  'certificates',
  'awards',
  'honors',
  'publications',
  'references',
  'contact',
  'languages',
  'introduction',
  'background',
  'methodology',
  'methods',
  'results',
  'discussion',
  'conclusion',
  'appendix',
  'overview',
  'key results',
  'limitations',
  'related work',
];

export const SECTION_KEYWORDS_ZH = [
  '教育背景',
  '教育经历',
  '学历',
  '学习经历',
  '工作经历',
  '工作经验',
  '职业经历',
  '任职经历',
  '从业经历',
  '项目经验',
  '项目经历',
  '项目',
  '专业技能',
  '技能',
  '核心技能',
  '技术栈',
  '个人简介',
  '自我介绍',
  '个人评价',
  '自我评价',
  '简介',
  '摘要',
  '荣誉奖项',
  '获奖情况',
  '荣誉',
  '奖项',
  '证书',
  '资格证书',
  '认证',
  '论文发表',
  '发表',
  '出版物',
  '语言能力',
  '语言',
  '联系方式',
  '联系',
  '求职意向',
  '意向',
  '概述',
  '背景',
  '方法',
  '结果',
  '讨论',
  '结论',
  '附录',
  '相关工作',
  '参考文献',
];

export const DANGEROUS_SHELL_PATTERNS = [
  /(?:^|[\s;&|`$()])(?:\/\S+\/)?rm\s+(?:-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*|--recursive\s+--force)\s+(?:\/|~|\.\.\/|\$\{|`)/,
  /(?:^|[\s;&|`$()])(?:\/\S+\/)?rm\s+-[a-zA-Z]*(?:rf|fr)[a-zA-Z]*\s+(?:\/|~|\.\.)/,
  /(?:^|[\s;&|`$()])(?:mkfs|mkswap|dd|shred)\b/,
  />\s*\/dev\//,
  /chmod\s+(?:-R\s+)?777\s+(?:\/|~|\.\.)/,
  /(?:curl|wget|aria2c|python|python3|node)\b[^\n;|&`]*\|\s*(?:ba|z|k|da)?sh\b/,
  /(?:curl|wget)\b[^\n;|&`]*>\s*(?:\/tmp|\/var)\/.*\.(?:sh|py|pl)\b/,
  /:\s*\(\s*\)\s*\{[^{}]*\}\s*;\s*:/,
  /\b(?:sudo|su|doas|pkexec)\s+-[a-zA-Z]*[iSs]\b/,
  />\s*(?:\/etc|\/usr|\/boot|\/proc\/sys|\/sys)\//,
];

export const NETWORK_COMMAND_PATTERN =
  /\b(curl|wget|ssh|scp|sftp|rsync|nc|netcat|telnet|ftp|git\s+clone|git\s+fetch|git\s+pull|npm\s+install|bun\s+install|pnpm\s+install|yarn\s+install|pip\s+install)\b/i;

export const WRITE_COMMAND_PATTERN =
  /\b(>|>>|tee|touch|mkdir|rm|rmdir|mv|cp|install|chmod|chown|sed\s+-i|perl\s+-i)\b/i;

export const GENERATED_FILE_PATTERNS = [
  /\.d\.ts$/,
  /\.generated\./,
  /-generated\./,
  /\/generated\//,
  /\/dist\//,
  /\/build\//,
  /\/\.next\//,
  /\/coverage\//,
  /\.min\.js$/,
  /\.min\.css$/,
  /-lock\.json$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /bun\.lock$/,
];

export const MINIFIED_FILE_PATTERNS = [/\.min\.js$/, /\.min\.css$/, /\.min\.mjs$/];

export const LOCKFILE_PATTERNS = [
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /bun\.lock$/,
  /Cargo\.lock$/,
  /Gemfile\.lock$/,
  /poetry\.lock$/,
];

export const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.ico',
  '.webp',
  '.svg',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.xz',
  '.7z',
  '.rar',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.wasm',
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.wav',
  '.flac',
  '.ogg',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.eot',
  '.db',
  '.sqlite',
  '.sqlite3',
  '.pak',
  '.bin',
  '.dat',
]);

export const CODING_KEYWORDS = [...CODING_CONTEXT_KEYWORDS, ...CODING_VERB_CONTEXT_PATTERNS];

export function matchAnyPattern(text, patterns) {
  const normalized = String(text || '').toLowerCase();
  return patterns.some((pattern) => {
    if (pattern instanceof RegExp) {
      return pattern.test(normalized);
    }
    return normalized.includes(pattern);
  });
}

export function matchAnyKeyword(text, keywords) {
  const normalized = String(text || '').toLowerCase();
  return keywords.some((keyword) => {
    if (keyword instanceof RegExp) {
      return keyword.test(normalized);
    }
    return normalized.includes(keyword.toLowerCase());
  });
}

export function matchPatternList(text, patterns) {
  const normalized = String(text || '').toLowerCase();
  return patterns.filter((pattern) => {
    if (pattern instanceof RegExp) {
      return pattern.test(normalized);
    }
    return normalized.includes(pattern);
  });
}

export function inferSemanticRiskDomains(userInput) {
  const text = String(userInput || '');
  return SEMANTIC_RISK_DOMAINS.filter((domain) => domain.pattern.test(text)).map(
    ({ id, label, weight, checklist }) => ({ id, label, weight, checklist }),
  );
}

export function isInPlanBlacklist(userInput) {
  const text = String(userInput || '').trim();
  return PLAN_BLACKLIST_PATTERNS.some((p) => p.test(text));
}

export function isCliCommand(userInput) {
  const trimmed = String(userInput || '').trim();
  return trimmed.startsWith('/') && trimmed.length <= 40 && !trimmed.includes('\n');
}

export function isCodingTask(userInput) {
  const text = String(userInput || '').toLowerCase();
  const cli = isCliCommand(userInput);
  return !cli && CODING_KEYWORDS.some((p) => p.test(text));
}

export function hasModificationIntent(userInput) {
  const text = String(userInput || '').toLowerCase();
  return MODIFICATION_VERB_PATTERNS.some((p) => p.test(text));
}

export function isReadOnlyTask(userInput) {
  const text = String(userInput || '').toLowerCase();
  return READ_ONLY_PATTERNS.some((p) => p.test(text));
}

export function isTrivialTask(userInput) {
  const text = String(userInput || '').toLowerCase();
  const isCoding = isCodingTask(userInput);
  return isCoding && TRIVIAL_TEXT_PATTERNS.some((p) => p.test(text));
}

export function isGeneratedFile(filePath) {
  return GENERATED_FILE_PATTERNS.some((p) => p.test(filePath));
}

export function isMinifiedFile(filePath) {
  return MINIFIED_FILE_PATTERNS.some((p) => p.test(filePath));
}

export function isLockfile(filePath) {
  return LOCKFILE_PATTERNS.some((p) => p.test(filePath));
}

export function isBinaryExtension(filePath) {
  const lower = filePath.toLowerCase();
  for (const ext of BINARY_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return true;
    }
  }
  return false;
}

export function isDangerousCommand(command) {
  return DANGEROUS_SHELL_PATTERNS.some((p) => p.test(command));
}

export function isNetworkCommand(command) {
  return NETWORK_COMMAND_PATTERN.test(command);
}

export function isWriteCommand(command) {
  return WRITE_COMMAND_PATTERN.test(command);
}

export function isRuntimeVerificationCommand(command) {
  const text = String(command || '').toLowerCase();
  return RUNTIME_VERIFICATION_COMMAND_PATTERNS.some((p) => p.test(text));
}

export function isMutationShellCommand(command) {
  const text = String(command || '').toLowerCase();
  return MUTATION_SHELL_COMMAND_PATTERNS.some((p) => p.test(text));
}

export default {
  TERMINATION_KEYWORDS,
  CODING_CONTEXT_KEYWORDS,
  MODIFICATION_VERB_PATTERNS,
  CODING_VERB_CONTEXT_PATTERNS,
  READ_ONLY_PATTERNS,
  PLAN_BLACKLIST_PATTERNS,
  SEMANTIC_RISK_DOMAINS,
  HIGH_RISK_FILE_PATTERNS,
  LOW_RISK_FILE_PATTERNS,
  TRIVIAL_TEXT_PATTERNS,
  RUNTIME_VERIFICATION_COMMAND_PATTERNS,
  MUTATION_SHELL_COMMAND_PATTERNS,
  SECTION_KEYWORDS_EN,
  SECTION_KEYWORDS_ZH,
  DANGEROUS_SHELL_PATTERNS,
  NETWORK_COMMAND_PATTERN,
  WRITE_COMMAND_PATTERN,
  GENERATED_FILE_PATTERNS,
  MINIFIED_FILE_PATTERNS,
  LOCKFILE_PATTERNS,
  BINARY_EXTENSIONS,
  CODING_KEYWORDS,
  matchAnyPattern,
  matchAnyKeyword,
  matchPatternList,
  inferSemanticRiskDomains,
  isInPlanBlacklist,
  isCliCommand,
  isCodingTask,
  hasModificationIntent,
  isReadOnlyTask,
  isTrivialTask,
  isGeneratedFile,
  isMinifiedFile,
  isLockfile,
  isBinaryExtension,
  isDangerousCommand,
  isNetworkCommand,
  isWriteCommand,
  isRuntimeVerificationCommand,
  isMutationShellCommand,
};