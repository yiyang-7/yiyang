import { useEffect, useState } from 'react';

/**
 * 极简 hash 路由。
 *
 * 用 hash 而不是 history API，理由有两个：
 *   1. 不需要服务端配置 fallback，刷新任何页面都不会 404
 *   2. 这个应用只有两个页面，引入 react-router 不划算
 *
 * 路由形态（DeepSeek 形态下没有「首页列表」，列表移到了侧边栏）：
 *   #/                      → 新对话
 *   #/chat/<conversationId> → 某个历史会话
 *
 * 注意参数是「会话 id」而不是「联系人 id」：
 * 同一个联系人可以有多条会话（点 ✚ 新建），只按联系人寻址会丢历史。
 */

function parse(hash) {
  const raw = (hash || '').replace(/^#/, '');
  if (raw.startsWith('/chat/')) {
    return {
      name: 'chat',
      conversationId: decodeURIComponent(raw.slice(6).split('?')[0]),
    };
  }
  return { name: 'new' };
}

export function useRoute() {
  const [route, setRoute] = useState(() => parse(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}

export function navigate(path) {
  window.location.hash = path;
}

export function goHome() {
  navigate('/');
}

/** 开新对话：回到根路由 */
export function goNew() {
  navigate('/');
}

export function goChat(conversationId) {
  navigate(`/chat/${encodeURIComponent(conversationId)}`);
}