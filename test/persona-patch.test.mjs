/**
 * 人设 patch 的生成与隔离。
 *
 * 这些点出错时的表现都很隐蔽：
 *   - 人设没注入 → 模型答得像通用助手，但接口一切正常
 *   - patch 文件撞名 → 换了会话人设却还是上一个的
 *   - 空 prompt 写成空字符串 → 把 profile 默认人设抹掉
 * 所以全部固化成断言。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContactsStore } from '../lib/contacts-store.mjs';
import { buildContactPatch, buildProfilePatch } from '../lib/patch-builder.mjs';
import { patchFileName, sanitize } from '../lib/session-pool.mjs';

const CONFIG = { profile: 'sdk', persona: { prefix: null, suffix: null } };

test('每个人设生成不同的 personaPrefix', () => {
  const cs = new ContactsStore(':memory:');
  try {
    const yamls = {};
    for (const id of ['catgirl', 'coder', 'butler']) {
      const c = cs.get(id);
      yamls[id] = buildContactPatch(c, {
        config: CONFIG, sessionsRoot: `/s/${id}`,
      }).yaml;
    }

    // 三者两两不同
    const all = Object.values(yamls);
    assert.equal(new Set(all).size, 3, '三个人设的 patch 必须互不相同');

    // 各自包含自己的人设关键词
    assert.ok(yamls.catgirl.includes('喵'));
    assert.ok(yamls.coder.includes('工程师'));
    assert.ok(yamls.butler.includes('管家'));

    // 不能互相串
    assert.ok(!yamls.catgirl.includes('工程师'), '猫娘 patch 里不该有工程师人设');
    assert.ok(!yamls.coder.includes('喵'), '程序员 patch 里不该有猫娘人设');
  } finally {
    cs.close();
  }
});

test('空 system_prompt 不覆盖 profile 默认人设', () => {
  const cs = new ContactsStore(':memory:');
  try {
    const d = cs.get('default');
    assert.equal(d.systemPrompt, '');
    const yaml = buildContactPatch(d, { config: CONFIG, sessionsRoot: '/s/d' }).yaml;
    // 不写 personaPrefix 行，而不是写一个空字符串
    assert.ok(!yaml.includes('personaPrefix'),
      '空人设不应生成 personaPrefix，否则会把默认人设抹成空');
  } finally {
    cs.close();
  }
});

test('每个会话的 patch 都带上自己的 sessionsRoot', () => {
  const cs = new ContactsStore(':memory:');
  try {
    const a = buildContactPatch(cs.get('catgirl'), {
      config: CONFIG, sessionsRoot: '/sessions/u1/conv-a',
    });
    assert.ok(a.yaml.includes('/sessions/u1/conv-a'));

    // 漏了 sessionsRoot 会退化成空 patch，dsh 启动即报错，这里守住
    const p = buildProfilePatch({ config: CONFIG, sessionsRoot: '/sessions/x' });
    assert.ok(p.yaml.includes('- id: session-persistence-jsonl'));
    assert.equal(p.rowId, 'session-persistence-jsonl');
  } finally {
    cs.close();
  }
});

test('YAML 转义：人设里的引号不会破坏结构', () => {
  const tricky = '他说"你好"，然后换行\n第二行: 有冒号';
  const patch = buildContactPatch(
    { systemPrompt: tricky },
    { config: CONFIG, sessionsRoot: '/s/x' },
  );
  const line = patch.yaml.split('\n').find((l) => l.includes('personaPrefix'));
  assert.ok(line, '应有一行 personaPrefix');

  // 生成器用 JSON.stringify 转义，JSON 字符串同时是合法 YAML 双引号标量，
  // 所以直接按 JSON 解析就能还原，并且能证明换行/引号没有破坏结构。
  const raw = line.slice(line.indexOf('personaPrefix:') + 'personaPrefix:'.length).trim();
  assert.equal(JSON.parse(raw), tricky, '人设正文应完整往返');

  // 换行必须是转义过的，不能真的把 YAML 折成多行
  assert.ok(!line.includes('\n'), '换行应被转义而不是物理换行');
});

test('patch 文件名不会因 sanitize 而碰撞', () => {
  // sanitize 是多对一的
  assert.equal(sanitize('a/b'), sanitize('a:b'), '前提：sanitize 本身会碰撞');

  // 加上哈希后缀后必须区分开
  const collide = [
    ['a/b', 'a:b'],
    ['x y', 'x_y'],
    ['A1!', 'A1?'],
    ['conv#1', 'conv@1'],
  ];
  for (const [a, b] of collide) {
    assert.notEqual(patchFileName(a), patchFileName(b),
      `${a} 与 ${b} 必须落到不同文件`);
  }

  // 正常 id 仍然可读
  assert.ok(patchFileName('demo-catgirl').startsWith('demo-catgirl-'));

  // 同一输入必须稳定（重启后还能找到同一文件）
  assert.equal(patchFileName('demo-catgirl'), patchFileName('demo-catgirl'));
});

test('大量不同会话 id 的文件名几乎不碰撞', () => {
  const seen = new Map();
  const ids = [];
  for (let i = 0; i < 2000; i++) {
    ids.push(`conv/${i}`, `conv:${i}`, `会话 ${i}`, `conv_${i}`);
  }
  for (const id of ids) {
    const name = patchFileName(id);
    assert.ok(!seen.has(name), `${id} 与 ${seen.get(name)} 撞名（${name}）`);
    seen.set(name, id);
  }
});
