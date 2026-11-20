/**
 * profile patch 生成器
 *
 * 服务端不再把 patch 写死成文件再交给 Harness，而是**从配置对象生成 YAML**，
 * 每次 spawn 一个会话进程时注入。这样同一个 Harness 运行时可以被不同
 * 用户/会话以不同的人设、会话根、模型策略驱动，而无需改运行时源码。
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** 默认配置，可被 server.config.json 或环境变量覆盖。 */
export const DEFAULT_CONFIG = {
  /** 启动哪个 dsh profile。sdk 带凭据服务；sdk-minimal 不带。 */
  profile: 'sdk',
  /** dsh 可执行入口。 */
  dshBin: '/opt/dshapp/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js',

  /** 每个会话的持久化根目录的父目录。 */
  sessionsBaseDir: null, // 默认 <workdir>/.dsh-sessions

  /** 人设 prompt。null 表示沿用 profile 默认值，不覆盖。 */
  persona: {
    prefix: null,
    suffix: null,
  },

  /** 模型路由默认值，可被单次请求覆盖。 */
  llm: {
    provider: 'deepseek-official',
    model: 'deepseek-chat',
  },

  /** 会话空闲多久后回收子进程（毫秒）。 */
  idleTimeoutMs: 10 * 60 * 1000,

  /** 同时存活的 Harness 子进程上限。 */
  maxProcesses: 8,

  /** 单轮对话最长等待毫秒数。 */
  turnTimeoutMs: 5 * 60 * 1000,

  /** 服务端监听。 */
  host: '127.0.0.1',
  port: 8787,
};

/**
 * 会话持久化 backend 的 cordis 行 id。
 * 两个 profile 的条目 id 不同，patch 写错会静默不生效。
 */
const PERSISTENCE_ROW_ID = {
  'sdk-minimal': 'sessions',
  sdk: 'session-persistence-jsonl',
};

/** YAML 标量安全转义。 */
function yamlScalar(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return JSON.stringify(String(value));
}

/**
 * 从配置 + 单次请求上下文生成 profile patch。
 *
 * @param {object} opts
 * @param {object} opts.config       服务端完整配置
 * @param {string} opts.sessionsRoot 该会话独占的会话根目录（绝对路径）
 * @param {string} [opts.cwd]        会话工作目录
 * @param {object} [opts.persona]    本次请求的人设覆盖 {prefix,suffix}
 * @returns {{ yaml: string, rowId: string|null, lines: string[] }}
 */
export function buildProfilePatch({ config, sessionsRoot, cwd, persona }) {
  const lines = ['# 由服务端根据配置生成，勿手工编辑', ''];
  const patchedRows = [];

  // ── 会话持久化根：每个会话独占，避免 f2fs/zstd 混根与跨租户串读 ──
  const rowId = PERSISTENCE_ROW_ID[config.profile] ?? null;
  if (rowId) {
    lines.push(`- id: ${rowId}`);
    lines.push('  config:');
    lines.push(`    root: ${yamlScalar(sessionsRoot)}`);
    lines.push('');
    patchedRows.push(rowId);
  }

  // ── 人设：只在显式配置时覆盖，避免把 profile 默认值抹成空 ──
  const prefix = persona?.prefix ?? config.persona?.prefix;
  const suffix = persona?.suffix ?? config.persona?.suffix;
  const hasPrefix = prefix !== null && prefix !== undefined;
  const hasSuffix = suffix !== null && suffix !== undefined;

  if (hasPrefix || hasSuffix) {
    lines.push('- id: system-prompt');
    lines.push('  config:');
    if (hasPrefix) lines.push(`    personaPrefix: ${yamlScalar(prefix)}`);
    if (hasSuffix) lines.push(`    personaSuffix: ${yamlScalar(suffix)}`);
    lines.push('');
    patchedRows.push('system-prompt');
  }

  return { yaml: lines.join('\n'), rowId, lines, patchedRows };
}

/**
 * 按联系人生成 profile patch 模版。
 *
 * 「每个联系人一套模版」在这里落地：模版的差异就是 system_prompt，
 * 其余（会话根、默认 suffix）由服务端配置统一提供。
 *
 * 空 system_prompt 不写 personaPrefix —— 否则会把 profile 自带的人设抹成空字符串，
 * 模型会得到一句"你的设定是："之后就没了。
 *
 * @param {object} contact            ai_contacts 行
 * @param {object} opts
 * @param {object} opts.config        服务端配置
 * @param {string} opts.sessionsRoot  会话独占根目录
 * @param {string} [opts.cwd]
 */
export function buildContactPatch(contact, { config, sessionsRoot, cwd }) {
  const prompt = contact?.systemPrompt?.trim();
  return buildProfilePatch({
    config,
    sessionsRoot,
    cwd,
    persona: {
      prefix: prompt ? prompt : null,        // null = 不覆盖 profile 默认
      suffix: config.persona?.suffix ?? null,
    },
  });
}

/**
 * 把生成的 patch 落到磁盘，返回路径。
 * Harness 的 --patch 只接受文件路径，所以这里必须物化。
 *
 * @param {object} opts
 * @param {string} opts.dir   存放 patch 的目录
 * @param {string} opts.name  文件名前缀（会话 id）
 * @param {object} opts.patch buildProfilePatch 的返回值
 * @returns {string} 绝对路径
 */
export function materializePatch({ dir, name, patch }) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.patch.yml`);
  writeFileSync(path, patch.yaml, 'utf8');
  return path;
}