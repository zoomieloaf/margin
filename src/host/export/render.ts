import type { Element, ElementContent, Root as HastRoot } from 'hast';
import { toHtml } from 'hast-util-to-html';
import { toHast, type Handlers, type State } from 'mdast-util-to-hast';
import { parseTree } from '../../md/parse';
import type { Callout, Mark } from '../../md/types';

export type ExportTheme = 'light' | 'dark';

export interface RenderOptions {
  title: string;
  theme: ExportTheme;
  /** Directory URL relative links and images resolve against (the Markdown file's folder). */
  baseHref?: string;
}

const CALLOUT_TITLES: Record<Callout['kind'], string> = {
  note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution',
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const handlers = {
  callout(state: State, node: Callout): Element {
    const title: Element = { type: 'element', tagName: 'p', properties: { className: ['callout-title'] }, children: [{ type: 'text', value: CALLOUT_TITLES[node.kind] }] };
    return { type: 'element', tagName: 'div', properties: { className: ['callout'], dataKind: node.kind }, children: [title, ...(state.all(node) as ElementContent[])] };
  },
  mark(state: State, node: Mark): Element {
    return { type: 'element', tagName: 'mark', properties: {}, children: state.all(node) as ElementContent[] };
  },
  math(_state: State, node: { value: string }): Element {
    return { type: 'element', tagName: 'pre', properties: { className: ['math'] }, children: [{ type: 'element', tagName: 'code', properties: {}, children: [{ type: 'text', value: node.value }] }] };
  },
  inlineMath(_state: State, node: { value: string }): Element {
    return { type: 'element', tagName: 'code', properties: { className: ['math'] }, children: [{ type: 'text', value: node.value }] };
  },
  yaml(): undefined {
    return undefined;
  },
} as unknown as Handlers;

/** Markdown → a standalone HTML document styled for reading and printing. */
export function renderHtml(markdown: string, o: RenderOptions): string {
  const tree = parseTree(markdown.replace(/^﻿/, ''));
  const hast = toHast(tree, { allowDangerousHtml: true, handlers }) as HastRoot;
  const body = toHtml(hast, { allowDangerousHtml: true });
  const base = o.baseHref ? `<base href="${esc(o.baseHref)}">` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${base}<title>${esc(o.title)}</title>
<style>${exportCss(o.theme)}</style>
</head>
<body class="theme-${o.theme}">
<article class="markdown-body">
${body}
</article>
</body>
</html>
`;
}

export function exportCss(theme: ExportTheme): string {
  const t = theme === 'dark'
    ? { bg: '#1f2024', fg: '#dfe1e7', muted: '#8c92a0', line: '#3a3d45', code: '#2a2c32', accent: '#829bff', mark: '#5b4c12', note: '#1c2940', noteFg: '#90b4f3', tip: '#1a3027', tipFg: '#7bd0a1', warn: '#37290f', warnFg: '#e8b45f', bad: '#3a1d22', badFg: '#f19aa6' }
    : { bg: '#ffffff', fg: '#1c1f26', muted: '#687080', line: '#d9dce3', code: '#f2f3f6', accent: '#3b58d6', mark: '#fcef9f', note: '#eaf0fc', noteFg: '#2b58a6', tip: '#e7f4ec', tipFg: '#1e7546', warn: '#fcf2df', warnFg: '#975a07', bad: '#fdeaec', badFg: '#a3263a' };
  return `
@page { margin: 18mm 16mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; background: ${t.bg}; color: ${t.fg}; font: 15px/1.65 "IBM Plex Sans", "Segoe UI", system-ui, -apple-system, sans-serif; }
.markdown-body { max-width: 780px; margin: 0 auto; padding: 40px 24px 64px; overflow-wrap: break-word; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 .5em; break-after: avoid; }
h1 { font-size: 2em; margin-top: 0; letter-spacing: -.01em; }
h2 { font-size: 1.4em; padding-bottom: .3em; border-bottom: 1px solid ${t.line}; }
h3 { font-size: 1.15em; }
p, ul, ol, blockquote, table, pre, .callout { margin: 0 0 1em; }
a { color: ${t.accent}; }
img { max-width: 100%; }
hr { border: 0; border-top: 1px solid ${t.line}; margin: 2em 0; }
code { font: .88em "JetBrains Mono", Consolas, ui-monospace, monospace; background: ${t.code}; padding: .12em .36em; border-radius: 4px; }
pre { background: ${t.code}; padding: 14px 16px; border-radius: 8px; overflow-x: auto; break-inside: avoid; }
pre code { background: none; padding: 0; font-size: .86em; }
blockquote { padding: 0 1em; border-left: 3px solid ${t.line}; color: ${t.muted}; }
mark { background: ${t.mark}; color: inherit; padding: 0 .12em; border-radius: 3px; }
table { border-collapse: collapse; display: block; overflow-x: auto; }
th, td { border: 1px solid ${t.line}; padding: 6px 12px; }
th { background: ${t.code}; }
li > input[type=checkbox] { margin-right: .5em; }
ul.contains-task-list { list-style: none; padding-left: 1.2em; }
.callout { padding: .75em 1em; border-radius: 8px; background: ${t.note}; break-inside: avoid; }
.callout > :last-child { margin-bottom: 0; }
.callout-title { font: 600 11px/1.6 system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: ${t.noteFg}; margin-bottom: .2em; }
.callout[data-kind=tip] { background: ${t.tip}; } .callout[data-kind=tip] .callout-title { color: ${t.tipFg}; }
.callout[data-kind=warning], .callout[data-kind=important] { background: ${t.warn}; }
.callout[data-kind=warning] .callout-title, .callout[data-kind=important] .callout-title { color: ${t.warnFg}; }
.callout[data-kind=caution] { background: ${t.bad}; } .callout[data-kind=caution] .callout-title { color: ${t.badFg}; }
.footnotes { font-size: .9em; color: ${t.muted}; border-top: 1px solid ${t.line}; margin-top: 2.5em; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
`;
}
