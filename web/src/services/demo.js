/**
 * 演示模式数据源。
 *
 * 目的：让 UI 在没有后端、没有网络、没有模型额度的电脑上也能完整展示。
 * 构建时用 VITE_DEMO=1 打开，所有 API 调用都短路到这里。
 *
 * 刻意不 mock「界面」——渲染的还是真实组件，只是数据换成了内置的。
 * 所以看到的气泡、思考面板、打字机、未读红点、复制/重新生成都是真代码在跑。
 */

export const DEMO = import.meta.env.VITE_DEMO === '1';

const now = Date.now();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// ── 联系人 ────────────────────────────────────
export const CONTACTS = [
  { id: 'default', name: 'lume', avatar: '', tagline: '通用助手' },
  { id: 'catgirl', name: '小橘', avatar: '', tagline: '猫娘 · 活泼' },
  { id: 'butler', name: '塞巴斯蒂安', avatar: '', tagline: '管家 · 克制' },
  { id: 'coder', name: 'Codex', avatar: '', tagline: '工程师 · 精确' },
];

// ── 历史会话 ──────────────────────────────────
export const SESSIONS = [
  {
    conversationId: 'demo-code',
    contactId: 'coder',
    title: '用 CSS 做响应式侧边栏',
    name: 'Codex',
    lastMessage: '抽屉的关键是脱离文档流，用 fixed 而不是改宽度。',
    lastAt: now - 3 * MIN,
    unread: 0,
  },
  {
    conversationId: 'demo-cat',
    contactId: 'catgirl',
    title: '今天想聊点轻松的',
    name: '小橘',
    lastMessage: '好呀好呀～今天想聊什么都可以喵！',
    lastAt: now - 40 * MIN,
    unread: 2,
  },
  {
    conversationId: 'demo-think',
    contactId: 'default',
    title: '为什么天空是蓝色的',
    name: 'lume',
    lastMessage: '瑞利散射：波长越短，散射越强。',
    lastAt: now - 5 * HOUR,
    unread: 0,
  },
  {
    conversationId: 'demo-butler',
    contactId: 'butler',
    title: '关于时间管理',
    name: '塞巴斯蒂安',
    lastMessage: '与其追求效率，不如先确认方向。',
    lastAt: now - 26 * HOUR,
    unread: 0,
  },
];

