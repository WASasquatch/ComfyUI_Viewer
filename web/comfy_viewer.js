import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { 
  loadAllViews, 
  initializeViewScripts, 
  detectContentType, 
  getViewDisplayName,
  onViewsRefresh,
  handleViewMessage,
  getViewState,
  injectViewState,
  getViewScriptData,
  isMultiviewContent,
  parseMultiviewContent,
  getMultiviewContent,
  isViewUI
} from "./views/view_loader.js";
import { loadPrismScripts } from "./views/code_scripts.js";
import { computeThemeTokens, getFullTheme, themeToCssVars } from "./utils/theme.js";
import { createControlsBar, CONTROLS_HEIGHT, updateViewSelector, updateControlsForUI } from "./controls/controls_bar.js";
import { buildIframeContent, LIST_SEPARATOR } from "./iframe/iframe_builder.js";

const EXT_NAME = "WAS.ContentViewer";
const NODE_NAME = "WASComfyViewer";

const DEFAULT_NODE_SIZE = [600, 500];

const STATE = {
  container: null,
  nodeIdToElements: new Map(),
  cleanupIntervalId: null,
  cleanupListenersAttached: false,
  lastScale: 1,
  viewsInitialized: false,
  updateContainerBounds: null,
  iframeLoadQueue: [],
  iframeLoading: false,
  hangerCheckIntervalId: null,
  themeSyncAttached: false,
  lastThemeCssVars: "",
  themeUpdatePending: false,
};

function getThemeCssVars() {
  try {
    return themeToCssVars(getFullTheme());
  } catch (e) {
    return "";
  }
}

function applyThemeToElements(theme, elements) {
  if (!theme || !elements) return;

  const bindHover = (btn, onEnter, onLeave) => {
    if (!btn) return;
    btn.onmouseenter = onEnter;
    btn.onmouseleave = onLeave;
  };

  if (elements.controls) {
    elements.controls.style.background = theme.bg;
    elements.controls.style.borderBottomColor = theme.border;
  }

  if (elements.typeLabel) {
    elements.typeLabel.style.color = theme.fg;
  }

  if (elements.viewSelector) {
    elements.viewSelector.style.background = theme.bg;
    elements.viewSelector.style.color = theme.fg;
    elements.viewSelector.style.borderColor = theme.border;
  }

  if (elements.toggleAllBtn) {
    elements.toggleAllBtn.style.background = theme.bg;
    elements.toggleAllBtn.style.color = theme.fg;
    elements.toggleAllBtn.style.borderColor = theme.border;

    bindHover(
      elements.toggleAllBtn,
      () => {
        elements.toggleAllBtn.style.background = theme.accent;
        elements.toggleAllBtn.style.color = "#fff";
      },
      () => {
        elements.toggleAllBtn.style.background = theme.bg;
        elements.toggleAllBtn.style.color = theme.fg;
      }
    );
  }

  if (elements.editBtn) {
    elements.editBtn.style.background = theme.bg;
    elements.editBtn.style.color = theme.fg;
    elements.editBtn.style.borderColor = theme.border;

    bindHover(
      elements.editBtn,
      () => {
        elements.editBtn.style.background = theme.accent;
        elements.editBtn.style.color = "#fff";
      },
      () => {
        elements.editBtn.style.background = theme.bg;
        elements.editBtn.style.color = theme.fg;
      }
    );
  }

  if (elements.clearBtn) {
    elements.clearBtn.style.background = theme.bg;
    elements.clearBtn.style.color = theme.fg;
    elements.clearBtn.style.borderColor = theme.border;

    bindHover(
      elements.clearBtn,
      () => {
        elements.clearBtn.style.background = "#c44";
        elements.clearBtn.style.color = "#fff";
      },
      () => {
        elements.clearBtn.style.background = theme.bg;
        elements.clearBtn.style.color = theme.fg;
      }
    );
  }

  if (elements.fullscreenBtn) {
    elements.fullscreenBtn.style.background = theme.bg;
    elements.fullscreenBtn.style.color = theme.fg;
    elements.fullscreenBtn.style.borderColor = theme.border;

    bindHover(
      elements.fullscreenBtn,
      () => {
        elements.fullscreenBtn.style.background = theme.accent;
        elements.fullscreenBtn.style.color = "#fff";
      },
      () => {
        elements.fullscreenBtn.style.background = theme.bg;
        elements.fullscreenBtn.style.color = theme.fg;
      }
    );
  }

  if (elements.downloadBtn) {
    elements.downloadBtn.style.background = theme.bg;
    elements.downloadBtn.style.borderColor = theme.border;
    const path = elements.downloadBtn.querySelector?.("path");
    if (path) path.setAttribute("fill", theme.fg);

    const updateDownloadSvg = (color) => {
      const p = elements.downloadBtn.querySelector?.("path");
      if (p) p.setAttribute("fill", color);
    };

    bindHover(
      elements.downloadBtn,
      () => {
        elements.downloadBtn.style.background = theme.accent;
        updateDownloadSvg("#fff");
      },
      () => {
        elements.downloadBtn.style.background = theme.bg;
        updateDownloadSvg(theme.fg);
      }
    );
  }

  if (elements.wrapper) {
    elements.wrapper.style.background = theme.bg;
  }

  if (elements.iframe) {
    elements.iframe.style.background = theme.bg;
  }

  if (elements.textarea) {
    elements.textarea.style.background = theme.bg;
    elements.textarea.style.color = theme.fg;
  }

  if (elements.mutedOverlay) {
    elements.mutedOverlay.style.background = theme.bg;
  }

  if (elements.lowQualityOverlay) {
    elements.lowQualityOverlay.style.background = theme.bg;
  }
}

