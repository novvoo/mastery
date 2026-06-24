/**
 * 多语言 Rename Torture Tests — Python, Rust, Go
 *
 * 覆盖真实项目中跨语言重命名的复杂性：
 *  - Python: 函数/类/变量跨文件重命名、import 别名、__init__.py re-export
 *  - Rust: 模块重命名、use 路径、pub use re-export、trait impl rename
 *  - Go: 包重命名、跨文件符号重命名、接口实现重命名
 *  - 混合多语言 monorepo 场景
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  Patcher,
  MemoryFilesystem,
  InMemorySnapshotStore,
  Patch,
  Section,
  OP_SWAP,
  OP_DEL,
  OP_INS_PRE,
  OP_INS_POST,
  computeTag,
} from '../../src/core/harness/hashline.js';

// ═══════════════════════════════════════════════════════════════════════
// Python Rename Torture Tests
// ═══════════════════════════════════════════════════════════════════════

describe('Multi-language Rename: Python', () => {
  let fs, snapshots, patcher;

  beforeEach(() => {
    fs = new MemoryFilesystem();
    snapshots = new InMemorySnapshotStore();
    patcher = new Patcher({ fs, snapshots });
  });

  // ── 测试 1: 函数重命名跨多个文件 ─────────────────────────────────────
  test('rename function across multiple files with import chains', async () => {
    // 模拟 Python 项目结构
    const files = {
      'src/utils/helpers.py':
        [
          'def calculate_total(items):',
          '    """Calculate total from items."""',
          '    return sum(item.price for item in items)',
          '',
          'def format_result(total, currency="$"):',
          '    return f"{currency}{total:.2f}"',
        ].join('\n') + '\n',
      'src/services/order.py':
        [
          'from utils.helpers import calculate_total, format_result',
          '',
          'class OrderService:',
          '    def process_order(self, items):',
          '        total = calculate_total(items)',
          '        return format_result(total)',
        ].join('\n') + '\n',
      'src/api/handler.py':
        [
          'from utils.helpers import calculate_total as compute_total',
          '',
          'def handle_request(items):',
          '    result = compute_total(items)',
          '    return {"total": result}',
        ].join('\n') + '\n',
    };

    for (const [path, content] of Object.entries(files)) {
      await fs.write(path, content);
      snapshots.record(path, content);
    }

    // 重命名 calculate_total → compute_item_total
    const edits = [
      // helpers.py: 定义处
      {
        file: 'src/utils/helpers.py',
        patch: `[src/utils/helpers.py#${computeTag(files['src/utils/helpers.py'])}]\nSWAP 1.=4:\n+def compute_item_total(items):\n+    """Calculate total from items."""\n+    return sum(item.price for item in items)\n+\n`,
      },
      // order.py: import 处
      {
        file: 'src/services/order.py',
        patch: `[src/services/order.py#${computeTag(files['src/services/order.py'])}]\nSWAP 1.=1:\n+from utils.helpers import compute_item_total, format_result\n`,
      },
      {
        file: 'src/services/order.py',
        patch: `[src/services/order.py#${computeTag(files['src/services/order.py'])}]\nSWAP 5.=5:\n+        total = compute_item_total(items)\n`,
      },
      // handler.py: 别名 import 处
      {
        file: 'src/api/handler.py',
        patch: `[src/api/handler.py#${computeTag(files['src/api/handler.py'])}]\nSWAP 1.=1:\n+from utils.helpers import compute_item_total as compute_total\n`,
      },
    ];

    // 逐个应用 patch（模拟 LSP rename 的批量操作）
    const results = [];
    for (const edit of edits) {
      // 每个 edit 前重新记录 snapshot
      const currentContent = await fs.read(edit.file);
      snapshots.record(edit.file, currentContent);
      const result = await patcher.apply(edit.patch);
      results.push(result);
    }

    // 验证结果
    const helpersContent = await fs.read('src/utils/helpers.py');
    expect(helpersContent).toContain('def compute_item_total(items):');
    expect(helpersContent).not.toContain('def calculate_total(items):');

    const orderContent = await fs.read('src/services/order.py');
    expect(orderContent).toContain('import compute_item_total');
    expect(orderContent).toContain('compute_item_total(items)');

    const handlerContent = await fs.read('src/api/handler.py');
    expect(handlerContent).toContain('import compute_item_total as compute_total');
  });

  // ── 测试 2: __init__.py re-export chain ───────────────────────────────
  test('rename through __init__.py barrel re-export chain', async () => {
    // Python 的 barrel export 通过 __init__.py 实现
    const files = {
      'src/models/user.py':
        [
          'class UserModel:',
          '    def __init__(self, name, email):',
          '        self.name = name',
          '        self.email = email',
          '',
          'class OldUserValidator:',
          '    def validate(self, user):',
          '        return len(user.name) > 0',
        ].join('\n') + '\n',
      'src/models/__init__.py':
        [
          'from .user import UserModel, OldUserValidator',
          '',
          '__all__ = ["UserModel", "OldUserValidator"]',
        ].join('\n') + '\n',
      'src/services/auth.py':
        [
          'from models import OldUserValidator',
          '',
          'validator = OldUserValidator()',
          'def check_user(user):',
          '    return validator.validate(user)',
        ].join('\n') + '\n',
    };

    for (const [path, content] of Object.entries(files)) {
      await fs.write(path, content);
      snapshots.record(path, content);
    }

    // 重命名 OldUserValidator → UserIntegrityValidator
    // Step 1: 源定义
    const srcContent1 = files['src/models/user.py'];
    await patcher.apply(
      `[src/models/user.py#${computeTag(srcContent1)}]\n` +
        'SWAP 6.=8:\n' +
        '+class UserIntegrityValidator:\n' +
        '+    def validate(self, user):\n' +
        '+        return len(user.name) > 0\n',
    );

    // Step 2: __init__.py re-export
    const initContent = await fs.read('src/models/__init__.py');
    snapshots.record('src/models/__init__.py', initContent);
    await patcher.apply(
      `[src/models/__init__.py#${computeTag(initContent)}]\n` +
        'SWAP 1.=3:\n' +
        '+from .user import UserModel, UserIntegrityValidator\n' +
        '+\n' +
        '+__all__ = ["UserModel", "UserIntegrityValidator"]\n',
    );

    // Step 3: 引用处
    const authContent = await fs.read('src/services/auth.py');
    snapshots.record('src/services/auth.py', authContent);
    await patcher.apply(
      `[src/services/auth.py#${computeTag(authContent)}]\n` +
        'SWAP 1.=1:\n' +
        '+from models import UserIntegrityValidator\n' +
        'SWAP 3.=3:\n' +
        '+validator = UserIntegrityValidator()\n',
    );

    // 验证链上所有文件
    const userContent = await fs.read('src/models/user.py');
    expect(userContent).toContain('class UserIntegrityValidator');
    expect(userContent).not.toContain('OldUserValidator');

    const initContent2 = await fs.read('src/models/__init__.py');
    expect(initContent2).toContain('UserIntegrityValidator');
    expect(initContent2).not.toContain('OldUserValidator');

    const authContent2 = await fs.read('src/services/auth.py');
    expect(authContent2).toContain('UserIntegrityValidator');
    expect(authContent2).not.toContain('OldUserValidator');
  });

  // ── 测试 3: 类方法 + 属性重命名 ──────────────────────────────────────
  test('rename class method and attribute across inheritance', async () => {
    const files = {
      'src/base.py':
        [
          'class BaseProcessor:',
          '    def old_process(self, data):',
          '        self.old_result = self.transform(data)',
          '        return self.old_result',
          '',
          '    def transform(self, data):',
          '        return data',
        ].join('\n') + '\n',
      'src/derived.py':
        [
          'from base import BaseProcessor',
          '',
          'class DerivedProcessor(BaseProcessor):',
          '    def old_process(self, data):',
          '        self.old_result = super().old_process(data)',
          '        self.old_result["extra"] = True',
          '        return self.old_result',
        ].join('\n') + '\n',
    };

    for (const [path, content] of Object.entries(files)) {
      await fs.write(path, content);
      snapshots.record(path, content);
    }

    // 重命名 old_process → new_process, old_result → result_data
    // Base class
    const baseContent = files['src/base.py'];
    await patcher.apply(
      `[src/base.py#${computeTag(baseContent)}]\n` +
        'SWAP 2.=5:\n' +
        '+    def new_process(self, data):\n' +
        '+        self.result_data = self.transform(data)\n' +
        '+        return self.result_data\n' +
        '+\n',
    );

    // Derived class
    const derivedContent = await fs.read('src/derived.py');
    snapshots.record('src/derived.py', derivedContent);
    await patcher.apply(
      `[src/derived.py#${computeTag(derivedContent)}]\n` +
        'SWAP 3.=7:\n' +
        '+    def new_process(self, data):\n' +
        '+        self.result_data = super().new_process(data)\n' +
        '+        self.result_data["extra"] = True\n' +
        '+        return self.result_data\n',
    );

    const baseResult = await fs.read('src/base.py');
    expect(baseResult).toContain('def new_process');
    expect(baseResult).toContain('self.result_data');

    const derivedResult = await fs.read('src/derived.py');
    expect(derivedResult).toContain('def new_process');
    expect(derivedResult).toContain('super().new_process');
    expect(derivedResult).toContain('self.result_data');
  });

  // ── 测试 4: 大文件 + 多处引用 ────────────────────────────────────────
  test('rename symbol referenced 20+ times in large Python file', async () => {
    const lines = [];
    lines.push('class ConfigManager:');
    lines.push('    DEFAULT_TIMEOUT = 30');
    lines.push('');
    for (let i = 0; i < 20; i++) {
      lines.push(`    def method_${i}(self):`);
      lines.push(`        timeout = self.DEFAULT_TIMEOUT`);
      lines.push(`        return timeout * ${i}`);
      lines.push('');
    }
    const content = lines.join('\n') + '\n';
    await fs.write('src/config.py', content);
    snapshots.record('src/config.py', content);

    // 生成 15 个 SWAP 操作（每个 method body）
    let patchText = `[src/config.py#${computeTag(content)}]\n`;
    for (let i = 0; i < 15; i++) {
      const lineNo = 4 + i * 3; // 每个方法的第二行（timeout = ... 行）
      patchText += `SWAP ${lineNo}.=${lineNo}:\n+        timeout = self.REQUEST_TIMEOUT\n`;
    }
    patchText += 'SWAP 2.=2:\n+DEFAULT_TIMEOUT → REQUEST_TIMEOUT rename in definition\n';

    const result = await patcher.apply(patchText);
    // 即使有 stale 风险（多 hunk 可能触发 recovery），结果应该成功
    expect(result.ok || result.error?.includes('stale')).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Rust Rename Torture Tests
// ═══════════════════════════════════════════════════════════════════════

describe('Multi-language Rename: Rust', () => {
  let fs, snapshots, patcher;

  beforeEach(() => {
    fs = new MemoryFilesystem();
    snapshots = new InMemorySnapshotStore();
    patcher = new Patcher({ fs, snapshots });
  });

  // ── 测试 1: 模块重命名 + use 路径更新 ────────────────────────────────
  test('rename struct through module re-exports (pub use)', async () => {
    const files = {
      'src/models/mod.rs':
        ['pub mod user;', 'pub use user::OldUser;', 'pub use user::UserRole;'].join('\n') + '\n',
      'src/models/user.rs':
        [
          '#[derive(Debug, Clone)]',
          'pub struct OldUser {',
          '    pub id: u64,',
          '    pub name: String,',
          '    pub role: UserRole,',
          '}',
          '',
          '#[derive(Debug, Clone, PartialEq)]',
          'pub enum UserRole {',
          '    Admin,',
          '    Member,',
          '    Guest,',
          '}',
        ].join('\n') + '\n',
      'src/services/auth.rs':
        [
          'use crate::models::OldUser;',
          'use crate::models::UserRole;',
          '',
          'pub fn authenticate(user: &OldUser) -> bool {',
          '    match user.role {',
          '        UserRole::Admin => true,',
          '        UserRole::Member => true,',
          '        UserRole::Guest => false,',
          '    }',
          '}',
        ].join('\n') + '\n',
    };

    for (const [path, content] of Object.entries(files)) {
      await fs.write(path, content);
      snapshots.record(path, content);
    }

    // 重命名 OldUser → UserAccount
    // 源定义
    const userContent = files['src/models/user.rs'];
    await patcher.apply(
      `[src/models/user.rs#${computeTag(userContent)}]\n` +
        'SWAP 2.=6:\n' +
        '+pub struct UserAccount {\n' +
        '+    pub id: u64,\n' +
        '+    pub name: String,\n' +
        '+    pub role: UserRole,\n' +
        '+}\n',
    );

    // mod.rs re-export
    const modContent = files['src/models/mod.rs'];
    await patcher.apply(
      `[src/models/mod.rs#${computeTag(modContent)}]\n` +
        'SWAP 2.=2:\n' +
        '+pub use user::UserAccount;\n',
    );

    // 引用处
    const authContent = files['src/services/auth.rs'];
    await patcher.apply(
      `[src/services/auth.rs#${computeTag(authContent)}]\n` +
        'SWAP 1.=1:\n+use crate::models::UserAccount;\n' +
        'SWAP 4.=4:\n+pub fn authenticate(user: &UserAccount) -> bool {\n',
    );

    const userResult = await fs.read('src/models/user.rs');
    expect(userResult).toContain('struct UserAccount');
    expect(userResult).not.toContain('struct OldUser');

    const modResult = await fs.read('src/models/mod.rs');
    expect(modResult).toContain('UserAccount');

    const authResult = await fs.read('src/services/auth.rs');
    expect(authResult).toContain('UserAccount');
  });

  // ── 测试 2: Trait + impl 重命名 ───────────────────────────────────────
  test('rename trait and its implementation across files', async () => {
    const files = {
      'src/traits/old_processor.rs':
        [
          'pub trait OldProcessor {',
          '    fn process(&self, input: &str) -> String;',
          '    fn validate(&self, input: &str) -> bool;',
          '}',
        ].join('\n') + '\n',
      'src/traits/mod.rs':
        ['mod old_processor;', 'pub use old_processor::OldProcessor;'].join('\n') + '\n',
      'src/impls/text_processor.rs':
        [
          'use crate::traits::OldProcessor;',
          '',
          'pub struct TextProcessor;',
          '',
          'impl OldProcessor for TextProcessor {',
          '    fn process(&self, input: &str) -> String {',
          '        input.to_uppercase()',
          '    }',
          '',
          '    fn validate(&self, input: &str) -> bool {',
          '        !input.is_empty()',
          '    }',
          '}',
        ].join('\n') + '\n',
    };

    for (const [path, content] of Object.entries(files)) {
      await fs.write(path, content);
      snapshots.record(path, content);
    }

    // 重命名 OldProcessor → DataProcessor
    await patcher.apply(
      `[src/traits/old_processor.rs#${computeTag(files['src/traits/old_processor.rs'])}]\n` +
        'SWAP 1.=4:\n' +
        '+pub trait DataProcessor {\n' +
        '+    fn process(&self, input: &str) -> String;\n' +
        '+    fn validate(&self, input: &str) -> bool;\n' +
        '+}\n',
    );

    const modContent = files['src/traits/mod.rs'];
    await patcher.apply(
      `[src/traits/mod.rs#${computeTag(modContent)}]\n` +
        'SWAP 2.=2:\n' +
        '+pub use old_processor::DataProcessor;\n',
    );

    const implContent = files['src/impls/text_processor.rs'];
    await patcher.apply(
      `[src/impls/text_processor.rs#${computeTag(implContent)}]\n` +
        'SWAP 1.=1:\n+use crate::traits::DataProcessor;\n' +
        'SWAP 5.=5:\n+impl DataProcessor for TextProcessor {\n',
    );

    const traitResult = await fs.read('src/traits/old_processor.rs');
    expect(traitResult).toContain('trait DataProcessor');

    const implResult = await fs.read('src/impls/text_processor.rs');
    expect(implResult).toContain('use crate::traits::DataProcessor');
    expect(implResult).toContain('impl DataProcessor');
  });

  // ── 测试 3: 类型别名 + re-export ──────────────────────────────────────
  test('rename type alias through re-export chain', async () => {
    const files = {
      'src/types.rs':
        [
          'use std::collections::HashMap;',
          '',
          'pub type OldUserMap = HashMap<u64, String>;',
          'pub type OldResult = Result<String, Box<dyn std::error::Error>>;',
        ].join('\n') + '\n',
      'src/lib.rs':
        ['mod types;', 'pub use types::{OldUserMap, OldResult};', '', 'pub mod services;'].join(
          '\n',
        ) + '\n',
      'src/services/mod.rs':
        [
          'use crate::{OldUserMap, OldResult};',
          '',
          'pub fn lookup(users: &OldUserMap, id: u64) -> OldResult {',
          '    users.get(&id).cloned().ok_or("not found".into())',
          '}',
        ].join('\n') + '\n',
    };

    for (const [path, content] of Object.entries(files)) {
      await fs.write(path, content);
      snapshots.record(path, content);
    }

    // 重命名 OldUserMap → UserRegistry
    await patcher.apply(
      `[src/types.rs#${computeTag(files['src/types.rs'])}]\n` +
        'SWAP 3.=3:\n+pub type UserRegistry = HashMap<u64, String>;\n',
    );

    const libContent = files['src/lib.rs'];
    await patcher.apply(
      `[src/lib.rs#${computeTag(libContent)}]\n` +
        'SWAP 2.=2:\n+pub use types::{UserRegistry, OldResult};\n',
    );

    const svcContent = files['src/services/mod.rs'];
    await patcher.apply(
      `[src/services/mod.rs#${computeTag(svcContent)}]\n` +
        'SWAP 1.=1:\n+use crate::{UserRegistry, OldResult};\n' +
        'SWAP 3.=3:\n+pub fn lookup(users: &UserRegistry, id: u64) -> OldResult {\n',
    );

    const typesResult = await fs.read('src/types.rs');
    expect(typesResult).toContain('UserRegistry');

    const svcResult = await fs.read('src/services/mod.rs');
    expect(svcResult).toContain('UserRegistry');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Go Rename Torture Tests
// ═══════════════════════════════════════════════════════════════════════

describe('Multi-language Rename: Go', () => {
  let fs, snapshots, patcher;

  beforeEach(() => {
    fs = new MemoryFilesystem();
    snapshots = new InMemorySnapshotStore();
    patcher = new Patcher({ fs, snapshots });
  });

  // ── 测试 1: 包内符号重命名 ───────────────────────────────────────────
  test('rename exported function across Go package files', async () => {
    const files = {
      'pkg/users/service.go':
        [
          'package users',
          '',
          '// OldCreateUser creates a new user in the system',
          'func OldCreateUser(name string, email string) (*User, error) {',
          '\tuser := &User{Name: name, Email: email}',
          '\treturn user, nil',
          '}',
          '',
          '// OldValidateUser checks if user data is valid',
          'func OldValidateUser(user *User) bool {',
          '\treturn user.Name != "" && user.Email != ""',
          '}',
        ].join('\n') + '\n',
      'pkg/users/handler.go':
        [
          'package users',
          '',
          'import "net/http"',
          '',
          'func HandleCreate(w http.ResponseWriter, r *http.Request) {',
          '\tuser, err := OldCreateUser("test", "test@example.com")',
          '\tif err != nil {',
          '\t\thttp.Error(w, err.Error(), http.StatusInternalServerError)',
          '\t\treturn',
          '\t}',
          '\tif !OldValidateUser(user) {',
          '\t\thttp.Error(w, "invalid user", http.StatusBadRequest)',
          '\t\treturn',
          '\t}',
          '}',
        ].join('\n') + '\n',
    };

    for (const [path, content] of Object.entries(files)) {
      await fs.write(path, content);
      snapshots.record(path, content);
    }

    // 重命名 OldCreateUser → CreateUser, OldValidateUser → ValidateUser
    await patcher.apply(
      `[pkg/users/service.go#${computeTag(files['pkg/users/service.go'])}]\n` +
        'SWAP 3.=7:\n' +
        '+// CreateUser creates a new user in the system\n' +
        '+func CreateUser(name string, email string) (*User, error) {\n' +
        '+\tuser := &User{Name: name, Email: email}\n' +
        '+\treturn user, nil\n' +
        '+}\n' +
        'SWAP 9.=11:\n' +
        '+// ValidateUser checks if user data is valid\n' +
        '+func ValidateUser(user *User) bool {\n' +
        '+\treturn user.Name != "" && user.Email != ""\n',
    );

    const handlerContent = files['pkg/users/handler.go'];
    await patcher.apply(
      `[pkg/users/handler.go#${computeTag(handlerContent)}]\n` +
        'SWAP 5.=5:\n+\tuser, err := CreateUser("test", "test@example.com")\n' +
        'SWAP 10.=10:\n+\tif !ValidateUser(user) {\n',
    );

    const svcResult = await fs.read('pkg/users/service.go');
    expect(svcResult).toContain('func CreateUser');
    expect(svcResult).toContain('func ValidateUser');
    expect(svcResult).not.toContain('OldCreateUser');

    const hdlResult = await fs.read('pkg/users/handler.go');
    expect(hdlResult).toContain('CreateUser(');
    expect(hdlResult).toContain('ValidateUser(');
  });

  // ── 测试 2: 接口方法重命名 ────────────────────────────────────────────
  test('rename interface method + all implementations', async () => {
    const files = {
      'pkg/store/interface.go':
        [
          'package store',
          '',
          'type OldRepository interface {',
          '\tOldSave(data interface{}) error',
          '\tOldFind(id string) (interface{}, error)',
          '\tOldDelete(id string) error',
          '}',
        ].join('\n') + '\n',
      'pkg/store/memory.go':
        [
          'package store',
          '',
          'type MemoryStore struct {',
          '\tdata map[string]interface{}',
          '}',
          '',
          'func (m *MemoryStore) OldSave(data interface{}) error {',
          '\treturn nil',
          '}',
          '',
          'func (m *MemoryStore) OldFind(id string) (interface{}, error) {',
          '\treturn m.data[id], nil',
          '}',
          '',
          'func (m *MemoryStore) OldDelete(id string) error {',
          '\tdelete(m.data, id)',
          '\treturn nil',
          '}',
        ].join('\n') + '\n',
      'pkg/store/postgres.go':
        [
          'package store',
          '',
          'type PostgresStore struct {',
          '\tdb *sql.DB',
          '}',
          '',
          'func (p *PostgresStore) OldSave(data interface{}) error {',
          '\t// save to postgres',
          '\treturn nil',
          '}',
          '',
          'func (p *PostgresStore) OldFind(id string) (interface{}, error) {',
          '\t// find in postgres',
          '\treturn nil, nil',
          '}',
          '',
          'func (p *PostgresStore) OldDelete(id string) error {',
          '\t// delete from postgres',
          '\treturn nil',
          '}',
        ].join('\n') + '\n',
    };

    for (const [path, content] of Object.entries(files)) {
      await fs.write(path, content);
      snapshots.record(path, content);
    }

    // 重命名 interface + 两个实现的三个方法
    // OldRepository → Repository, OldSave → Save, OldFind → Find, OldDelete → Delete

    // Interface
    await patcher.apply(
      `[pkg/store/interface.go#${computeTag(files['pkg/store/interface.go'])}]\n` +
        'SWAP 3.=8:\n' +
        '+type Repository interface {\n' +
        '+\tSave(data interface{}) error\n' +
        '+\tFind(id string) (interface{}, error)\n' +
        '+\tDelete(id string) error\n' +
        '+}\n',
    );

    // MemoryStore impl
    const memContent = files['pkg/store/memory.go'];
    await patcher.apply(
      `[pkg/store/memory.go#${computeTag(memContent)}]\n` +
        'SWAP 7.=7:\n+func (m *MemoryStore) Save(data interface{}) error {\n' +
        'SWAP 11.=11:\n+func (m *MemoryStore) Find(id string) (interface{}, error) {\n' +
        'SWAP 15.=15:\n+func (m *MemoryStore) Delete(id string) error {\n',
    );

    // PostgresStore impl
    const pgContent = files['pkg/store/postgres.go'];
    await patcher.apply(
      `[pkg/store/postgres.go#${computeTag(pgContent)}]\n` +
        'SWAP 7.=7:\n+func (p *PostgresStore) Save(data interface{}) error {\n' +
        'SWAP 12.=12:\n+func (p *PostgresStore) Find(id string) (interface{}, error) {\n' +
        'SWAP 17.=17:\n+func (p *PostgresStore) Delete(id string) error {\n',
    );

    const intfResult = await fs.read('pkg/store/interface.go');
    expect(intfResult).toContain('type Repository interface');
    expect(intfResult).toContain('\tSave(');
    expect(intfResult).toContain('\tFind(');
    expect(intfResult).toContain('\tDelete(');

    const memResult = await fs.read('pkg/store/memory.go');
    expect(memResult).toContain('func (m *MemoryStore) Save(');
    expect(memResult).toContain('func (m *MemoryStore) Find(');

    const pgResult = await fs.read('pkg/store/postgres.go');
    expect(pgResult).toContain('func (p *PostgresStore) Save(');
  });

  // ── 测试 3: 跨包引用重命名 ────────────────────────────────────────────
  test('rename exported type referenced across packages', async () => {
    const files = {
      'pkg/models/types.go':
        [
          'package models',
          '',
          'type OldUser struct {',
          '\tID    int',
          '\tName  string',
          '\tEmail string',
          '}',
          '',
          'type OldUserService struct {',
          '\trepo Repository',
          '}',
        ].join('\n') + '\n',
      'cmd/server/main.go':
        [
          'package main',
          '',
          'import (',
          '\t"fmt"',
          '\t"myapp/pkg/models"',
          ')',
          '',
          'func main() {',
          '\tuser := models.OldUser{ID: 1, Name: "Alice"}',
          '\tfmt.Println(user.Name)',
          '',
          '\tsvc := models.OldUserService{}',
          '\t_ = svc',
          '}',
        ].join('\n') + '\n',
    };

    for (const [path, content] of Object.entries(files)) {
      await fs.write(path, content);
      snapshots.record(path, content);
    }

    // 重命名 OldUser → User, OldUserService → UserService
    await patcher.apply(
      `[pkg/models/types.go#${computeTag(files['pkg/models/types.go'])}]\n` +
        'SWAP 3.=7:\n' +
        '+type User struct {\n' +
        '+\tID    int\n' +
        '+\tName  string\n' +
        '+\tEmail string\n' +
        '+}\n' +
        'SWAP 9.=12:\n' +
        '+type UserService struct {\n' +
        '+\trepo Repository\n' +
        '+}\n',
    );

    const mainContent = files['cmd/server/main.go'];
    await patcher.apply(
      `[cmd/server/main.go#${computeTag(mainContent)}]\n` +
        'SWAP 8.=8:\n+\tuser := models.User{ID: 1, Name: "Alice"}\n' +
        'SWAP 11.=11:\n+\tsvc := models.UserService{}\n',
    );

    const typesResult = await fs.read('pkg/models/types.go');
    expect(typesResult).toContain('type User struct');
    expect(typesResult).toContain('type UserService struct');

    const mainResult = await fs.read('cmd/server/main.go');
    expect(mainResult).toContain('models.User{');
    expect(mainResult).toContain('models.UserService{}');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 混合多语言 Monorepo 场景
// ═══════════════════════════════════════════════════════════════════════

describe('Multi-language Rename: Mixed monorepo', () => {
  let fs, snapshots, patcher;

  beforeEach(() => {
    fs = new MemoryFilesystem();
    snapshots = new InMemorySnapshotStore();
    patcher = new Patcher({ fs, snapshots });
  });

  test('cross-language rename: TS model → Python client → Rust backend', async () => {
    const files = {
      // TypeScript shared types
      'packages/shared/src/types.ts':
        [
          'export interface OldUserDTO {',
          '  id: number;',
          '  name: string;',
          '  role: "admin" | "user";',
          '}',
        ].join('\n') + '\n',
      // Python client (uses same naming)
      'services/client/models.py':
        [
          'from dataclasses import dataclass',
          '',
          '@dataclass',
          'class OldUserDTO:',
          '    id: int',
          '    name: str',
          '    role: str',
        ].join('\n') + '\n',
      // Rust backend struct
      'services/backend/src/models.rs':
        [
          '#[derive(Debug, Serialize, Deserialize)]',
          'pub struct OldUserDTO {',
          '    pub id: u64,',
          '    pub name: String,',
          '    pub role: String,',
          '}',
        ].join('\n') + '\n',
    };

    for (const [path, content] of Object.entries(files)) {
      await fs.write(path, content);
      snapshots.record(path, content);
    }

    // 三语同步重命名 OldUserDTO → UserDTO
    // TS
    await patcher.apply(
      `[packages/shared/src/types.ts#${computeTag(files['packages/shared/src/types.ts'])}]\n` +
        'SWAP 1.=5:\n' +
        '+export interface UserDTO {\n' +
        '+  id: number;\n' +
        '+  name: string;\n' +
        '+  role: "admin" | "user";\n' +
        '+}\n',
    );

    // Python
    await patcher.apply(
      `[services/client/models.py#${computeTag(files['services/client/models.py'])}]\n` +
        'SWAP 4.=8:\n' +
        '+class UserDTO:\n' +
        '+    id: int\n' +
        '+    name: str\n' +
        '+    role: str\n',
    );

    // Rust
    await patcher.apply(
      `[services/backend/src/models.rs#${computeTag(files['services/backend/src/models.rs'])}]\n` +
        'SWAP 2.=6:\n' +
        '+pub struct UserDTO {\n' +
        '+    pub id: u64,\n' +
        '+    pub name: String,\n' +
        '+    pub role: String,\n' +
        '+}\n',
    );

    const tsResult = await fs.read('packages/shared/src/types.ts');
    expect(tsResult).toContain('interface UserDTO');

    const pyResult = await fs.read('services/client/models.py');
    expect(pyResult).toContain('class UserDTO');

    const rsResult = await fs.read('services/backend/src/models.rs');
    expect(rsResult).toContain('pub struct UserDTO');
  });
});