// ── 预置对话 ──────────────────────────────────
const HISTORY = {
  'demo-code': [
    {
      id: 'c-u1', role: 'user', status: 'completed', createdAt: now - 5 * MIN,
      content: '移动端侧边栏老是挤占主内容，怎么改？',
    },
    {
      id: 'c-a1', role: 'assistant', status: 'completed',
      createdAt: now - 5 * MIN + 4000,
      thinking: '用户说的是「挤占」，说明当前布局里侧边栏参与了宽度分配。典型的 flex 兄弟布局：sidebar 固定 272px，main 用 flex:1，窄屏上主区就只剩一点点。正确的做法不是把宽度改小，而是让它根本不在文档流里。',
      thinkingMs: 3800,
      content: `问题的根源通常是：**侧边栏参与了布局宽度分配**。

如果它是 \`flex\` 布局里的兄弟节点，窄屏上主区就必然被挤压。改宽度只是把问题挪小一点，没解决。

## 正确做法：脱离文档流

\`\`\`css
.sidebar {
  position: fixed;
  top: 0; bottom: 0; left: 0;
  width: 272px;
  max-width: 82vw;      /* 超窄屏不盖满整屏 */
  transform: translateX(-100%);   /* 默认收在屏幕外 */
  transition: transform .22s;
  z-index: 41;
}

.sidebar.open {
  transform: translateX(0);
}
\`\`\`

配合一个全屏遮罩：

\`\`\`css
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, .32);
  z-index: 40;
}
\`\`\`

## 为什么用 transform 而不是改 width

| 方案 | 性能 | 是否触发重排 |
| --- | --- | --- |
| 改 \`width\` | 差 | 是，每帧重排 |
| 改 \`left\` | 一般 | 是 |
| \`transform\` | 好 | 否，走合成层 |

滑出动画用 \`transform\` 才能保持 60fps，这是关键差别。`,
    },
    {
      id: 'c-u2', role: 'user', status: 'completed', createdAt: now - 3 * MIN,
      content: '那 100vh 在手机上有什么坑？',
    },
    {
      id: 'c-a2', role: 'assistant', status: 'completed',
      createdAt: now - 3 * MIN + 2500,
      content: `\`100vh\` 在移动端是**布局视口**高度，不等于**可见视口**高度。

安卓 Chrome 的地址栏会伸缩，iOS Safari 底部有一条工具栏。用 \`100vh\` 时：

- 地址栏展开 → 页面底部被裁掉
- 输入框跟着键盘顶着走 → 被挡在屏幕外

## 换成 dvh

\`\`\`css
@supports (height: 100dvh) {
  .app {
    height: 100dvh;   /* 动态视口，随地址栏收缩 */
  }
}
\`\`\`

再加两个配套约束，缺一不可：

\`\`\`css
.list {
  min-height: 0;      /* flex 子项默认 min-height:auto，不会收缩 */
  overflow-y: auto;
}

.composer {
  flex: 0 0 auto;     /* 输入框不参与压缩 */
}
\`\`\`

\`min-height: 0\` 这条最容易被忽略——少了它，滚动容器会被内容撑开，整个页面变成一个超长滚动条，输入框永远在屏幕外。`,
    },
  ],

  'demo-cat': [
    {
      id: 't-u1', role: 'user', status: 'completed', createdAt: now - 42 * MIN,
      content: '在吗？今天有点累。',
    },
    {
      id: 't-a1', role: 'assistant', status: 'completed',
      createdAt: now - 42 * MIN + 2000,
      thinking: '用户说累。不要急着给建议，先接住情绪。人设是猫娘，语气活泼但不要过头——对方累的时候，过度的元气反而有压迫感。',
      thinkingMs: 1800,
      content: '在的喵～\n\n累了就先别想了，靠着歇一会儿吧。我在这儿看着呢。',
    },
    {
      id: 't-u2', role: 'user', status: 'completed', createdAt: now - 40 * MIN,
      content: '你平时会做什么？',
    },
    {
      id: 't-a2', role: 'assistant', status: 'completed',
      createdAt: now - 40 * MIN + 1500,
      content: '平时就趴在窗台上晒太阳呀，看云慢慢地飘过去。\n\n偶尔会想你说的那些话，一句一句地想。有些想不明白的，就记下来，等你下次来的时候问。',
    },
  ],

  'demo-think': [
    {
      id: 'k-u1', role: 'user', status: 'completed', createdAt: now - 5 * HOUR,
      content: '为什么天空是蓝色的？',
    },
    {
      id: 'k-a1', role: 'assistant', status: 'completed',
      createdAt: now - 5 * HOUR + 6000,
      thinking: '经典问题，但容易答错。常见错误说法是「海水反射」，或者「氧气是蓝色的」——都不对。\n\n正确机制是瑞利散射：散射强度与波长的四次方成反比。蓝光波长短，散射强，所以天空看起来是蓝的。\n\n但这里有个更深的问题值得说：为什么不是紫色？紫光波长更短、散射更强，按理说天空该是紫色。原因是两点：太阳光谱里紫光成分本来就少；人眼对紫光的敏感度也低。所以最终看到的是蓝色。\n\n这个点说出来会让答案有质感，不是背结论。',
      thinkingMs: 5400,
      content: `因为**瑞利散射**。

阳光穿过大气时，会和空气分子碰撞。散射强度与波长的四次方成反比：

\`\`\`
I ∝ 1 / λ⁴
\`\`\`

蓝光波长约 450nm，红光约 700nm。代入一算，蓝光的散射强度大约是红光的 **6 倍**。所以蓝光被散射到四面八方，我们从各个方向都能看到它——天空就是蓝的。

## 一个更值得问的问题

你可能会想：紫光波长更短，散射更强，那天空为什么不是紫色？

有两个原因：

1. **太阳光里紫光本来就少**——大部分能量集中在可见光中段
2. **人眼对紫光不敏感**——视锥细胞对 550nm 附近最敏感，紫光端响应很弱

两个因素叠加，最终感知到的就是蓝色。

顺带一提，这也是**日落变红**的同一套机制：阳光斜穿大气，路径变长，蓝光在半路就被散射干净了，只剩下波长长、散射弱的红光能直达眼睛。`,
    },
  ],

  'demo-butler': [
    {
      id: 'b-u1', role: 'user', status: 'completed', createdAt: now - 26 * HOUR,
      content: '我总觉得时间不够用。',
    },
    {
      id: 'b-a1', role: 'assistant', status: 'completed',
      createdAt: now - 26 * HOUR + 3000,
      thinking: '这是个求助信号，但直接给方法论会很空洞。先把问题重新定义：时间不够用，往往是方向不清，而不是效率不高。保持管家的克制，不煽情，给一个可执行的落点。',
      thinkingMs: 2600,
      content: `恕我直言——**「时间不够用」通常不是时间的问题。**

如果一个人清楚地知道自己在做什么、为什么做，很少会觉得时间不够。那种疲惫感，多半来自反复权衡：这件事该不该做、现在做对不对。

所以比起时间管理，有两件事更值得先想清楚：

1. **哪些事根本不该由你来做** —— 直接划掉，比优化它们划算得多
2. **哪一件做完能让其余的都变轻** —— 优先做这个

至于具体的日程表、番茄钟，那些是效率工具。方向错了，效率越高，偏得越远。`,
    },
  ],
};