function broadcastThemeUpdate() {
  const cssVars = getThemeCssVars();
  if (!cssVars || cssVars === STATE.lastThemeCssVars) return;
  STATE.lastThemeCssVars = cssVars;

  const themeTokens = computeThemeTokens();

  for (const elements of STATE.nodeIdToElements.values()) {
    try {
      applyThemeToElements(themeTokens, elements);
      elements?.iframe?.contentWindow?.postMessage({
        type: "was-theme-update",
        cssVars,
      }, "*");
    } catch (e) {}
  }
}

function scheduleThemeUpdate() {
  if (STATE.themeUpdatePending) return;
  STATE.themeUpdatePending = true;
  window.requestAnimationFrame(() => {
    STATE.themeUpdatePending = false;
    broadcastThemeUpdate();
  });
}

function ensureThemeSyncRunning() {
  if (STATE.themeSyncAttached) return;
  STATE.themeSyncAttached = true;

  // Initialize baseline
  STATE.lastThemeCssVars = getThemeCssVars();

  const onThemeMaybeChanged = () => scheduleThemeUpdate();

  // Observe attribute changes; ComfyUI theme switching often toggles classes/attributes
  try {
    const observer = new MutationObserver(onThemeMaybeChanged);
    if (document.documentElement) {
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "style", "data-theme", "data-color-scheme"],
      });
    }
    if (document.body) {
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["class", "style", "data-theme", "data-color-scheme"],
      });
    }
  } catch (e) {}

  // Fallback: periodic check (covers cases where theme changes via stylesheet updates without attribute mutation)
  window.setInterval(() => {
    try {
      const cssVars = getThemeCssVars();
      if (cssVars && cssVars !== STATE.lastThemeCssVars) {
        scheduleThemeUpdate();
      }
    } catch (e) {}
  }, 1500);

  // Also update on focus/visibility (covers theme change while tab is backgrounded)
  window.addEventListener("focus", onThemeMaybeChanged);
  window.addEventListener("visibilitychange", onThemeMaybeChanged);
}

function getBasePath() {
  return import.meta.url.substring(0, import.meta.url.lastIndexOf("/"));
}

