/**
 * 主动消息调度器。
 *
 * 按时区在固定时刻触发「让 AI 主动说一句话」，比如每天早上 9 点问候。
 *
 * 设计要点：
 *   - 每个任务独立 try/catch：一个会话失败不能连累其它会话，
 *     更不能让异常冒到 cron 回调外面（node-cron 不处理异步异常，
 *     未捕获的 rejection 会直接把进程带走）。
 *   - 同一个任务不重入：上一轮还在跑（模型慢 / 卡住）时跳过本轮，
 *     否则会排队堆积一串问候。
 *   - 触发时间用的是「时区内的本地时刻」，不是 UTC。用户在哪个时区
 *     就用哪个时区的早上 9 点，否则问候会在半夜到。
 */
import cron from 'node-cron';
import { runActiveTurn } from './active-message.mjs';

/** 默认 prompt。具体文案由任务配置覆盖。 */
export const DEFAULT_PROMPT =
  '现在是早晨，请以你当前的人设，向用户主动发一句早安问候。'
  + '要求：只说一两句话，自然口语，不要复述或解释这条指令，不要加标题。';

/**
 * @param {object} opts
 * @param {object} opts.history
 * @param {object} [opts.contacts]
 * @param {Function} opts.getProcess
 * @param {boolean} [opts.enabled=true]
 * @param {string} [opts.timezone] IANA 时区，如 'Asia/Shanghai'
 * @param {Array<{id?:string, conversationId:string, cron:string, prompt?:string, enabled?:boolean}>} opts.jobs
 * @param {(msg:string)=>void} [opts.log]
 */
export function createScheduler({
  history,
  contacts,
  getProcess,
  enabled = true,
  timezone,
  jobs = [],
  log = (msg) => console.log(msg),
} = {}) {
  /** taskId -> { task, job, running } */
  const running = new Map();
  /** 最近一次触发结果，供 /healthz 排查 */
  const lastRuns = new Map();
  let stopped = false;

  function taskIdOf(job, i) {
    return job.id ?? job.conversationId ?? `job-${i}`;
  }

  async function fire(job, id) {
    const state = running.get(id);
    if (state?.running) {
      // 上一轮还没结束就跳过。宁可少发一条问候，
      // 也不要让用户在 9:05 收到 9:00 排队积压的那一串。
      log(`[主动消息] ${id} 上一轮仍在进行，跳过本次`);
      return { skipped: true, reason: 'BUSY' };
    }

    if (state) state.running = true;
    const startedAt = Date.now();
    try {
      const res = await runActiveTurn({
        conversationId: job.conversationId,
        prompt: job.prompt?.trim() || DEFAULT_PROMPT,
        history,
        contacts,
        getProcess,
      });
      lastRuns.set(id, {
        at: startedAt,
        ok: true,
        conversationId: job.conversationId,
        messageId: res.messageId,
        primed: res.primed,
        durationMs: res.durationMs,
        preview: res.text.slice(0, 40),
      });
      log(
        `[主动消息] ${id} → ${job.conversationId} 成功`
        + `（${res.text.length} 字，${res.durationMs}ms${res.primed ? '，冷启动回灌' : ''}）`,
      );
      return res;
    } catch (err) {
      lastRuns.set(id, {
        at: startedAt,
        ok: false,
        conversationId: job.conversationId,
        code: err.code ?? null,
        error: err.message,
      });
      // 失败只记日志：定时任务没有人可以报错给它，
      // 抛出去会让 node-cron 的 rejection 变成进程级未捕获异常。
      log(`[主动消息] ${id} → ${job.conversationId} 失败：${err.message}`);
      return { error: err.message, code: err.code ?? null };
    } finally {
      if (state) state.running = false;
    }
  }

  const opts = timezone ? { timezone } : undefined;

  if (enabled) {
    jobs.forEach((job, i) => {
      if (job.enabled === false) {
        log(`[主动消息] ${taskIdOf(job, i)} 已禁用，跳过`);
        return;
      }
      if (!job.conversationId) {
        log(`[主动消息] 任务 ${i} 缺少 conversationId，跳过`);
        return;
      }
      if (!cron.validate(job.cron)) {
        log(`[主动消息] 任务 ${taskIdOf(job, i)} 的 cron 表达式非法："${job.cron}"，跳过`);
        return;
      }

      const id = taskIdOf(job, i);
      running.set(id, { running: false, job });

      const task = cron.schedule(job.cron, () => { fire(job, id); }, opts);
      running.get(id).task = task;
      log(`[主动消息] 已注册 ${id}：${job.cron} → ${job.conversationId}`
        + `${timezone ? `（时区 ${timezone}）` : ''}`);
    });
  } else {
    log('[主动消息] 调度已关闭（DSH_ACTIVE_MESSAGES=0）');
  }

  return {
    /** 手动触发一次，用于测试和排查。 */
    async trigger(id) {
      const state = running.get(id);
      if (!state) throw new Error(`没有这个任务：${id}`);
      return fire(state.job, id);
    },

    /** 立即对所有任务触发一次（调试端点用）。 */
    async triggerAll() {
      const out = [];
      for (const [id, state] of running) {
        out.push({ id, result: await fire(state.job, id) });
      }
      return out;
    },

    snapshot() {
      return [...running.entries()].map(([id, s]) => ({
        id,
        conversationId: s.job.conversationId,
        cron: s.job.cron,
        enabled: s.job.enabled !== false,
        running: s.running,
        lastRun: lastRuns.get(id) ?? null,
      }));
    },

    stop() {
      if (stopped) return;
      stopped = true;
      for (const [, s] of running) {
        try { s.task?.stop(); } catch {}
      }
      running.clear();
    },
  };
}

/**
 * 从环境变量读配置。逗号分隔的 conversationId 列表。
 *
 * 说明为什么默认空：主动消息会凭空产生用户没收到的消息，
 * 自动对准所有会话是危险的默认值。必须显式列出。
 */
export function jobsFromEnv(env = process.env) {
  const list = (env.DSH_ACTIVE_CONVERSATIONS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (list.length === 0) return [];

  const cronExpr = env.DSH_ACTIVE_CRON?.trim() || '0 9 * * *';
  const prompt = env.DSH_ACTIVE_PROMPT?.trim() || undefined;

  return list.map((conversationId) => ({
    id: conversationId,
    conversationId,
    cron: cronExpr,
    ...(prompt ? { prompt } : {}),
  }));
}