// 演示过程中新建的会话。放这里而不是直接 push 进 SESSIONS，
// 这样刷新页面就回到初始状态，演示可以反复跑。
let liveSessions = [];

/** 会话列表（带标题，供侧栏渲染） */
export function demoFetchSessions() {
  return [...liveSessions, ...SESSIONS].map((s) => ({ ...s }));
}

export function demoFetchContacts() {
  return CONTACTS.map((c) => ({ ...c }));
}

/** 历史消息。未知会话返回空，行为和真后端一致 */
export function demoFetchHistory(conversationId) {
  const h = HISTORY[conversationId];
  return h ? h.map((m) => ({ ...m })) : [];
}

// ── 假流 ──────────────────────────────────────

/** 按用户输入挑一段回答，让演示有「真的有在听」的感觉 */
function pickReply(text) {
  const t = (text || '').toLowerCase();

  if (/代码|code|函数|bug|报错|js|css|react/.test(t)) {
    return {
      thinking: [
        '用户要的是代码。先判断他真正卡住的地方在哪，而不是把整个方案铺开。',
        '给最小可运行的片段，加关键注释，再点出容易踩的坑。',
      ],
      reply: [
        '好的，给你一个最小可用的版本。\n\n',
        '```js\n',
        'function debounce(fn, wait = 300) {\n',
        '  let timer = null;\n',
        '  return (...args) => {\n',
        '    clearTimeout(timer);\n',
        '    timer = setTimeout(() => fn(...args), wait);\n',
        '  };\n',
        '}\n',
        '```\n\n',
        '关键在于 **保存 timer 的引用**，每次触发前先清掉上一个。\n\n',
        '## 两个常见坑\n\n',
        '1. **不要用箭头函数包裹 `fn()` 的返回值** —— 这里要先 `clearTimeout` 再重新计时，顺序反了就永远不触发\n',
        '2. **需要 `throttle` 而不是 `debounce` 时别硬改** —— 两者的语义相反：一个等停止，一个等间隔\n\n',
        '如果你要的是「滚动时每 100ms 最多执行一次」，那是 throttle，写法不一样。',
      ],
    };
  }

  if (/为什么|原理|本质|怎么理解/.test(t)) {
    return {
      thinking: [
        '这类问题要避免直接给结论。先拆出机制，再补一个反直觉的点，答案才立得住。',
        '可以把看起来矛盾的地方讲清楚——那通常是理解的分水岭。',
      ],
      reply: [
        '这个问题值得拆开看。\n\n',
        '## 先说机制\n\n',
        '大多数看似「理所当然」的现象，背后都有一个很朴素的约束在起作用。找到那个约束，剩下的都是推论。\n\n',
        '## 一个反直觉的地方\n\n',
        '如果你顺着直觉推，会得到一个和观察不符的结论。这恰恰说明直觉里少了某个变量。\n\n',
        '> 真正的理解，不是能背出答案，而是能说出「为什么不是别的答案」。\n\n',
        '试着从这个角度再想一遍，很多细节会自己接上。',
      ],
    };
  }

  if (/累|难过|烦|焦虑|压力/.test(t)) {
    return {
      thinking: [
        '对方在表达情绪，不是提问。先接住，不要给方案。',
        '语气放缓，句子短一点。',
      ],
      reply: [
        '嗯，我在。\n\n',
        '不用急着振作，也不用马上想明白。累就是累，这本身不需要理由。\n\n',
        '要是想说，我听着；不想说，我们就安静一会儿也行。',
      ],
    };
  }

  return {
    thinking: [
      '这是一句普通的话。不要过度解读，也不要敷衍。',
      '给一个具体的、有信息量的回应，比漂亮话有用。',
    ],
    reply: [
      '我明白你的意思了。\n\n',
      '先把这件事拆成两部分看：**你能控制的**，和**你控制不了的**。\n\n',
      '- 能控制的：下一步做什么、什么时候做、做到什么程度算完成\n',
      '- 控制不了的：别人怎么想、结果什么时候来\n\n',
      '通常焦虑都集中在后者，但精力只该花在前者。\n\n',
      '要不要先从最小的一步开始？',
    ],
  };
}