async function initializeViews() {
  if (STATE.viewsInitialized) return;
  
  const basePath = getBasePath();
  
  await loadAllViews();
  
  await Promise.all([
    initializeViewScripts(basePath),
    loadPrismScripts(basePath),
  ]);
  
  STATE.viewsInitialized = true;
}

initializeViews();

ensureThemeSyncRunning();

onViewsRefresh(() => {
  refreshAllViewers();
});

function refreshAllViewers() {
  for (const [nodeId, elements] of STATE.nodeIdToElements.entries()) {
    if (elements && elements.lastContentHash) {
      elements.lastContentHash = "";
      const node = app?.graph?.getNodeById(parseInt(nodeId));
      if (node) {
        try {
          updateIframeContent(node, elements);
        } catch (e) {}
      }
    }
  }

  // Also push current theme to any existing iframes.
  try {
    broadcastThemeUpdate();
  } catch (e) {}
}

function getActiveGraphNodes() {
  const g = app?.graph || app?.canvas?.graph;
  const nodes = g?._nodes || g?.nodes;
  return Array.isArray(nodes) ? nodes : [];
}

function isViewerNode(node) {
  try {
    const nodeType = node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type;
    return nodeType === NODE_NAME;
  } catch (e) {
    console.error("[WAS Viewer] isViewerNode error:", e);
    return false;
  }
}

/**
 * Check if node is muted or bypassed
 * LiteGraph modes: 0=ALWAYS, 1=ON_EVENT, 2=NEVER (muted), 3=ON_TRIGGER, 4=bypassed
 */
function isNodeDisabled(node) {
  return node?.mode === 2 || node?.mode === 4;
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

function checkForHangers() {
  const canvas = app.canvas;
  const canvasEl = canvas?.canvas;
  if (!canvasEl) return;

  const canvasRect = canvasEl.getBoundingClientRect();
  const ds = canvas.ds;
  const scale = ds?.scale ?? 1;
  const offset = ds?.offset ?? [0, 0];

  for (const [nodeId, elements] of STATE.nodeIdToElements.entries()) {
    if (!elements?.wrapper) continue;
    
    const node = app?.graph?.getNodeById(parseInt(nodeId));
    if (!node) {
      elements.wrapper.style.display = "none";
      continue;
    }

    const titleH = node?.title_height ?? 30;
    const margin = 10;
    const expectedScreenX = (node.pos[0] + margin + offset[0]) * scale + canvasRect.left;
    const expectedScreenY = (node.pos[1] + margin + titleH + offset[1]) * scale + canvasRect.top;
    const scaledW = (node.size[0] - margin * 2) * scale;
    const scaledH = (node.size[1] - titleH - margin * 2) * scale;

    const isOffScreen = 
      (expectedScreenX + scaledW < canvasRect.left) ||
      (expectedScreenX > canvasRect.right) ||
      (expectedScreenY + scaledH < canvasRect.top) ||
      (expectedScreenY > canvasRect.bottom);

    if (isOffScreen) {
      elements.wrapper.style.display = "none";
    }
  }
}

function startHangerCheck() {
  if (STATE.hangerCheckIntervalId != null) return;
  STATE.hangerCheckIntervalId = window.setInterval(() => checkForHangers(), 100);
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
    clip-path: inset(0);
  `;
  canvasParent.appendChild(el);
  STATE.container = el;
  
  function updateContainerBounds() {
    if (!canvasEl || !el) return;
    const rect = canvasEl.getBoundingClientRect();
    const parentRect = canvasParent.getBoundingClientRect();
    const left = rect.left - parentRect.left;
    const top = rect.top - parentRect.top;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height}px`;
  }
  
  updateContainerBounds();
  STATE.updateContainerBounds = updateContainerBounds;
  
  const resizeObserver = new ResizeObserver(updateContainerBounds);
  resizeObserver.observe(canvasEl);
  
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
  
  if (manualContent) {
    return manualContent;
  }
  
  const connectedContent = getConnectedContent(node);
  if (connectedContent) {
    return connectedContent;
  }
  
  return "";
}

