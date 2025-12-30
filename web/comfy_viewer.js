import { app } from "../../scripts/app.js";

const EXT_NAME = "WAS.ContentViewer";
const NODE_NAME = "WASComfyViewer";

const DEFAULT_NODE_SIZE = [600, 500];
const CONTROLS_HEIGHT = 32;
const INPUT_SLOT_HEIGHT = 26;

const STATE = {
  container: null,
  nodeIdToElements: new Map(),
  cleanupIntervalId: null,
  cleanupListenersAttached: false,
  lastScale: 1,
  prismScripts: null,
};

const PRISM_FILES = [
  "prism.min.txt",
  "prism-python.min.txt",
  "prism-javascript.min.txt",
  "prism-css.min.txt",
  "prism-markup.min.txt",
  "prism-json.min.txt",
  "prism-bash.min.txt",
];

async function loadPrismScripts() {
  if (STATE.prismScripts) return STATE.prismScripts;
  
  try {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf("/"));
    const scripts = await Promise.all(
      PRISM_FILES.map(async (file) => {
        const res = await fetch(`${basePath}/${file}`);
        return res.ok ? res.text() : "";
      })
    );
    STATE.prismScripts = scripts.join("\n");
    return STATE.prismScripts;
  } catch (e) {
    console.error("[WAS Viewer] Failed to load Prism scripts:", e);
    return "";
  }
}

loadPrismScripts();

function readCssVar(style, name) {
  const v = style.getPropertyValue(name);
  return v ? String(v).trim() : "";
}

function computeThemeTokens() {
  const rootStyle = getComputedStyle(document.documentElement);
  const bodyStyle = getComputedStyle(document.body);

  const bg =
    readCssVar(rootStyle, "--comfy-menu-bg") ||
    readCssVar(rootStyle, "--background-color") ||
    readCssVar(rootStyle, "--bg-color") ||
    bodyStyle.backgroundColor ||
    "#1a1a1a";
  const fg =
    readCssVar(rootStyle, "--input-text") ||
    readCssVar(rootStyle, "--text-color") ||
    readCssVar(rootStyle, "--fg-color") ||
    bodyStyle.color ||
    "#e0e0e0";
  const border =
    readCssVar(rootStyle, "--border-color") ||
    readCssVar(rootStyle, "--comfy-border-color") ||
    "#444";
  const accent =
    readCssVar(rootStyle, "--primary-color") ||
    readCssVar(rootStyle, "--accent-color") ||
    readCssVar(rootStyle, "--comfy-accent") ||
    "#4a9eff";

  return { bg, fg, border, accent };
}