/**
 * 模拟一次完整的流式响应。
 *
 * 帧顺序和真实后端一致：ready → accepted → reasoning × n → delta × n → done。
 * 刻意放慢（每片 45ms），这样「停止生成」按钮有足够时间被看到和点到。
 */
export function demoStreamChat({ message, signal, regenerate }, onFrame) {
  const pick = pickReply(message);
  const thinkingParts = pick.thinking.map((s) => s);
  const replyParts = pick.reply;

  // 重新生成时换个开头，证明「确实重新问了一次」而不是重播
  if (regenerate) {
    replyParts.unshift('');
    replyParts[0] = '（重新生成）这次换个角度说。\n\n';
  }

  // 让「新建对话」发完第一句后，侧栏立刻出现这条会话。
  // 不带这一步，演示时新建的对话在侧栏是看不见的，体验会断。
  const existing = liveSessions.find((s) => s.conversationId === 'demo-live');
  if (existing) {
    existing.lastAt = Date.now();
    existing.lastMessage = replyParts[replyParts.length - 1].replace(/[#*`\n]/g, '').trim().slice(0, 40);
  } else {
    liveSessions = [
      {
        conversationId: 'demo-live',
        contactId: 'default',
        title: (message || '新对话').slice(0, 24),
        lastMessage: '',
        lastAt: Date.now(),
        unread: 0,
      },
      ...liveSessions,
    ];
  }

  const total = thinkingParts.length + replyParts.length;
  // done 帧必须带完整正文。
  // useChat 收到 done 时用 data.text 作为最终内容；如果这里给空串，
  // 它会退回去读「还没吐完的队列」——而那时队列早已被清零，
  // 于是判定为「空回复」并把整个气泡删掉，表现为回答一闪就没。
  const fullReply = replyParts.join('');

  return new Promise((resolve, reject) => {
    let i = 0;
    let timer = null;

    const cleanup = () => clearTimeout(timer);

    const finish = () => {
      cleanup();
      onFrame('done', { text: fullReply, assistantMessageId: null });
      resolve();
    };

    const tick = () => {
      if (signal?.aborted) {
        cleanup();
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        return;
      }
      if (i >= total) return finish();

      if (i < thinkingParts.length) {
        onFrame('reasoning', { text: thinkingParts[i] });
      } else {
        onFrame('delta', { text: replyParts[i - thinkingParts.length] });
      }
      i += 1;
      timer = setTimeout(tick, 45);
    };

    timer = setTimeout(() => {
      onFrame('ready', {
        conversationId: 'demo-live',
        userMessageId: null,
        contactId: 'default',
      });
      onFrame('accepted', {});
      timer = setTimeout(tick, 260);
    }, 180);
  });
}