function ensureElementsForNode(node) {
  ensureCleanupRunning();

  const key = String(node.id);
  const existing = STATE.nodeIdToElements.get(key);
  if (existing) return existing;

  const container = getContainer();
  if (!container) return null;

  const theme = computeThemeTokens();

  const wrapper = document.createElement("div");
  wrapper.style.cssText = `
    position: fixed;
    display: flex;
    flex-direction: column;
    pointer-events: none;
    transform-origin: 0 0;
    background: ${theme.bg};
    border-radius: 0 0 8px 8px;
    overflow: hidden;
    z-index: 10;
  `;

  const elements = {
    wrapper,
    contentWrapper: null,
    controls: null,
    iframe: null,
    textarea: null,
    typeLabel: null,
    toggleAllBtn: null,
    lastContentHash: "",
    isEditing: false,
    listEditContainer: null,
    listTextareas: null,
    mutedOverlay: null,
    lowQualityOverlay: null,
    isMuted: false,
  };

  const controls = createControlsBar(node, elements, {
    getNodeContent,
    setWidgetValue,
    updateIframeContent,
    buildIframeContent,
    app,
    onViewChange: handleViewChange,
  });
  wrapper.appendChild(controls);
  elements.controls = controls;

  const contentWrapper = document.createElement("div");
  contentWrapper.style.cssText = `
    position: relative;
    flex: 1;
    overflow: hidden;
    border-radius: 0 0 8px 8px;
    pointer-events: auto;
  `;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-modals allow-pointer-lock allow-downloads");
  iframe.setAttribute("allow", "fullscreen");
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

  const mutedOverlay = document.createElement("div");
  mutedOverlay.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: ${theme.bg};
    display: none;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 8px;
    border-radius: 0 0 8px 8px;
    pointer-events: auto;
  `;
  mutedOverlay.innerHTML = `
    <span style="font-size: 32px; opacity: 0.3;">🔇</span>
    <span style="font-size: 12px; opacity: 0.5; font-family: sans-serif;">Node is muted/bypassed</span>
    <span style="font-size: 10px; opacity: 0.3; font-family: sans-serif;">Unmute to load content</span>
  `;
  contentWrapper.appendChild(mutedOverlay);
  elements.mutedOverlay = mutedOverlay;

  const lowQualityOverlay = document.createElement("div");
  lowQualityOverlay.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: ${theme.bg};
    display: none;
    align-items: center;
    justify-content: center;
    border-radius: 0 0 8px 8px;
    pointer-events: auto;
  `;
  contentWrapper.appendChild(lowQualityOverlay);
  elements.lowQualityOverlay = lowQualityOverlay;

  wrapper.appendChild(contentWrapper);
  elements.contentWrapper = contentWrapper;

  document.body.appendChild(wrapper);
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
  if (!canvasEl || !elements?.wrapper) return;

  const ds = canvas.ds;
  const scale = ds?.scale ?? 1;
  const offset = ds?.offset ?? [0, 0];

  let isNodeVisible = true;
  if (typeof canvas.isNodeVisible === 'function') {
    isNodeVisible = canvas.isNodeVisible(node);
  } else if (canvas.visible_area && node.size) {
    const va = canvas.visible_area;
    const nodeRight = node.pos[0] + node.size[0];
    const nodeBottom = node.pos[1] + node.size[1];
    isNodeVisible = !(
      nodeRight < va[0] ||
      node.pos[0] > va[0] + va[2] ||
      nodeBottom < va[1] ||
      node.pos[1] > va[1] + va[3]
    );
  }
  const isCollapsed = !!node.flags?.collapsed;
  
  if (!isNodeVisible || isCollapsed) {
    elements.wrapper.style.display = "none";
    return;
  }
  
  // Check for low quality rendering mode (zoomed out past threshold)
  const isLowQuality = canvas.low_quality === true;
  if (elements.lowQualityOverlay) {
    if (isLowQuality) {
      elements.iframe.style.display = "none";
      elements.lowQualityOverlay.style.display = "flex";
    } else {
      elements.iframe.style.display = "block";
      elements.lowQualityOverlay.style.display = "none";
    }
  }

  const canvasRect = canvasEl.getBoundingClientRect();
  
  const titleHRaw =
    (typeof node?.title_height === "number" && Number.isFinite(node.title_height) && node.title_height) ||
    (typeof node?.constructor?.title_height === "number" &&
      Number.isFinite(node.constructor.title_height) &&
      node.constructor.title_height) ||
    globalThis?.LiteGraph?.NODE_TITLE_HEIGHT ||
    30;
  
  const margin = 10;
  const widgetX = node.pos[0] + margin;
  const widgetY = node.pos[1] + margin + titleHRaw;
  const screenX = (widgetX + offset[0]) * scale + canvasRect.left;
  const screenY = (widgetY + offset[1]) * scale + canvasRect.top;
  const widgetW = node.size[0] - margin * 2;
  const widgetH = node.size[1] - titleHRaw - margin * 2;

  const nw = Math.max(0, Math.round(widgetW));
  const nh = Math.max(0, Math.round(widgetH));
  const hasArea = nw >= 2 && nh >= 2;

  if (!hasArea) {
    elements.wrapper.style.display = "none";
    return;
  }

  elements.wrapper.style.position = 'fixed';
  elements.wrapper.style.left = `${screenX}px`;
  elements.wrapper.style.top = `${screenY}px`;
  elements.wrapper.style.width = `${nw}px`;
  elements.wrapper.style.height = `${nh}px`;
  elements.wrapper.style.transform = `scale(${scale})`;
  elements.wrapper.style.transformOrigin = '0 0';
  elements.wrapper.style.display = "flex";
}

