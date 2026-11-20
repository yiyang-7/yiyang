/**
 * 官方 primitives 的本地化文案。
 *
 * MarkdownText 强制要求 labels（代码块的复制按钮、脚注标题），
 * 且注释里明确说：**必须传引用稳定的对象** —— 每次渲染新建一个对象
 * 会让它在流式过程中丢弃渲染缓存，长回复会明显变卡。所以提到模块顶层。
 */

export const MARKDOWN_LABELS = Object.freeze({
  code: Object.freeze({
    copyLabel: '复制代码',
    copiedLabel: '已复制',
  }),
  footnotes: '脚注',
});