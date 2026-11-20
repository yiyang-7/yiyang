import { useEffect, useRef, useState } from 'react';
import styles from './QuickReplies.module.css';

/**
 * 输入框上方的快捷回复胶囊。
 *
 * 生成方式：根据「上一轮 AI 说了什么」+「角色人设」现算，
 * 不是固定几句轮播。所以每次上下文不同，给出的建议也不同。
 *
 * 交互：点一下就发出去。发送中/生成中隐藏，避免和主流式打架。
 */
export default function QuickReplies({ replies, onPick, visible }) {
  // 切换一批新建议时重放淡入动画（key 变化触发重新挂载）
  const [round, setRound] = useState(0);
  const keyRef = useRef('');

  const sig = replies.join('|');
  useEffect(() => {
    if (sig && sig !== keyRef.current) {
      keyRef.current = sig;
      setRound((r) => r + 1);
    }
  }, [sig]);

  if (!visible || !replies || replies.length === 0) return null;

  return (
    <div className={styles.wrap} role="group" aria-label="快捷回复建议">
      <div className={styles.scroller}>
        {replies.map((r, i) => (
          <button
            // key 带 round：内容变了就重新挂载，动画才会重放
            key={`${round}-${i}-${r}`}
            type="button"
            className={styles.chip}
            style={{ animationDelay: `${i * 55}ms` }}
            onClick={() => onPick(r)}
          >
            <span className={styles.text}>{r}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── 建议生成 ────────────────────────────────────

/** 人设差异：同一句 AI 回复，不同角色给的选项语气不一样 */
const PERSONA_FOLLOWUPS = {
  catgirl: ['再多说一点喵', '那你呢？', '抱抱', '换个别的话题'],
  butler: ['请继续', '展开说说', '还有其他考量吗', '我明白了'],
  coder: ['给个完整例子', '边界情况怎么处理', '有性能问题吗', '能再简化吗'],
  default: ['展开讲讲', '举个例子', '为什么是这样', '换个角度说'],
};

/** 按 AI 回复的内容特征挑追问方向，而不是无脑套模板 */
function followUpsFor(replyText, personaId) {
  const t = replyText || '';
  const base = PERSONA_FOLLOWUPS[personaId] || PERSONA_FOLLOWUPS.default;

  // 有代码块：大概率想看懂或想改
  if (/```/.test(t)) {
    return personaId === 'coder'
      ? ['这段代码怎么调试', '帮我改成异步的', '有没有更简洁的写法']
      : ['这段代码什么意思', '能解释下原理吗', '换个简单的写法'];
  }

  // 有表格/对比：想深入某一项
  if (/\|.*\|/.test(t) && /---/.test(t)) {
    return ['第一点详细说说', '这个怎么选', '有反例吗'];
  }

  // 在安慰情绪：适合轻一点的回应
  if (/我听着|我在|安静一会|不用急|我在这儿/.test(t)) {
    return ['谢谢你', '我还想说点别的', '陪我聊会儿', '好多了'];
  }

  // 有明确结论或建议：把「通用追问」和「人设追问」混着给，
  // 否则这一分支会把所有角色的语气都吃掉，变成千人一面。
  if (/建议|应该|可以试|第一步|先/.test(t)) {
    return ['具体怎么做', '有什么风险', base[0], base[1]];
  }

  // 问了用户问题
  if (/[？?]/.test(t)) {
    return ['是的', '不是', '我也不确定', base[0]];
  }

  // 兜底：人设默认追问
  return base;
}

/** 问号类回复里，把 AI 的问题本身变成一个可点的回答提示 */
function hasQuestion(t) {
  return /[？?]/.test(t || '');
}

/**
 * 从「上一轮 AI 回复」推出 2–3 条可点选项。
 *
 * @param {Array} messages 当前消息列表
 * @param {object} contact  当前角色（用来区分语气）
 * @returns {string[]}
 */
export function deriveQuickReplies(messages, contact) {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  // 找最后一条已完成的 AI 回复
  let lastAi = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant' && m.status === 'completed' && m.content?.trim()) {
      lastAi = m;
      break;
    }
  }
  // 最后一条必须确实是 AI —— 用户在思考时不该还挂着建议
  if (!lastAi || messages[messages.length - 1].role !== 'assistant') return [];

  const personaId = contact?.id || 'default';
  const pool = followUpsFor(lastAi.content, personaId);

  // 挑 2–3 条。用消息长度做偏移，让不同长度的回复给出不同组合，
  // 避免每次都是同样那三条。
  const n = lastAi.content.length % 2 === 0 ? 3 : 2;
  const offset = lastAi.content.length % pool.length;
  const picked = [];
  for (let i = 0; i < Math.min(n, pool.length); i++) {
    picked.push(pool[(offset + i) % pool.length]);
  }

  // 有问句时，塞一条「直接回答」式的选项，社交感更强
  if (hasQuestion(lastAi.content) && !picked.includes('是的')) {
    picked[picked.length - 1] = '是的';
  }

  return picked;
}