function processIframeQueue() {
  if (STATE.iframeLoading || STATE.iframeLoadQueue.length === 0) return;
  
  STATE.iframeLoading = true;
  const { elements, html, needsBlobUrl, scriptData } = STATE.iframeLoadQueue.shift();
  
  if (!elements?.iframe) {
    STATE.iframeLoading = false;
    processIframeQueue();
    return;
  }
  
  const onLoad = () => {
    elements.iframe.removeEventListener("load", onLoad);
    
    if (scriptData && scriptData.length > 0) {
      try {
        elements.iframe.contentWindow.postMessage({
          type: 'was-inject-scripts',
          scripts: scriptData
        }, '*');
      } catch (e) {
        console.error('[WAS Viewer] Failed to inject scripts:', e);
      }
    }
    
    STATE.iframeLoading = false;
    setTimeout(processIframeQueue, 150);
  };
  
  elements.iframe.addEventListener("load", onLoad);
  
  setTimeout(() => {
    if (STATE.iframeLoading) {
      STATE.iframeLoading = false;
      processIframeQueue();
    }
  }, 3000);
  
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

function updateIframeContent(node, elements, forceView = null) {
  if (elements.isEditing) return;

  const content = getNodeContent(node, elements);
  const contentHash = content ? content.length + "_" + content.slice(0, 100) : "";
  if (contentHash === elements.lastContentHash && !forceView) return;
  elements.lastContentHash = contentHash;

  const theme = computeThemeTokens();
  let displayContent = content;
  let contentType;
  let currentView = forceView || elements.currentView;
  
  if (isMultiviewContent(content)) {
    const multiview = parseMultiviewContent(content);
    if (multiview) {
      if (!currentView || !multiview.views.find(v => v.name === currentView)) {
        currentView = multiview.defaultView;
      }
      
      const viewData = multiview.views.find(v => v.name === currentView);
      if (viewData) {
        displayContent = viewData.displayContent;
      }
      
      elements.currentView = currentView;
      elements.multiviewContent = content;
      updateViewSelector(elements.viewSelector, content, currentView);
      contentType = detectContentType(displayContent);
    } else {
      contentType = detectContentType(content);
    }
  } else {
    contentType = detectContentType(content);
    elements.currentView = null;
    elements.multiviewContent = null;
    if (elements.viewSelector) {
      elements.viewSelector.style.display = "none";
    }
  }
  
  if (elements.typeLabel) {
    elements.typeLabel.textContent = `Type: ${getViewDisplayName(contentType)}`;
  }
  
  updateControlsForUI(elements, isViewUI(contentType));

  const LIST_SEPARATOR = "\n---LIST_SEPARATOR---\n";
  const isListContent = displayContent && displayContent.includes(LIST_SEPARATOR);
  
  let excluded = [];
  
  const metaWidget = node.widgets?.find(w => w.name === "viewer_meta");
  if (metaWidget?.value) {
    try {
      const meta = JSON.parse(metaWidget.value);
      excluded = Array.isArray(meta.excluded) ? meta.excluded : [];
    } catch {}
  }
  
  if (elements.toggleAllBtn) {
    elements.toggleAllBtn.style.display = isListContent ? "block" : "none";
    if (isListContent) {
      elements.toggleAllBtn.textContent = excluded.length === 0 ? "☑" : "☐";
      elements.toggleAllBtn.title = excluded.length === 0 ? "Uncheck All" : "Check All";
    }
  }

  const savedViewState = getViewState(contentType, node);
  const finalContent = injectViewState(contentType, displayContent, savedViewState);

  let html;
  const nodeId = String(node.id);
  if (!displayContent) {
    html = buildIframeContent("<p style='opacity:0.5;text-align:center;margin-top:40px;'>No content. Click Edit to add content or connect a STRING input.</p>", "html", theme, [], nodeId);
  } else {
    html = buildIframeContent(finalContent, contentType, theme, excluded, nodeId);
  }
  
  const needsBlobUrl = displayContent && contentType === "html" && (
    displayContent.includes("WebAssembly") ||
    displayContent.includes("wasm") ||
    displayContent.includes("createUnityInstance") ||
    displayContent.includes("ServiceWorker") ||
    displayContent.includes("SharedArrayBuffer")
  );
  
  const scriptData = displayContent ? getViewScriptData(contentType, finalContent) : [];
  
  STATE.iframeLoadQueue = STATE.iframeLoadQueue.filter(item => item.elements !== elements);
  STATE.iframeLoadQueue.push({ elements, html, needsBlobUrl, scriptData });
  processIframeQueue();
}

/**
 * Handle view change from dropdown selector
 * @param {object} node - ComfyUI node
 * @param {object} elements - DOM elements container
 * @param {string} viewName - Name of view to switch to
 */
function handleViewChange(node, elements, viewName) {
  if (!elements.multiviewContent) return;
  elements.lastContentHash = "";
  updateIframeContent(node, elements, viewName);
}

window.addEventListener("message", (event) => {
  if (event.data?.type === "was-viewer-toggle") {
    const { idx, checked, nodeId } = event.data;
    
    if (!nodeId) {
      return;
    }
    
    const node = app.graph?.getNodeById(parseInt(nodeId));
    if (node) {
      const metaWidget = node.widgets?.find(w => w.name === "viewer_meta");
      if (metaWidget) {
        let meta = { lastInputHash: "", excluded: [] };
        try {
          meta = JSON.parse(metaWidget.value || "{}");
          if (!Array.isArray(meta.excluded)) meta.excluded = [];
        } catch {}
        if (checked) {
          meta.excluded = meta.excluded.filter(i => i !== idx);
        } else {
          if (!meta.excluded.includes(idx)) meta.excluded.push(idx);
        }
        metaWidget.value = JSON.stringify(meta);
        node.setDirtyCanvas?.(true, true);
      }
    }
  } else {
    const messageType = event.data?.type;
    const nodeId = event.data?.nodeId;
    
    if (messageType && !nodeId) {
      for (const [nId, elements] of STATE.nodeIdToElements.entries()) {
        if (elements.iframe && elements.iframe.contentWindow === event.source) {
          const node = app.graph?.getNodeById(parseInt(nId));
          if (node) {
            handleViewMessage(messageType, event.data, node, app, event.source);
          }
          break;
        }
      }
    } else if (messageType && nodeId) {
      const node = app.graph?.getNodeById(parseInt(nodeId));
      if (node) {
        handleViewMessage(messageType, event.data, node, app, event.source);
      }
    }
  }
});

app.registerExtension({
  name: EXT_NAME,
  
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_NAME) return;

    ensureCleanupRunning();
    startHangerCheck();

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

        let metaWidget = this.widgets?.find((w) => w.name === "viewer_meta");
        if (!metaWidget) {
          metaWidget = this.addWidget("text", "viewer_meta", JSON.stringify({ lastInputHash: "", excluded: [] }), () => {});
        }
        if (metaWidget) {
          metaWidget.type = "hidden";
          metaWidget.computeSize = () => [0, -4];
          metaWidget.serializeValue = () => metaWidget.value;
        }

        let viewStateWidget = this.widgets?.find((w) => w.name === "view_state");
        if (!viewStateWidget) {
          viewStateWidget = this.addWidget("text", "view_state", "{}", () => {});
        }
        if (viewStateWidget) {
          viewStateWidget.type = "hidden";
          viewStateWidget.computeSize = () => [0, -4];
          viewStateWidget.serializeValue = () => viewStateWidget.value;
        }

        for (const w of this.widgets || []) {
          w.type = "hidden";
          w.computeSize = () => [0, -4];
          w.draw = () => {};
        }

        this.setDirtyCanvas?.(true, true);
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
        if (elements) {
          updateElementsRect(this, elements);
          if (!elements.lastContentHash) {
            updateIframeContent(this, elements);
          }
        }
      } catch (e) {
        console.error("[WAS Viewer] onDrawForeground error:", e);
      }
      return r;
    };

    const oldOnResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      const r = oldOnResize ? oldOnResize.apply(this, arguments) : undefined;
      try {
        const elements = STATE.nodeIdToElements.get(String(this.id));
        if (elements) {
          updateElementsRect(this, elements);
        }
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
        const imagesInputIndex = this.inputs?.findIndex((i) => i.name === "images");
        const isRelevantInput = isInputSlot && (contentInputIndex === slotIndex || imagesInputIndex === slotIndex);
        
        if (isRelevantInput) {
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
        
        const viewStateWidget = this.widgets?.find((w) => w.name === "view_state");
        if (viewStateWidget) {
          viewStateWidget.type = "hidden";
          viewStateWidget.computeSize = () => [0, -4];
          if (data?.widgets_values) {
            const idx = this.widgets.findIndex(w => w.name === "view_state");
            if (idx >= 0 && data.widgets_values[idx] !== undefined) {
              viewStateWidget.value = data.widgets_values[idx];
            }
          }
        }
        
        const node = this;
        setTimeout(() => {
          try {
            const elements = STATE.nodeIdToElements.get(String(node.id));
            if (elements) {
              elements.lastContentHash = "";
              updateIframeContent(node, elements);
            }
          } catch (e) {
            console.error("[WAS Viewer] onConfigure delayed update error:", e);
          }
        }, 100);
      } catch (e) {
        console.error("[WAS Viewer] onConfigure error:", e);
      }
      return r;
    };

    const oldOnExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      const r = oldOnExecuted ? oldOnExecuted.apply(this, arguments) : undefined;
      try {
        const displayText = message?.text?.[0];
        const sourceContent = message?.source_content?.[0] || "";
        const sourceContentHash = message?.content_hash?.[0] || "";
        const inputHash = message?.input_hash?.[0] || "";
        
        const viewStateWidget = this.widgets?.find(w => w.name === "view_state");
        
        // Check if input changed and clear stale _output if so
        let inputChanged = false;
        if (inputHash && viewStateWidget) {
          try {
            const viewState = JSON.parse(viewStateWidget.value || "{}");
            const storedHash = viewState._input_hash || "";
            if (storedHash && storedHash !== inputHash) {
              inputChanged = true;
              for (const key of Object.keys(viewState)) {
                if (key.endsWith("_output")) {
                  delete viewState[key];
                }
              }
              console.log("[WAS Viewer] Input changed, cleared stale view outputs");
            }
            viewState._input_hash = inputHash;
            viewStateWidget.value = JSON.stringify(viewState);
          } catch {}
        }
        
        let hasViewOutput = false;
        if (viewStateWidget?.value && !inputChanged) {
          try {
            const viewState = JSON.parse(viewStateWidget.value);
            hasViewOutput = Object.keys(viewState).some(k => k.endsWith("_output") && viewState[k]);
            
            if (hasViewOutput) {
              let modified = false;
              for (const key of Object.keys(viewState)) {
                if (key.endsWith("_output") && viewState[key]) {
                  const valLen = typeof viewState[key] === "string" ? viewState[key].length : JSON.stringify(viewState[key]).length;
                  if (valLen > 10000) {
                    delete viewState[key];
                    modified = true;
                  }
                }
              }
              if (modified) {
                viewStateWidget.value = JSON.stringify(viewState);
                console.log("[WAS Viewer] Cleared large output data from view_state after execution.");
              }
            }
          } catch {}
        }
        
        if (hasViewOutput) {
          return r;
        }
        
        const metaWidget = this.widgets?.find(w => w.name === "viewer_meta");
        let meta = { lastInputHash: "", excluded: [] };
        try {
          meta = JSON.parse(metaWidget?.value || "{}");
          if (!meta.lastInputHash) meta.lastInputHash = "";
          if (!Array.isArray(meta.excluded)) meta.excluded = [];
        } catch {}
        
        if (sourceContentHash && meta.lastInputHash === sourceContentHash) {
          return r;
        }
        
        if (sourceContent) {
          meta.lastInputHash = sourceContentHash;
          meta.excluded = [];
          if (metaWidget) {
            metaWidget.value = JSON.stringify(meta);
          }
          
          setWidgetValue(this, "manual_content", sourceContent);
          const elements = STATE.nodeIdToElements.get(String(this.id));
          if (elements) {
            elements.lastContentHash = "";
            updateIframeContent(this, elements);
          }
        } else if (displayText !== undefined && displayText !== null && displayText !== "") {
          setWidgetValue(this, "manual_content", String(displayText));
          const elements = STATE.nodeIdToElements.get(String(this.id));
          if (elements) {
            elements.lastContentHash = "";
            updateIframeContent(this, elements);
          }
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
        if (!data.widgets_values) {
          data.widgets_values = [];
        }
        
        const manualWidget = this.widgets?.find((w) => w.name === "manual_content");
        if (manualWidget) {
          const idx = this.widgets.findIndex(w => w.name === "manual_content");
          if (idx >= 0) {
            while (data.widgets_values.length <= idx) {
              data.widgets_values.push(null);
            }
            data.widgets_values[idx] = manualWidget.value || "";
          }
        }
        
        const viewStateWidget = this.widgets?.find((w) => w.name === "view_state");
        if (viewStateWidget) {
          const idx = this.widgets.findIndex(w => w.name === "view_state");
          if (idx >= 0) {
            while (data.widgets_values.length <= idx) {
              data.widgets_values.push(null);
            }

            let viewStateValue = "{}";
            try {
              const vs = JSON.parse(viewStateWidget.value || "{}");
              for (const key of Object.keys(vs)) {
                if (key.endsWith("_output") && vs[key]) {
                  const valLen = typeof vs[key] === "string" ? vs[key].length : JSON.stringify(vs[key]).length;
                  if (valLen > 10000) {
                    delete vs[key];
                  }
                }
              }
              viewStateValue = JSON.stringify(vs);
            } catch {
              viewStateValue = viewStateWidget.value || "{}";
            }
            data.widgets_values[idx] = viewStateValue;
          }
        }
      } catch (e) {
        console.error("[WAS Viewer] serialize error:", e);
      }
      return data;
    };
  },
});