function detectContentType(content) {
  if (!content || typeof content !== "string") return "text";
  const trimmed = content.trim();

  if (trimmed.startsWith("<svg") || 
      (trimmed.startsWith("<?xml") && trimmed.includes("<svg")) ||
      (trimmed.startsWith("<") && trimmed.includes("xmlns") && trimmed.includes("<svg"))) {
    return "svg";
  }

  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html") || 
      (trimmed.startsWith("<") && (trimmed.includes("<head") || trimmed.includes("<body")))) {
    return "html";
  }

  const scores = { html: 0, markdown: 0, python: 0, javascript: 0, css: 0 };

  const htmlTags = ["<div", "<span", "<p>", "<h1", "<h2", "<h3", "<table", "<ul", "<ol", 
                    "<img", "<a ", "<br", "<hr", "<em>", "<strong>", "<b>", "<i>", "<code>", "<pre>"];
  for (const tag of htmlTags) {
    if (trimmed.includes(tag)) scores.html += 2;
  }
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) scores.html += 1;

  const mdPatterns = [
    [/^#{1,6}\s+.+/m, 3],
    [/^\s*[-*+]\s+.+/m, 1],
    [/^\s*\d+\.\s+.+/m, 1],
    [/\[[^\]]+\]\([^)]+\)/, 2],
    [/^\s*```/m, 3],
    [/^\s*>/m, 1],
    [/\*\*[^*]+\*\*/, 1],
    [/~~[^~]+~~/, 1],
    [/^\s*\|.+\|.+\|/m, 2],
    [/!\[[^\]]*\]\([^)]+\)/, 2],
  ];
  for (const [pattern, weight] of mdPatterns) {
    if (pattern.test(trimmed)) scores.markdown += weight;
  }

  const pyPatterns = [
    [/^import\s+\w+/m, 3],
    [/^from\s+\w+\s+import/m, 3],
    [/^def\s+\w+\s*\(/m, 3],
    [/^class\s+\w+/m, 3],
    [/self\.\w+/, 2],
    [/__init__/, 2],
    [/__name__/, 2],
    [/:\s*$/m, 1],
    [/^\s+return\s+/m, 1],
    [/^\s+if\s+.+:/m, 1],
    [/^\s+for\s+.+:/m, 1],
    [/^\s+elif\s+/m, 2],
    [/True|False|None/, 1],
  ];
  for (const [pattern, weight] of pyPatterns) {
    if (pattern.test(trimmed)) scores.python += weight;
  }

  const jsPatterns = [
    [/^function\s+\w+\s*\(/m, 3],
    [/^const\s+\w+\s*=/m, 3],
    [/^let\s+\w+\s*=/m, 3],
    [/^var\s+\w+\s*=/m, 2],
    [/=>\s*\{/, 2],
    [/^import\s+\{/m, 3],
    [/^export\s+(default\s+)?/m, 3],
    [/document\.\w+/, 2],
    [/console\.\w+/, 2],
    [/\.addEventListener\(/, 2],
    [/===|!==/, 1],
    [/\?\.\w+/, 2],
  ];
  for (const [pattern, weight] of jsPatterns) {
    if (pattern.test(trimmed)) scores.javascript += weight;
  }

  const cssPatterns = [
    [/[.#][\w-]+\s*\{/, 2],
    [/:\s*[\w-]+\s*;/, 2],
    [/@media\s/, 3],
    [/@import\s/, 2],
    [/@keyframes\s/, 3],
    [/^\s*[\w-]+:\s*[^;]+;/m, 1],
  ];
  for (const [pattern, weight] of cssPatterns) {
    if (pattern.test(trimmed)) scores.css += weight;
  }

  let maxType = "text";
  let maxScore = 0;
  for (const [type, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      maxType = type;
    }
  }

  return maxScore >= 2 ? maxType : "text";
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function parseMarkdown(md) {
  let html = md;

  html = html.replace(/^```(\w*)\n([\s\S]*?)```$/gm, (_, lang, code) => {
    return `<pre><code class="language-${lang || "text"}">${escapeHtml(code.trim())}</code></pre>`;
  });

  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  html = html.replace(/^######\s+(.*)$/gm, "<h6>$1</h6>");
  html = html.replace(/^#####\s+(.*)$/gm, "<h5>$1</h5>");
  html = html.replace(/^####\s+(.*)$/gm, "<h4>$1</h4>");
  html = html.replace(/^###\s+(.*)$/gm, "<h3>$1</h3>");
  html = html.replace(/^##\s+(.*)$/gm, "<h2>$1</h2>");
  html = html.replace(/^#\s+(.*)$/gm, "<h1>$1</h1>");

  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;">');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/(?<![a-zA-Z0-9\/_])_([^_\s][^_]*)_(?![a-zA-Z0-9\/_])/g, "<em>$1</em>");
  html = html.replace(/~~(.+?)~~/g, "<del>$1</del>");

  html = html.replace(/^>\s+(.*)$/gm, "<blockquote>$1</blockquote>");

  html = html.replace(/^\d+\.\s+(.*)$/gm, "<oli>$1</oli>");
  html = html.replace(/(<oli>.*<\/oli>\n?)+/g, (match) => {
    return "<ol>" + match.replace(/<\/?oli>/g, (tag) => tag.replace("oli", "li")) + "</ol>";
  });

  html = html.replace(/^[-*+]\s+(.*)$/gm, "<uli>$1</uli>");
  html = html.replace(/(<uli>.*<\/uli>\n?)+/g, (match) => {
    return "<ul>" + match.replace(/<\/?uli>/g, (tag) => tag.replace("uli", "li")) + "</ul>";
  });

  html = html.replace(/^---$/gm, "<hr>");
  html = html.replace(/^\*\*\*$/gm, "<hr>");

  html = html.replace(/^(\|.+\|)\n(\|[-:\s|]+\|)\n((?:\|.+\|\n?)+)/gm, (match, headerRow, separatorRow, bodyRows) => {
    const parseRow = (row, cellTag) => {
      const cells = row.split("|").slice(1, -1);
      return `<tr>${cells.map(c => `<${cellTag}>${c.trim()}</${cellTag}>`).join("")}</tr>`;
    };
    const alignments = separatorRow.split("|").slice(1, -1).map(cell => {
      const trimmed = cell.trim();
      if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
      if (trimmed.endsWith(":")) return "right";
      return "left";
    });
    const headerCells = headerRow.split("|").slice(1, -1);
    const theadRow = `<tr>${headerCells.map((c, i) => `<th style="text-align:${alignments[i] || "left"}">${c.trim()}</th>`).join("")}</tr>`;
    const bodyRowsArray = bodyRows.trim().split("\n");
    const tbodyRows = bodyRowsArray.map(row => {
      const cells = row.split("|").slice(1, -1);
      return `<tr>${cells.map((c, i) => `<td style="text-align:${alignments[i] || "left"}">${c.trim()}</td>`).join("")}</tr>`;
    }).join("");
    return `<table><thead>${theadRow}</thead><tbody>${tbodyRows}</tbody></table>`;
  });

  html = html.replace(/\n\n/g, "</p><p>");
  html = "<p>" + html + "</p>";
  html = html.replace(/<p>\s*<(h[1-6]|ul|ol|pre|blockquote|hr|table)/g, "<$1");
  html = html.replace(/<\/(h[1-6]|ul|ol|pre|blockquote|table)>\s*<\/p>/g, "</$1>");
  html = html.replace(/<p>\s*<\/p>/g, "");

  return html;
}

function renderCodeContent(content, language) {
  const langMap = {
    python: "python",
    javascript: "javascript",
    css: "css",
    text: "plaintext",
  };
  const lang = langMap[language] || "plaintext";
  return `<pre><code class="language-${lang}">${escapeHtml(content)}</code></pre>`;
}

async function createZipBlob(files) {
  const crc32 = (data) => {
    let crc = 0xFFFFFFFF;
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[i] = c;
    }
    for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  };

  const encoder = new TextEncoder();
  const parts = [];
  const centralDir = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const contentBytes = encoder.encode(file.content);
    const crc = crc32(contentBytes);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(localHeader.buffer);
    
    view.setUint32(0, 0x04034B50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, contentBytes.length, true);
    view.setUint32(22, contentBytes.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    const centralEntry = new Uint8Array(46 + nameBytes.length);
    const cView = new DataView(centralEntry.buffer);
    cView.setUint32(0, 0x02014B50, true);
    cView.setUint16(4, 20, true);
    cView.setUint16(6, 20, true);
    cView.setUint16(8, 0, true);
    cView.setUint16(10, 0, true);
    cView.setUint16(12, 0, true);
    cView.setUint16(14, 0, true);
    cView.setUint32(16, crc, true);
    cView.setUint32(20, contentBytes.length, true);
    cView.setUint32(24, contentBytes.length, true);
    cView.setUint16(28, nameBytes.length, true);
    cView.setUint16(30, 0, true);
    cView.setUint16(32, 0, true);
    cView.setUint16(34, 0, true);
    cView.setUint16(36, 0, true);
    cView.setUint32(38, 0, true);
    cView.setUint32(42, offset, true);
    centralEntry.set(nameBytes, 46);

    parts.push(localHeader, contentBytes);
    centralDir.push(centralEntry);
    offset += localHeader.length + contentBytes.length;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const entry of centralDir) {
    parts.push(entry);
    centralDirSize += entry.length;
  }

  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054B50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralDirSize, true);
  endView.setUint32(16, centralDirOffset, true);
  endView.setUint16(20, 0, true);
  parts.push(endRecord);

  return new Blob(parts, { type: "application/zip" });
}

function buildIframeContent(content, contentType, theme, excluded = []) {
  const baseStyles = `
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 4px;
      background: ${theme.bg};
      color: ${theme.fg};
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      overflow-x: hidden;
      word-wrap: break-word;
    }
    a { color: ${theme.accent}; }
    pre {
      background: rgba(0,0,0,0.3);
      padding: 12px;
      border-radius: 6px;
      overflow-x: hidden;
      white-space: pre-wrap;
      word-wrap: break-word;
      overflow-wrap: break-word;
      font-family: "Fira Code", "Consolas", "Monaco", monospace;
      font-size: 13px;
    }
    code {
      background: rgba(0,0,0,0.2);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: "Fira Code", "Consolas", "Monaco", monospace;
    }
    pre code {
      background: transparent;
      padding: 0;
    }
    blockquote {
      border-left: 4px solid ${theme.accent};
      margin: 12px 0;
      padding: 8px 16px;
      background: rgba(0,0,0,0.15);
    }
    img { max-width: 100%; height: auto; border-radius: 4px; }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 12px 0;
      border: 1px solid ${theme.border};
    }
    th, td {
      border: 1px solid ${theme.border};
      padding: 8px;
      text-align: left;
    }
    th { background: rgba(0,0,0,0.2); }
    tr:last-child td { border-bottom: 1px solid ${theme.border}; }
    hr {
      border: none;
      border-top: 1px solid ${theme.border};
      margin: 16px 0;
    }
    h1, h2, h3, h4, h5, h6 {
      margin-top: 20px;
      margin-bottom: 10px;
      color: ${theme.fg};
    }
    ul, ol { padding-left: 24px; }
    li { margin: 4px 0; }
    .list-item {
      background: rgba(0,0,0,0.2);
      border: 1px solid ${theme.border};
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 8px;
      position: relative;
    }
    .list-item:last-child { margin-bottom: 0; }
    .list-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .list-header-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .list-checkbox {
      width: 16px;
      height: 16px;
      cursor: pointer;
      accent-color: ${theme.accent};
    }
    .list-index {
      display: inline-block;
      background: ${theme.accent};
      color: #fff;
      font-size: 11px;
      font-weight: bold;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .list-item.excluded {
      opacity: 0.5;
    }
    .list-item.excluded .list-index {
      background: #666;
    }
    .copy-btn {
      background: transparent;
      border: 1px solid ${theme.border};
      border-radius: 4px;
      color: ${theme.fg};
      cursor: pointer;
      padding: 4px 8px;
      font-size: 11px;
      display: flex;
      align-items: center;
      gap: 4px;
      transition: all 0.2s;
    }
    .copy-btn:hover {
      background: ${theme.accent};
      color: #fff;
      border-color: ${theme.accent};
    }
    .copy-btn.copied {
      background: #22c55e;
      border-color: #22c55e;
      color: #fff;
    }
    .list-content {
      white-space: pre-wrap;
      word-wrap: break-word;
    }
  `;

  const LIST_SEPARATOR = "\n---LIST_SEPARATOR---\n";
  const isListContent = content.includes(LIST_SEPARATOR);
  
  let bodyContent = "";
  
  if (isListContent) {
    const items = content.split(LIST_SEPARATOR);
    const itemsData = JSON.stringify(items);
    bodyContent = items.map((item, idx) => {
      const itemType = detectContentType(item);
      let itemHtml = "";
      if (itemType === "html") {
        itemHtml = item;
      } else if (itemType === "markdown") {
        itemHtml = parseMarkdown(item);
      } else {
        itemHtml = `<div class="list-content">${escapeHtml(item)}</div>`;
      }
      const isExcluded = excluded.includes(idx);
      return `<div class="list-item${isExcluded ? ' excluded' : ''}" data-idx="${idx}">
        <div class="list-header">
          <div class="list-header-left">
            <input type="checkbox" class="list-checkbox" data-idx="${idx}" ${isExcluded ? '' : 'checked'} onchange="toggleItem(${idx}, this.checked)">
            <span class="list-index">${idx + 1} / ${items.length}</span>
          </div>
          <button class="copy-btn" data-index="${idx}" onclick="copyItem(${idx})">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            Copy
          </button>
        </div>
        ${itemHtml}
      </div>`;
    }).join("");
    bodyContent += `<script>
      const items = ${itemsData};
      function copyItem(idx) {
        const text = items[idx];
        navigator.clipboard.writeText(text).then(() => {
          const btn = document.querySelector('[data-index="' + idx + '"]');
          btn.classList.add('copied');
          btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!';
          setTimeout(() => {
            btn.classList.remove('copied');
            btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> Copy';
          }, 1500);
        });
      }
      function toggleItem(idx, checked) {
        const item = document.querySelector('.list-item[data-idx="' + idx + '"]');
        if (item) item.classList.toggle('excluded', !checked);
        window.parent.postMessage({ type: 'was-viewer-toggle', idx: idx, checked: checked }, '*');
      }
    <\/script>`;
  } else switch (contentType) {
    case "html":
      if (content.includes("<html") || content.includes("<!DOCTYPE")) {
        const hasCustomStyles = content.includes("<style") || 
                                content.includes("background") || 
                                content.includes("color:");
        if (hasCustomStyles) {
          return content;
        }
        return content.replace("</head>", `<style>${baseStyles}</style></head>`);
      }
      bodyContent = content;
      break;
    case "markdown":
      bodyContent = parseMarkdown(content);
      break;
    case "svg":
      bodyContent = `<div style="display:flex;justify-content:center;align-items:center;min-height:100%;padding:16px;">${content}</div>`;
      break;
    case "python":
    case "javascript":
    case "css":
    case "text":
      bodyContent = renderCodeContent(content, contentType);
      break;
    default:
      bodyContent = `<pre>${escapeHtml(content)}</pre>`;
  }

  const prismTheme = `
    code[class*="language-"], pre[class*="language-"] {
      color: ${theme.fg};
      text-shadow: none;
      font-family: "Fira Code", Consolas, Monaco, 'Andale Mono', 'Ubuntu Mono', monospace;
      font-size: 13px;
      text-align: left;
      white-space: pre-wrap;
      word-spacing: normal;
      word-break: normal;
      word-wrap: break-word;
      line-height: 1.5;
      tab-size: 4;
      hyphens: none;
    }
    pre[class*="language-"] {
      padding: 12px;
      margin: 0;
      overflow: auto;
      border-radius: 6px;
      background: rgba(0,0,0,0.3);
    }
    :not(pre) > code[class*="language-"] {
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(0,0,0,0.2);
    }
    .token.comment, .token.prolog, .token.doctype, .token.cdata { color: #6a9955; }
    .token.punctuation { color: ${theme.fg}; }
    .token.namespace { opacity: .7; }
    .token.property, .token.tag, .token.boolean, .token.number, .token.constant, .token.symbol, .token.deleted { color: #b5cea8; }
    .token.selector, .token.attr-name, .token.string, .token.char, .token.builtin, .token.inserted { color: #ce9178; }
    .token.operator, .token.entity, .token.url, .language-css .token.string, .style .token.string { color: #d4d4d4; }
    .token.atrule, .token.attr-value, .token.keyword { color: #569cd6; }
    .token.function, .token.class-name { color: #dcdcaa; }
    .token.regex, .token.important, .token.variable { color: #d16969; }
    .token.important, .token.bold { font-weight: bold; }
    .token.italic { font-style: italic; }
  `;

  const needsPrism = ["python", "javascript", "css"].includes(contentType) || 
                     content.includes("```") || content.includes("<code");

  const prismScripts = needsPrism && STATE.prismScripts ? `
    <script>${STATE.prismScripts}<\/script>
    <script>document.addEventListener('DOMContentLoaded', () => Prism.highlightAll());<\/script>
  ` : "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>${baseStyles}${needsPrism ? prismTheme : ""}</style>
  ${prismScripts}
</head>
<body>${bodyContent}</body>
</html>`;
}

function getActiveGraphNodes() {
  const g = app?.graph || app?.canvas?.graph;
  const nodes = g?._nodes || g?.nodes;
  return Array.isArray(nodes) ? nodes : [];
}

function isViewerNode(node) {
  try {
    return (
      node?.comfyClass === NODE_NAME ||
      node?.type === NODE_NAME ||
      node?.constructor?.comfyClass === NODE_NAME ||
      node?.constructor?.type === NODE_NAME
    );
  } catch (e) {
    console.error("[WAS Viewer] isViewerNode error:", e);
    return false;
  }
}

function removeElementsByKey(key) {
  try {
    const elements = STATE.nodeIdToElements.get(key);
    if (!elements) return;
    elements.wrapper?.remove();
  } catch (e) {
    console.error("[WAS Viewer] removeElementsByKey error:", e);
  } finally {
    STATE.nodeIdToElements.delete(key);
  }
}

function cleanupOrphanElements() {
  try {
    const nodes = getActiveGraphNodes();
    const activeIds = new Set(
      nodes
        .filter((n) => isViewerNode(n))
        .map((n) => String(n.id))
    );

    for (const key of Array.from(STATE.nodeIdToElements.keys())) {
      if (!activeIds.has(key)) {
        removeElementsByKey(key);
      }
    }

    if (STATE.nodeIdToElements.size === 0 && STATE.container) {
      try {
        STATE.container.remove();
      } catch (e) {
        console.error("[WAS Viewer] container remove error:", e);
      }
      STATE.container = null;
    }
  } catch (e) {
    console.error("[WAS Viewer] cleanupOrphanElements error:", e);
  }
}

function ensureCleanupRunning() {
  if (STATE.cleanupIntervalId != null) return;
  STATE.cleanupIntervalId = window.setInterval(() => cleanupOrphanElements(), 1000);
  if (!STATE.cleanupListenersAttached) {
    STATE.cleanupListenersAttached = true;
    const onVis = () => cleanupOrphanElements();
    const onFocus = () => cleanupOrphanElements();
    window.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
  }
}

function getContainer() {
  if (STATE.container) return STATE.container;
  
  const canvasEl = app.canvas?.canvas;
  const canvasParent = canvasEl?.parentElement;
  
  if (!canvasParent) {
    return null;
  }
  
  if (getComputedStyle(canvasParent).position === "static") {
    canvasParent.style.position = "relative";
  }
  
  const el = document.createElement("div");
  el.id = "was-viewer-overlay";
  el.style.cssText = `
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 100;
    overflow: hidden;
  `;
  canvasParent.appendChild(el);
  STATE.container = el;
  return el;
}

function getWidgetValue(node, name) {
  const widget = node.widgets?.find((w) => w.name === name);
  if (widget?.value) return widget.value;
  
  const widgetIndex = node.widgets?.findIndex((w) => w.name === name);
  if (widgetIndex >= 0 && node.widgets_values?.[widgetIndex]) {
    return node.widgets_values[widgetIndex];
  }
  
  return "";
}

function setWidgetValue(node, name, value) {
  const widget = node.widgets?.find((w) => w.name === name);
  if (widget) {
    widget.value = value;
  }
  
  const widgetIndex = node.widgets?.findIndex((w) => w.name === name);
  if (widgetIndex >= 0) {
    if (!node.widgets_values) node.widgets_values = [];
    node.widgets_values[widgetIndex] = value;
  }
}

function getConnectedContent(node) {
  const inputLink = node.inputs?.find((i) => i.name === "content")?.link;
  if (inputLink == null) return null;
  
  const link = app.graph.links?.[inputLink];
  if (!link) return null;
  
  const originNode = app.graph.getNodeById(link.origin_id);
  if (!originNode) return null;
  
  if (originNode.getOutputData) {
    const outputData = originNode.getOutputData(link.origin_slot);
    if (outputData && typeof outputData === "string") {
      return outputData;
    }
  }
  
  const widgets = originNode.widgets || [];
  for (let i = 0; i < widgets.length; i++) {
    const w = widgets[i];
    if (w && typeof w.value === "string" && w.value.length > 0) {
      return w.value;
    }
  }
  
  return null;
}

function getNodeContent(node, elements) {
  const manualContent = getWidgetValue(node, "manual_content");
  
  if (manualContent && (elements?.hasBackendContent || elements?.hasUserEdits)) {
    return manualContent;
  }
  
  const connectedContent = getConnectedContent(node);
  if (connectedContent) {
    return connectedContent;
  }
  
  return manualContent || "";
}

function createControlsBar(node, elements) {
  const theme = computeThemeTokens();
  
  const controls = document.createElement("div");
  controls.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    background: ${theme.bg};
    border-bottom: 1px solid ${theme.border};
    border-radius: 8px 8px 0 0;
    pointer-events: auto;
    box-sizing: border-box;
    flex-shrink: 0;
    min-height: ${CONTROLS_HEIGHT}px;
  `;

  const typeLabel = document.createElement("span");
  typeLabel.style.cssText = `
    font-size: 11px;
    color: ${theme.fg};
    opacity: 0.7;
    font-family: sans-serif;
    margin-right: auto;
  `;
  typeLabel.textContent = "Type: detecting...";
  controls.appendChild(typeLabel);

  const toggleAllBtn = document.createElement("button");
  toggleAllBtn.textContent = "☑";
  toggleAllBtn.title = "Toggle All Checkboxes";
  toggleAllBtn.style.cssText = `
    padding: 0 6px;
    font-size: 14px;
    border: 1px solid ${theme.border};
    border-radius: 4px;
    background: ${theme.bg};
    color: ${theme.fg};
    cursor: pointer;
    font-family: sans-serif;
    display: none;
  `;
  toggleAllBtn.onmouseenter = () => { toggleAllBtn.style.background = theme.accent; toggleAllBtn.style.color = "#fff"; };
  toggleAllBtn.onmouseleave = () => { toggleAllBtn.style.background = theme.bg; toggleAllBtn.style.color = theme.fg; };
  
  toggleAllBtn.onclick = () => {
    const content = getNodeContent(node, elements);
    const contentHash = content ? content.length + "_" + content.slice(0, 100) : "";
    const widget = node.widgets?.find(w => w.name === "excluded_indices");
    if (!widget) return;
    
    let data = { hash: contentHash, excluded: [] };
    try {
      const parsed = JSON.parse(widget.value || "{}");
      if (parsed && typeof parsed === "object" && parsed.hash !== undefined) {
        data = parsed;
      }
    } catch {}
    
    const LIST_SEPARATOR = "\n---LIST_SEPARATOR---\n";
    const items = content.split(LIST_SEPARATOR);
    const allChecked = data.excluded.length === 0;
    
    if (allChecked) {
      data.excluded = items.map((_, i) => i);
      toggleAllBtn.textContent = "☐";
      toggleAllBtn.title = "Check All";
    } else {
      data.excluded = [];
      toggleAllBtn.textContent = "☑";
      toggleAllBtn.title = "Uncheck All";
    }
    
    widget.value = JSON.stringify(data);
    elements.lastContentHash = "";
    node.setDirtyCanvas?.(true, true);
    updateIframeContent(node, elements);
  };
  controls.appendChild(toggleAllBtn);
  elements.toggleAllBtn = toggleAllBtn;

  const editBtn = document.createElement("button");
  editBtn.textContent = "Edit";
  editBtn.style.cssText = `
    padding: 4px 12px;
    font-size: 11px;
    border: 1px solid ${theme.border};
    border-radius: 4px;
    background: ${theme.bg};
    color: ${theme.fg};
    cursor: pointer;
    font-family: sans-serif;
  `;
  editBtn.onmouseenter = () => { editBtn.style.background = theme.accent; editBtn.style.color = "#fff"; };
  editBtn.onmouseleave = () => { editBtn.style.background = theme.bg; editBtn.style.color = theme.fg; };
  
  editBtn.onclick = () => {
    if (elements.isEditing) {
      let newContent = "";
      if (elements.listTextareas && elements.listTextareas.length > 0) {
        const values = elements.listTextareas.map(ta => ta.value);
        newContent = values.join("\n---LIST_SEPARATOR---\n");
        elements.listEditContainer.style.display = "none";
        elements.listTextareas = [];
      } else {
        newContent = elements.textarea.value;
        elements.textarea.style.display = "none";
      }
      setWidgetValue(node, "manual_content", newContent);
      elements.hasBackendContent = false;
      elements.hasUserEdits = true;
      elements.lastContentHash = "";
      elements.isEditing = false;
      elements.iframe.style.display = "block";
      editBtn.textContent = "Edit";
      node.setDirtyCanvas?.(true, true);
      app.graph?.change?.();
      updateIframeContent(node, elements);
    } else {
      elements.isEditing = true;
      const currentContent = getNodeContent(node, elements);
      const LIST_SEPARATOR = "\n---LIST_SEPARATOR---\n";
      
      if (currentContent.includes(LIST_SEPARATOR)) {
        const items = currentContent.split(LIST_SEPARATOR);
        if (!elements.listEditContainer && elements.contentWrapper) {
          elements.listEditContainer = document.createElement("div");
          elements.listEditContainer.style.cssText = `
            position: absolute;
            inset: 0;
            overflow-y: auto;
            padding: 8px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            background: ${theme.bg};
          `;
          elements.contentWrapper.appendChild(elements.listEditContainer);
        }
        if (!elements.listEditContainer) return;
        elements.listEditContainer.innerHTML = "";
        elements.listEditContainer.style.display = "flex";
        elements.listTextareas = [];
        
        items.forEach((item, idx) => {
          const itemContainer = document.createElement("div");
          itemContainer.style.cssText = `
            background: rgba(0,0,0,0.2);
            border: 1px solid ${theme.border};
            border-radius: 6px;
            padding: 8px;
            display: flex;
            flex-direction: column;
            gap: 4px;
          `;
          const label = document.createElement("span");
          label.textContent = `${idx + 1} / ${items.length}`;
          label.style.cssText = `
            background: ${theme.accent};
            color: #fff;
            font-size: 11px;
            font-weight: bold;
            padding: 2px 6px;
            border-radius: 4px;
            align-self: flex-start;
          `;
          const ta = document.createElement("textarea");
          ta.value = item;
          ta.style.cssText = `
            width: 100%;
            min-height: 80px;
            resize: vertical;
            background: rgba(0,0,0,0.3);
            color: ${theme.fg};
            border: 1px solid ${theme.border};
            border-radius: 4px;
            padding: 8px;
            font-family: monospace;
            font-size: 13px;
          `;
          itemContainer.appendChild(label);
          itemContainer.appendChild(ta);
          elements.listEditContainer.appendChild(itemContainer);
          elements.listTextareas.push(ta);
        });
        elements.iframe.style.display = "none";
        elements.textarea.style.display = "none";
      } else {
        elements.textarea.value = currentContent;
        elements.textarea.style.display = "block";
        elements.iframe.style.display = "none";
        if (elements.listEditContainer) elements.listEditContainer.style.display = "none";
      }
      editBtn.textContent = "Save";
      if (elements.listTextareas?.[0]) {
        elements.listTextareas[0].focus();
      } else {
        elements.textarea.focus();
      }
    }
  };
  controls.appendChild(editBtn);

  const clearBtn = document.createElement("button");
  clearBtn.textContent = "Clear";
  clearBtn.style.cssText = `
    padding: 4px 12px;
    font-size: 11px;
    border: 1px solid ${theme.border};
    border-radius: 4px;
    background: ${theme.bg};
    color: ${theme.fg};
    cursor: pointer;
    font-family: sans-serif;
  `;
  clearBtn.onmouseenter = () => { clearBtn.style.background = "#c44"; clearBtn.style.color = "#fff"; };
  clearBtn.onmouseleave = () => { clearBtn.style.background = theme.bg; clearBtn.style.color = theme.fg; };
  
  clearBtn.onclick = () => {
    setWidgetValue(node, "manual_content", "");
    const contentWidget = node.widgets?.find((w) => w.name === "content");
    if (contentWidget) contentWidget.value = "";
    elements.lastContentHash = "";
    elements.textarea.value = "";
    if (elements.isEditing) {
      elements.isEditing = false;
      elements.textarea.style.display = "none";
      elements.iframe.style.display = "block";
      editBtn.textContent = "Edit";
    }
    node.setDirtyCanvas?.(true, true);
    app.graph?.change?.();
    
    const theme = computeThemeTokens();
    const emptyHtml = buildIframeContent("<p style='opacity:0.5;text-align:center;margin-top:40px;'>No content. Click Edit to add content or connect a STRING input.</p>", "html", theme);
    elements.iframe.srcdoc = emptyHtml;
    if (elements.typeLabel) elements.typeLabel.textContent = "Type: Text";
  };
  controls.appendChild(clearBtn);

  const fullscreenBtn = document.createElement("button");
  fullscreenBtn.textContent = "⛶";
  fullscreenBtn.title = "Fullscreen";
  fullscreenBtn.style.cssText = `
    padding: 0 4px;
    font-size: 14px;
    border: 1px solid ${theme.border};
    border-radius: 4px;
    background: ${theme.bg};
    color: ${theme.fg};
    cursor: pointer;
    font-family: sans-serif;
  `;
  fullscreenBtn.onmouseenter = () => { fullscreenBtn.style.background = theme.accent; fullscreenBtn.style.color = "#fff"; };
  fullscreenBtn.onmouseleave = () => { fullscreenBtn.style.background = theme.bg; fullscreenBtn.style.color = theme.fg; };
  
  fullscreenBtn.onclick = () => {
    if (elements.iframe) {
      if (elements.iframe.requestFullscreen) {
        elements.iframe.requestFullscreen();
      } else if (elements.iframe.webkitRequestFullscreen) {
        elements.iframe.webkitRequestFullscreen();
      } else if (elements.iframe.mozRequestFullScreen) {
        elements.iframe.mozRequestFullScreen();
      } else if (elements.iframe.msRequestFullscreen) {
        elements.iframe.msRequestFullscreen();
      }
    }
  };
  controls.appendChild(fullscreenBtn);

  const downloadBtn = document.createElement("button");
  downloadBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" width="16" height="16">
    <path fill="${theme.fg}" d="M5.625 15c0-.4142-.33579-.75-.75-.75s-.75.3358-.75.75h1.5Zm-.75 1h-.75.75Zm14.4-1c0-.4142-.3358-.75-.75-.75s-.75.3358-.75.75h1.5Zm-8.1664.5387c-.2547.3266-.1965.7979.1301 1.0527.3266.2547.7979.1965 1.0527-.1301l-1.1828-.9226Zm5.0828-4.0774c.2547-.3266.1965-.7979-.1301-1.0527-.3266-.2547-.7979-.1965-1.0527.1301l1.1828.9226Zm-5.0828 5c.2548.3266.7261.3848 1.0527.1301.3266-.2548.3848-.7261.1301-1.0527l-1.1828.9226Zm-2.71722-5.9226c-.25476-.3266-.72605-.3848-1.05265-.1301-.32661.2548-.38486.7261-.13011 1.0527l1.18276-.9226ZM10.95 16c0 .4142.3358.75.75.75s.75-.3358.75-.75h-1.5Zm1.5-11c0-.41421-.3358-.75-.75-.75s-.75.33579-.75.75h1.5ZM4.125 15v1h1.5v-1h-1.5Zm0 1c0 2.0531 1.62757 3.75 3.675 3.75v-1.5c-1.18343 0-2.175-.9893-2.175-2.25h-1.5ZM7.8 19.75h7.8v-1.5H7.8v1.5Zm7.8 0c2.0474 0 3.675-1.6969 3.675-3.75h-1.5c0 1.2607-.9916 2.25-2.175 2.25v1.5ZM19.275 16v-1h-1.5v1h1.5Zm-6.9836.4613 3.9-5-1.1828-.9226-3.9 5 1.1828.9226Zm0-.9226-3.90002-5-1.18276.9226 3.89998 5 1.1828-.9226ZM12.45 16V5h-1.5v11h1.5Z"/>
  </svg>`;
  downloadBtn.title = "Download";
  downloadBtn.style.cssText = `
    padding: 2px 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid ${theme.border};
    border-radius: 4px;
    background: ${theme.bg};
    cursor: pointer;
  `;
  const updateDownloadSvg = (color) => {
    const path = downloadBtn.querySelector("path");
    if (path) path.setAttribute("fill", color);
  };
  downloadBtn.onmouseenter = () => { downloadBtn.style.background = theme.accent; updateDownloadSvg("#fff"); };
  downloadBtn.onmouseleave = () => { downloadBtn.style.background = theme.bg; updateDownloadSvg(theme.fg); };
  
  downloadBtn.onclick = async () => {
    let content = getNodeContent(node, elements);
    if (!content) {
      content = elements.textarea?.value || "";
    }
    if (!content) {
      alert("No content to download");
      return;
    }
    
    const LIST_SEPARATOR = "\n---LIST_SEPARATOR---\n";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    
    try {
      if (content.includes(LIST_SEPARATOR)) {
        const items = content.split(LIST_SEPARATOR);
        const files = items.map((item, idx) => {
          const itemType = detectContentType(item);
          const extensions = { html: "html", svg: "svg", markdown: "md", python: "py", javascript: "js", css: "css", text: "txt" };
          const ext = extensions[itemType] || "txt";
          return { name: `item_${String(idx + 1).padStart(3, "0")}.${ext}`, content: item };
        });
        
        const zipBlob = await createZipBlob(files);
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `content_${timestamp}.zip`;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 100);
      } else {
        const contentType = detectContentType(content);
        const extensions = { html: "html", svg: "svg", markdown: "md", python: "py", javascript: "js", css: "css", text: "txt" };
        const ext = extensions[contentType] || "txt";
        const filename = `content_${timestamp}.${ext}`;
        
        const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 100);
      }
    } catch (e) {
      console.error("[WAS Viewer] download error:", e);
    }
  };
  controls.appendChild(downloadBtn);

  elements.typeLabel = typeLabel;
  return controls;
}

function ensureElementsForNode(node) {
  cleanupOrphanElements();
  ensureCleanupRunning();

  const key = String(node.id);
  const existing = STATE.nodeIdToElements.get(key);
  if (existing) return existing;

  const theme = computeThemeTokens();

  const wrapper = document.createElement("div");
  wrapper.style.cssText = `
    position: absolute;
    display: flex;
    flex-direction: column;
    pointer-events: none;
  `;

  const contentWrapper = document.createElement("div");
  
  const elements = {
    wrapper,
    contentWrapper,
    controls: null,
    iframe: null,
    textarea: null,
    typeLabel: null,
    toggleAllBtn: null,
    lastContentHash: "",
    isEditing: false,
    hasBackendContent: false,
    hasUserEdits: false,
    listEditContainer: null,
    listTextareas: null,
  };

  const controls = createControlsBar(node, elements);
  wrapper.appendChild(controls);
  elements.controls = controls;
  contentWrapper.style.cssText = `
    position: relative;
    flex: 1;
    overflow: hidden;
    border-radius: 0 0 8px 8px;
    pointer-events: auto;
  `;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-modals allow-pointer-lock allow-downloads");
  iframe.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen");
  iframe.setAttribute("allowfullscreen", "true");
  iframe.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border: 0;
    pointer-events: auto;
    background: ${theme.bg};
    border-radius: 0 0 8px 8px;
  `;
  contentWrapper.appendChild(iframe);
  elements.iframe = iframe;
  
  const initialHtml = buildIframeContent("<p style='opacity:0.5;text-align:center;margin-top:40px;'>No content. Click Edit to add content or connect a STRING input.</p>", "html", theme);
  iframe.srcdoc = initialHtml;
  if (elements.typeLabel) elements.typeLabel.textContent = "Type: Text";

  const textarea = document.createElement("textarea");
  textarea.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border: 0;
    pointer-events: auto;
    background: ${theme.bg};
    color: ${theme.fg};
    font-family: "Fira Code", "Consolas", "Monaco", monospace;
    font-size: 13px;
    padding: 16px;
    resize: none;
    display: none;
    box-sizing: border-box;
    border-radius: 0 0 8px 8px;
  `;
  textarea.placeholder = "Enter HTML, Markdown, or plain text content here...";
  contentWrapper.appendChild(textarea);
  elements.textarea = textarea;

  wrapper.appendChild(contentWrapper);

  getContainer().appendChild(wrapper);
  STATE.nodeIdToElements.set(key, elements);

  const oldOnRemoved = node.onRemoved;
  node.onRemoved = function () {
    try {
      removeElementsByKey(String(this.id));
      cleanupOrphanElements();
    } catch (e) {
      console.error("[WAS Viewer] onRemoved error:", e);
    }
    return oldOnRemoved ? oldOnRemoved.apply(this, arguments) : undefined;
  };

  return elements;
}

function updateElementsRect(node, elements) {
  const canvas = app.canvas;
  const canvasEl = canvas?.canvas;
  if (!canvasEl) return;

  const rect = canvasEl.getBoundingClientRect();
  
  const ds = canvas.ds;
  const scale = ds?.scale ?? 1;
  const offset = ds?.offset ?? [0, 0];

  const x = (node.pos[0] + offset[0]) * scale;
  const y = (node.pos[1] + offset[1]) * scale;
  const w = node.size[0] * scale;
  const h = node.size[1] * scale;

  const titleHRaw =
    (typeof node?.title_height === "number" && Number.isFinite(node.title_height) && node.title_height) ||
    (typeof node?.constructor?.title_height === "number" &&
      Number.isFinite(node.constructor.title_height) &&
      node.constructor.title_height) ||
    globalThis?.LiteGraph?.NODE_TITLE_HEIGHT ||
    30;
  
  const insetX = 8;
  const insetBottom = 8;
  
  const innerX = x + insetX * scale;
  const innerY = y + (titleHRaw - 5) * scale;
  const innerW = (node.size[0] - insetX * 2);
  const innerH = (node.size[1] - titleHRaw + 5 - insetBottom);

  const nx = Number.isFinite(innerX) ? innerX : 0;
  const ny = Number.isFinite(innerY) ? innerY : 0;
  const nw = Number.isFinite(innerW) ? innerW : 0;
  const nh = Number.isFinite(innerH) ? innerH : 0;

  elements.wrapper.style.left = `${Math.round(nx)}px`;
  elements.wrapper.style.top = `${Math.round(ny)}px`;
  elements.wrapper.style.width = `${Math.max(0, Math.round(nw))}px`;
  elements.wrapper.style.height = `${Math.max(0, Math.round(nh))}px`;
  elements.wrapper.style.transform = `scale(${scale})`;
  elements.wrapper.style.transformOrigin = 'top left';

  const isCollapsed = !!node.flags?.collapsed;
  const hasArea = nw >= 2 && nh >= 2;
  
  const isOffScreen = (x + w < 0) || (x > rect.width) || 
                      (y + h < 0) || (y > rect.height);
  
  elements.wrapper.style.display = (!isCollapsed && hasArea && !isOffScreen) ? "flex" : "none";
}

function updateIframeContent(node, elements) {
  if (elements.isEditing) return;

  const content = getNodeContent(node, elements);
  const contentHash = content ? content.length + "_" + content.slice(0, 100) : "";
  
  if (contentHash === elements.lastContentHash) return;
  elements.lastContentHash = contentHash;

  const contentType = detectContentType(content);
  const theme = computeThemeTokens();
  
  if (elements.typeLabel) {
    const typeNames = {
      html: "HTML",
      svg: "SVG",
      markdown: "Markdown",
      python: "Python",
      javascript: "JavaScript",
      css: "CSS",
      text: "Text",
    };
    elements.typeLabel.textContent = `Type: ${typeNames[contentType] || "Unknown"}`;
  }

  const LIST_SEPARATOR = "\n---LIST_SEPARATOR---\n";
  const isListContent = content && content.includes(LIST_SEPARATOR);
  
  if (elements.toggleAllBtn) {
    elements.toggleAllBtn.style.display = isListContent ? "block" : "none";
    if (isListContent) {
      const excludedWidget = node.widgets?.find(w => w.name === "excluded_indices");
      let excludedCount = 0;
      try {
        const parsed = JSON.parse(excludedWidget?.value || "{}");
        if (parsed?.excluded) excludedCount = parsed.excluded.length;
      } catch {}
      elements.toggleAllBtn.textContent = excludedCount === 0 ? "☑" : "☐";
      elements.toggleAllBtn.title = excludedCount === 0 ? "Uncheck All" : "Check All";
    }
  }

  if (!content) {
    const emptyHtml = buildIframeContent("<p style='opacity:0.5;text-align:center;margin-top:40px;'>No content. Click Edit to add content or connect a STRING input.</p>", "html", theme);
    elements.iframe.srcdoc = emptyHtml;
    return;
  }

  let excluded = [];
  const excludedWidget = node.widgets?.find(w => w.name === "excluded_indices");
  if (excludedWidget?.value) {
    try {
      const parsed = JSON.parse(excludedWidget.value);
      if (parsed && typeof parsed === "object" && parsed.hash !== undefined) {
        if (parsed.hash === contentHash) {
          excluded = Array.isArray(parsed.excluded) ? parsed.excluded : [];
        } else {
          excludedWidget.value = JSON.stringify({ hash: contentHash, excluded: [] });
        }
      } else if (Array.isArray(parsed)) {
        excluded = parsed;
        excludedWidget.value = JSON.stringify({ hash: contentHash, excluded: parsed });
      }
    } catch {
      excludedWidget.value = JSON.stringify({ hash: contentHash, excluded: [] });
    }
  } else if (excludedWidget) {
    excludedWidget.value = JSON.stringify({ hash: contentHash, excluded: [] });
  }
  const html = buildIframeContent(content, contentType, theme, excluded);
  
  const needsBlobUrl = contentType === "html" && (
    content.includes("WebAssembly") ||
    content.includes("wasm") ||
    content.includes("createUnityInstance") ||
    content.includes("ServiceWorker") ||
    content.includes("SharedArrayBuffer")
  );
  
  if (needsBlobUrl) {
    if (elements.lastBlobUrl) {
      URL.revokeObjectURL(elements.lastBlobUrl);
    }
    const blob = new Blob([html], { type: "text/html" });
    elements.lastBlobUrl = URL.createObjectURL(blob);
    elements.iframe.src = elements.lastBlobUrl;
  } else {
    if (elements.lastBlobUrl) {
      URL.revokeObjectURL(elements.lastBlobUrl);
      elements.lastBlobUrl = null;
    }
    elements.iframe.src = "";
    elements.iframe.srcdoc = html;
  }
}

window.addEventListener("message", (event) => {
  if (event.data?.type === "was-viewer-toggle") {
    const { idx, checked } = event.data;
    for (const [nodeId, elements] of STATE.nodeIdToElements.entries()) {
      if (elements.iframe?.contentWindow === event.source) {
        const node = app.graph?.getNodeById(parseInt(nodeId));
        if (node) {
          const widget = node.widgets?.find(w => w.name === "excluded_indices");
          if (widget) {
            let data = { hash: "", excluded: [] };
            try {
              const parsed = JSON.parse(widget.value || "{}");
              if (parsed && typeof parsed === "object" && parsed.hash !== undefined) {
                data = parsed;
              } else if (Array.isArray(parsed)) {
                data.excluded = parsed;
              }
            } catch {}
            if (!Array.isArray(data.excluded)) data.excluded = [];
            if (checked) {
              data.excluded = data.excluded.filter(i => i !== idx);
            } else {
              if (!data.excluded.includes(idx)) data.excluded.push(idx);
            }
            widget.value = JSON.stringify(data);
            node.setDirtyCanvas?.(true, true);
          }
        }
        break;
      }
    }
  }
});

app.registerExtension({
  name: EXT_NAME,
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_NAME) return;

    ensureCleanupRunning();

    const oldOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = oldOnNodeCreated ? oldOnNodeCreated.apply(this, arguments) : undefined;
      try {
        if (!Array.isArray(this.size) || this.size.length < 2) {
          this.size = [...DEFAULT_NODE_SIZE];
        } else {
          this.size[0] = Math.max(this.size[0] ?? 0, DEFAULT_NODE_SIZE[0]);
          this.size[1] = Math.max(this.size[1] ?? 0, DEFAULT_NODE_SIZE[1]);
        }

        let manualWidget = this.widgets?.find((w) => w.name === "manual_content");
        if (!manualWidget) {
          manualWidget = this.addWidget("text", "manual_content", "", () => {});
        }
        if (manualWidget) {
          manualWidget.type = "hidden";
          manualWidget.computeSize = () => [0, -4];
          manualWidget.serializeValue = () => manualWidget.value;
        }

        let excludedWidget = this.widgets?.find((w) => w.name === "excluded_indices");
        if (!excludedWidget) {
          excludedWidget = this.addWidget("text", "excluded_indices", "[]", () => {});
        }
        if (excludedWidget) {
          excludedWidget.type = "hidden";
          excludedWidget.computeSize = () => [0, -4];
          excludedWidget.serializeValue = () => excludedWidget.value;
        }

        for (const w of this.widgets || []) {
          if (w.name === "manual_content") continue;
          w.type = "hidden";
          w.computeSize = () => [0, -4];
        }

        this.setDirtyCanvas?.(true, true);
        
        const node = this;
        setTimeout(() => {
          try {
            const elements = ensureElementsForNode(node);
            updateElementsRect(node, elements);
            updateIframeContent(node, elements);
          } catch (e) {
            console.error("[WAS Viewer] onNodeCreated delayed init error:", e);
          }
        }, 50);
      } catch (e) {
        console.error("[WAS Viewer] onNodeCreated error:", e);
      }
      return r;
    };

    const oldOnDrawForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      const r = oldOnDrawForeground ? oldOnDrawForeground.apply(this, arguments) : undefined;
      try {
        const elements = ensureElementsForNode(this);
        updateElementsRect(this, elements);
        updateIframeContent(this, elements);
      } catch (e) {
        console.error("[WAS Viewer] onDrawForeground error:", e);
      }
      return r;
    };

    const oldOnResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      const r = oldOnResize ? oldOnResize.apply(this, arguments) : undefined;
      try {
        const elements = ensureElementsForNode(this);
        updateElementsRect(this, elements);
      } catch (e) {
        console.error("[WAS Viewer] onResize error:", e);
      }
      return r;
    };

    const oldOnConnectionsChange = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (slotType, slotIndex, isConnected, link_info) {
      const r = oldOnConnectionsChange ? oldOnConnectionsChange.apply(this, arguments) : undefined;
      try {
        const isInputSlot = slotType === 1;
        const contentInputIndex = this.inputs?.findIndex((i) => i.name === "content");
        const isContentInput = isInputSlot && contentInputIndex === slotIndex;
        
        if (isContentInput) {
          const contentWidget = this.widgets?.find((w) => w.name === "content");
          if (contentWidget) {
            contentWidget.value = "";
          }
          
          if (!isConnected) {
            setWidgetValue(this, "manual_content", "");
          }
          
          const elements = STATE.nodeIdToElements.get(String(this.id));
          if (elements) {
            elements.lastContentHash = "";
            elements.hasBackendContent = false;
            elements.hasUserEdits = false;
          }
          
          const node = this;
          const updateContent = () => {
            try {
              const el = STATE.nodeIdToElements.get(String(node.id));
              if (el) {
                el.lastContentHash = "";
                updateIframeContent(node, el);
              }
            } catch (e) {
              console.error("[WAS Viewer] onConnectionsChange delayed update error:", e);
            }
          };
          
          setTimeout(updateContent, 50);
        }
      } catch (e) {
        console.error("[WAS Viewer] onConnectionsChange error:", e);
      }
      return r;
    };

    const oldOnConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (data) {
      const r = oldOnConfigure ? oldOnConfigure.apply(this, arguments) : undefined;
      try {
        const manualWidget = this.widgets?.find((w) => w.name === "manual_content");
        if (manualWidget) {
          manualWidget.type = "hidden";
          manualWidget.computeSize = () => [0, -4];
          if (data?.widgets_values) {
            const idx = this.widgets.findIndex(w => w.name === "manual_content");
            if (idx >= 0 && data.widgets_values[idx] !== undefined) {
              manualWidget.value = data.widgets_values[idx];
            }
          }
        }
        const elements = STATE.nodeIdToElements.get(String(this.id));
        if (elements) {
          elements.lastContentHash = "";
        }
      } catch (e) {
        console.error("[WAS Viewer] onConfigure error:", e);
      }
      return r;
    };

    const oldOnExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      const r = oldOnExecuted ? oldOnExecuted.apply(this, arguments) : undefined;
      try {
        const msgStr = JSON.stringify(message);
        console.log("[WAS Viewer] onExecuted message:", msgStr?.slice(0, 256));
        const newContent = message?.text?.[0];
        console.log("[WAS Viewer] newContent length:", newContent?.length, "preview:", newContent?.slice(0, 256));
        if (newContent !== undefined && newContent !== null && newContent !== "") {
          setWidgetValue(this, "manual_content", String(newContent));
          const elements = STATE.nodeIdToElements.get(String(this.id));
          if (elements) {
            elements.hasBackendContent = true;
            elements.lastContentHash = "";
            updateIframeContent(this, elements);
          }
        } else {
          console.log("[WAS Viewer] Skipping empty content");
        }
      } catch (e) {
        console.error("[WAS Viewer] onExecuted error:", e);
      }
      return r;
    };

    const oldSerialize = nodeType.prototype.serialize;
    nodeType.prototype.serialize = function () {
      const data = oldSerialize ? oldSerialize.apply(this, arguments) : {};
      try {
        const manualWidget = this.widgets?.find((w) => w.name === "manual_content");
        if (manualWidget && manualWidget.value) {
          if (!data.widgets_values) {
            data.widgets_values = [];
          }
          const idx = this.widgets.findIndex(w => w.name === "manual_content");
          if (idx >= 0) {
            while (data.widgets_values.length <= idx) {
              data.widgets_values.push(null);
            }
            data.widgets_values[idx] = manualWidget.value;
          }
        }
      } catch (e) {
        console.error("[WAS Viewer] serialize error:", e);
      }
      return data;
    };
  },
});
