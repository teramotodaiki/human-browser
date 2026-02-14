const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30000;
const DAEMON_ALLOWED_PROTOCOL = 'ws:';
const DAEMON_ALLOWED_HOST = '127.0.0.1';
const DAEMON_ALLOWED_PATH = '/bridge';
const MAX_MONITOR_EVENTS = 1000;

const ACTION_ICON_PATHS = {
  connected: {
    16: 'icons/connected-16.png',
    32: 'icons/connected-32.png',
    48: 'icons/connected-48.png',
    128: 'icons/connected-128.png',
  },
  disconnected: {
    16: 'icons/disconnected-16.png',
    32: 'icons/disconnected-32.png',
    48: 'icons/disconnected-48.png',
    128: 'icons/disconnected-128.png',
  },
};

const state = {
  socket: null,
  daemon: {
    wsUrl: '',
    token: '',
    connected: false,
    lastPingAt: null,
    retryCount: 0,
    reconnectTimer: null,
    lastDisconnectReason: null,
  },
  target: {
    tabId: null,
    attached: false,
  },
  monitor: {
    network: {
      enabled: false,
      events: [],
      byRequestId: {},
    },
    console: {
      enabled: false,
      events: [],
    },
  },
  lastError: null,
};

const SNAPSHOT_SCRIPT = `(input) => {
  const MAX_NODES = 300;
  const INTERACTIVE_ROLES = new Set([
    'button',
    'link',
    'textbox',
    'checkbox',
    'radio',
    'combobox',
    'listbox',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'option',
    'searchbox',
    'slider',
    'spinbutton',
    'switch',
    'tab',
    'treeitem',
  ]);
  const CONTENT_ROLES = new Set([
    'heading',
    'paragraph',
    'listitem',
    'article',
    'main',
    'navigation',
    'region',
    'cell',
    'gridcell',
    'columnheader',
    'rowheader',
    'label',
  ]);
  const STRUCTURAL_ROLES = new Set([
    'generic',
    'group',
    'list',
    'table',
    'row',
    'rowgroup',
    'grid',
    'menu',
    'toolbar',
    'tablist',
    'tree',
    'document',
    'application',
    'presentation',
    'none',
    'form',
    'banner',
    'complementary',
    'contentinfo',
  ]);

  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
  const interactiveOnly = Boolean(input?.interactive);
  const includeCursor = Boolean(input?.cursor);
  const compact = Boolean(input?.compact);
  const rawDepth = Number(input?.depth);
  const maxDepth = Number.isInteger(rawDepth) && rawDepth >= 0 ? rawDepth : null;
  const selectorScope = typeof input?.selector === 'string' ? input.selector.trim() : '';
  const root = selectorScope ? document.querySelector(selectorScope) : document.body;

  if (!(root instanceof Element)) {
    return [];
  }

  const isVisible = (el) => {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const ownText = (el) => {
    const chunks = [];
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const value = normalize(node.textContent || '');
      if (value) chunks.push(value);
    }
    return normalize(chunks.join(' '));
  };

  const labelledByText = (el) => {
    const labelledBy = el.getAttribute('aria-labelledby');
    if (!labelledBy) return '';

    const ids = labelledBy
      .split(/\\s+/)
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    const parts = [];
    for (const id of ids) {
      const node = document.getElementById(id);
      if (!node) continue;
      const value = normalize(node.textContent || '');
      if (value) parts.push(value);
    }

    return normalize(parts.join(' '));
  };

  const inputType = (el) => (el.getAttribute('type') || 'text').toLowerCase();

  const toRole = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.toLowerCase();

    const tag = el.tagName.toLowerCase();
    if (tag === 'a' && el.getAttribute('href')) return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (tag === 'summary') return 'button';
    if (tag === 'label') return 'label';
    if (tag === 'p') return 'paragraph';
    if (tag === 'li') return 'listitem';
    if (tag === 'main') return 'main';
    if (tag === 'nav') return 'navigation';
    if (tag === 'section') return 'region';
    if (tag === 'article') return 'article';
    if (tag === 'table') return 'table';
    if (tag === 'tr') return 'row';
    if (tag === 'th') return 'columnheader';
    if (tag === 'td') return 'cell';
    if (tag === 'ul' || tag === 'ol') return 'list';
    if (tag === 'form') return 'form';
    if (tag === 'header') return 'banner';
    if (tag === 'aside') return 'complementary';
    if (tag === 'footer') return 'contentinfo';
    if (/^h[1-6]$/.test(tag)) return 'heading';

    if (tag === 'input') {
      const type = inputType(el);
      if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      return 'textbox';
    }

    return 'generic';
  };

  const toName = (el, role) => {
    const aria = normalize(el.getAttribute('aria-label'));
    if (aria) return aria.slice(0, 120);

    const ariaLabelledBy = labelledByText(el);
    if (ariaLabelledBy) return ariaLabelledBy.slice(0, 120);

    if (el instanceof HTMLInputElement) {
      const type = inputType(el);
      if (type === 'password') {
        return '';
      }
      if ((type === 'button' || type === 'submit' || type === 'reset') && normalize(el.value)) {
        return normalize(el.value).slice(0, 120);
      }
      if (normalize(el.placeholder)) {
        return normalize(el.placeholder).slice(0, 120);
      }
      return '';
    }

    if (el instanceof HTMLTextAreaElement) {
      if (normalize(el.placeholder)) {
        return normalize(el.placeholder).slice(0, 120);
      }
      return '';
    }

    if (el instanceof HTMLSelectElement) {
      const selected = el.selectedOptions?.[0];
      const label = normalize(selected?.textContent || '');
      return label.slice(0, 120);
    }

    const own = ownText(el);
    if (own) {
      return own.slice(0, 120);
    }

    if (CONTENT_ROLES.has(role)) {
      const full = normalize(el.textContent || '');
      if (full) return full.slice(0, 120);
    }

    return '';
  };

  const isInteractive = (el, role) => {
    if (INTERACTIVE_ROLES.has(role)) return true;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a' && el.getAttribute('href')) return true;
    if (tag === 'button' || tag === 'select' || tag === 'textarea') return true;
    if (tag === 'input') return true;
    if (el.getAttribute('contenteditable') === 'true') return true;
    const tabIndex = el.getAttribute('tabindex');
    return tabIndex !== null && tabIndex !== '-1';
  };

  const cursorHints = (el) => {
    if (!includeCursor) return [];
    const hints = [];
    const style = getComputedStyle(el);
    if (style.cursor === 'pointer') hints.push('cursor:pointer');
    if (el.hasAttribute('onclick') || el.onclick !== null) hints.push('onclick');
    const tabIndex = el.getAttribute('tabindex');
    if (tabIndex !== null && tabIndex !== '-1') hints.push('tabindex');
    return hints;
  };

  const cssPath = (el) => {
    if (el.id) {
      return '#' + CSS.escape(el.id);
    }

    const segments = [];
    let current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (!parent) break;

      const siblings = Array.from(parent.children).filter((entry) => entry.tagName === current.tagName);
      const index = siblings.indexOf(current) + 1;
      segments.unshift(tag + ':nth-of-type(' + index + ')');
      current = parent;
    }

    return 'body > ' + segments.join(' > ');
  };

  const shouldInclude = (role, name, interactive, hints) => {
    if (interactiveOnly) {
      return interactive || hints.length > 0;
    }
    if (interactive || hints.length > 0) {
      return true;
    }
    if (CONTENT_ROLES.has(role)) {
      return name.length > 0;
    }
    if (compact) {
      return false;
    }
    if (STRUCTURAL_ROLES.has(role)) {
      return name.length > 0;
    }
    return name.length > 0;
  };

  const seen = new Set();
  const nodes = [];
  const queue = [{ el: root, depth: 0 }];

  while (queue.length > 0 && nodes.length < MAX_NODES) {
    const current = queue.shift();
    if (!current) break;
    const { el, depth } = current;
    if (!(el instanceof Element)) continue;
    if (maxDepth !== null && depth > maxDepth) continue;
    if (!isVisible(el)) continue;

    const role = toRole(el);
    const name = toName(el, role);
    const hints = cursorHints(el);
    const interactive = isInteractive(el, role);
    if (shouldInclude(role, name, interactive, hints)) {
      const selector = cssPath(el);
      if (!seen.has(selector)) {
        seen.add(selector);
        nodes.push({
          role,
          name,
          selector,
          suffix: hints.length > 0 ? '[' + hints.join(', ') + ']' : '',
        });
      }
    }

    if (maxDepth !== null && depth >= maxDepth) {
      continue;
    }

    for (const child of el.children) {
      queue.push({ el: child, depth: depth + 1 });
    }
  }

  if (!interactiveOnly && nodes.length < MAX_NODES) {
    const capturedNames = new Set(
      nodes
        .map((node) => normalize(node.name))
        .filter((value) => value.length > 0),
    );
    const textKeys = new Set();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (nodes.length < MAX_NODES) {
      const textNode = walker.nextNode();
      if (!textNode) break;
      const parent = textNode.parentElement;
      if (!(parent instanceof Element)) continue;
      if (!isVisible(parent)) continue;

      const tagName = parent.tagName.toLowerCase();
      if (tagName === 'script' || tagName === 'style' || tagName === 'noscript') continue;

      const text = normalize(textNode.textContent || '');
      if (text.length < 2) continue;
      if (capturedNames.has(text)) continue;

      const selector = cssPath(parent);
      const key = selector + '::' + text;
      if (textKeys.has(key)) continue;
      textKeys.add(key);

      nodes.push({
        role: 'text',
        name: text.slice(0, 120),
        selector,
        suffix: '[text]',
      });
    }
  }

  return nodes;
}`;

const CLICK_SCRIPT = `(input) => {
  const el = document.querySelector(input.selector);
  if (!el) {
    return {
      ok: false,
      error: {
        code: 'NO_MATCH',
        message: 'Element not found for selector',
        details: { selector: input.selector },
      },
    };
  }

  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  if (typeof el.click === 'function') {
    el.click();
  } else {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    el.dispatchEvent(event);
  }

  return {
    ok: true,
  };
}`;

const FILL_SCRIPT = `(input) => {
  const el = document.querySelector(input.selector);
  if (!el) {
    return {
      ok: false,
      error: {
        code: 'NO_MATCH',
        message: 'Element not found for selector',
        details: { selector: input.selector },
      },
    };
  }

  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
    return {
      ok: false,
      error: {
        code: 'NOT_FILLABLE',
        message: 'Element is not fillable',
        details: { selector: input.selector },
      },
    };
  }

  el.focus();
  el.value = input.value;

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));

  return {
    ok: true,
  };
}`;

const KEYPRESS_SCRIPT = `(input) => {
  const target = document.activeElement || document.body;
  const key = input.key;

  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));

  return {
    ok: true,
    active_tag: target.tagName,
  };
}`;

const SCROLL_SCRIPT = `(input) => {
  window.scrollBy({ left: input.x, top: input.y, behavior: 'instant' });
  return {
    ok: true,
    x: window.scrollX,
    y: window.scrollY,
  };
}`;

const NAVIGATE_SCRIPT = `(input) => {
  window.location.assign(input.url);
  return {
    ok: true,
  };
}`;

const HOVER_POINT_SCRIPT = `(input) => {
  const el = document.querySelector(input.selector);
  if (!el) {
    return {
      ok: false,
      error: {
        code: 'NO_MATCH',
        message: 'Element not found for selector',
        details: { selector: input.selector },
      },
    };
  }

  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return {
      ok: false,
      error: {
        code: 'NOT_VISIBLE',
        message: 'Element is not visible',
        details: { selector: input.selector },
      },
    };
  }

  return {
    ok: true,
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}`;

const TEXT_SCRIPT = `(input) => {
  const el = document.querySelector(input.selector);
  if (!el) {
    return {
      ok: false,
      error: {
        code: 'NO_MATCH',
        message: 'Element not found for selector',
        details: { selector: input.selector },
      },
    };
  }

  return {
    ok: true,
    text: (el.textContent || '').trim(),
  };
}`;

const HTML_SCRIPT = `(input) => {
  if (!input.selector) {
    return {
      ok: true,
      html: document.documentElement.outerHTML,
    };
  }

  const el = document.querySelector(input.selector);
  if (!el) {
    return {
      ok: false,
      error: {
        code: 'NO_MATCH',
        message: 'Element not found for selector',
        details: { selector: input.selector },
      },
    };
  }

  return {
    ok: true,
    html: el.innerHTML,
  };
}`;

const WAIT_SCRIPT = `(input) => {
  const timeoutMs = Number.isFinite(input.timeout_ms) && input.timeout_ms > 0 ? input.timeout_ms : 10000;
  const started = Date.now();
  const selector = typeof input.selector === 'string' ? input.selector : null;
  const text = typeof input.text === 'string' ? input.text : null;
  const expression = typeof input.expression === 'string' ? input.expression : null;
  const loadState = typeof input.load_state === 'string' ? input.load_state : null;
  const sleepMs = Number.isFinite(input.sleep_ms) && input.sleep_ms > 0 ? input.sleep_ms : null;
  const urlPattern = typeof input.url_pattern === 'string' ? input.url_pattern : null;

  const isVisible = (el) => {
    if (!(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const escapeRegExp = (value) => value.replace(/[-/\\\\^$*+?.()|[\\]{}]/g, '\\\\$&');
  const globToRegExp = (pattern) => new RegExp('^' + pattern.split('*').map(escapeRegExp).join('.*') + '$');

  const matchesLoadState = () => {
    if (!loadState) return false;
    if (loadState === 'load') return document.readyState === 'complete';
    if (loadState === 'domcontentloaded') return document.readyState !== 'loading';
    if (loadState === 'networkidle') return document.readyState === 'complete';
    return false;
  };

  const isConditionMet = () => {
    if (selector) {
      const el = document.querySelector(selector);
      return isVisible(el);
    }
    if (text) {
      return (document.body?.innerText || '').includes(text);
    }
    if (urlPattern) {
      return globToRegExp(urlPattern).test(window.location.href);
    }
    if (expression) {
      try {
        // eslint-disable-next-line no-eval
        return Boolean(eval(expression));
      } catch {
        return false;
      }
    }
    if (loadState) {
      return matchesLoadState();
    }
    return false;
  };

  return new Promise((resolve) => {
    if (sleepMs !== null) {
      setTimeout(() => resolve({ ok: true, waited: true, sleep_ms: sleepMs }), sleepMs);
      return;
    }

    const tick = () => {
      if (isConditionMet()) {
        resolve({ ok: true, waited: true });
        return;
      }

      if (Date.now() - started >= timeoutMs) {
        resolve({
          ok: false,
          error: {
            code: 'WAIT_TIMEOUT',
            message: 'Timed out while waiting for condition',
            details: {
              timeout_ms: timeoutMs,
              selector,
              text,
              url_pattern: urlPattern,
              load_state: loadState,
            },
          },
        });
        return;
      }

      setTimeout(tick, 100);
    };

    tick();
  });
}`;

chrome.runtime.onInstalled.addListener(() => {
  void bootstrap();
});

chrome.runtime.onStartup.addListener(() => {
  void bootstrap();
});

void bootstrap();
chrome.debugger.onEvent.addListener((source, method, params) => {
  handleDebuggerEvent(source, method, params);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    try {
      if (message?.type === 'GET_STATUS') {
        sendResponse({ ok: true, data: getUiStatus() });
        return;
      }

      if (message?.type === 'GET_CONFIG') {
        sendResponse({
          ok: true,
          data: {
            daemonWsUrl: state.daemon.wsUrl,
            token: state.daemon.token,
          },
        });
        return;
      }

      if (message?.type === 'SAVE_CONFIG') {
        const daemonWsUrl = normalizeDaemonWsUrl(String(message.daemonWsUrl ?? '').trim());
        const token = String(message.token ?? '').trim();
        await chrome.storage.local.set({ daemonWsUrl, daemonToken: token });
        state.daemon.wsUrl = daemonWsUrl;
        state.daemon.token = token;
        state.daemon.retryCount = 0;
        connectSocket();
        sendResponse({ ok: true, data: getUiStatus() });
        return;
      }

      if (message?.type === 'RECONNECT') {
        connectSocket({ force: true });
        sendResponse({ ok: true, data: getUiStatus() });
        return;
      }

      if (message?.type === 'RESET_SESSION') {
        await resetSession();
        sendResponse({ ok: true, data: getUiStatus() });
        return;
      }

      sendResponse({ ok: false, error: { code: 'BAD_REQUEST', message: 'Unknown message type' } });
    } catch (error) {
      sendResponse({
        ok: false,
        error: {
          code: 'INTERNAL',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  })();

  return true;
});

async function bootstrap() {
  const stored = await chrome.storage.local.get(['daemonWsUrl', 'daemonToken']);
  const rawWsUrl = String(stored.daemonWsUrl ?? '').trim();
  if (rawWsUrl) {
    try {
      state.daemon.wsUrl = normalizeDaemonWsUrl(rawWsUrl);
    } catch (error) {
      state.daemon.wsUrl = '';
      setError(error instanceof Error ? error.message : String(error));
    }
  } else {
    state.daemon.wsUrl = '';
  }
  state.daemon.token = String(stored.daemonToken ?? '');
  updateActionIcon();
  connectSocket();
}

function connectSocket(options = { force: false }) {
  if (!state.daemon.wsUrl || !state.daemon.token) {
    state.daemon.connected = false;
    updateActionIcon();
    setError('Config missing. Set daemon URL and token in popup.');
    return;
  }

  if (state.socket && state.socket.readyState === WebSocket.OPEN && !options.force) {
    return;
  }

  if (state.socket) {
    state.socket.onopen = null;
    state.socket.onclose = null;
    state.socket.onerror = null;
    state.socket.onmessage = null;
    try {
      state.socket.close();
    } catch {
      // Ignore.
    }
  }

  clearReconnectTimer();
  state.daemon.connected = false;
  updateActionIcon();

  const wsUrl = `${state.daemon.wsUrl}?token=${encodeURIComponent(state.daemon.token)}`;
  const socket = new WebSocket(wsUrl);
  state.socket = socket;

  socket.onopen = () => {
    state.daemon.connected = true;
    updateActionIcon();
    state.daemon.lastDisconnectReason = null;
    state.daemon.retryCount = 0;
    state.lastError = null;

    sendSocket({
      type: 'HELLO',
      version: chrome.runtime.getManifest().version,
      retry_count: state.daemon.retryCount,
    });

    sendExtensionEvent('connection_opened', {
      ws_url: state.daemon.wsUrl,
    });
  };

  socket.onmessage = (event) => {
    void handleSocketMessage(event.data);
  };

  socket.onerror = () => {
    setError('WebSocket error while connecting to daemon.');
  };

  socket.onclose = (event) => {
    state.daemon.connected = false;
    updateActionIcon();
    state.daemon.lastDisconnectReason = event.reason || `close_code_${event.code}`;
    void resetSession();
    scheduleReconnect();
  };
}

function normalizeDaemonWsUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Daemon WS URL must be a valid URL (example: ws://127.0.0.1:18765/bridge)');
  }

  // Restrict bridge destination to local loopback only.
  // Without this, a typo or malicious setup guide could point the extension to
  // a remote server that issues browser-control commands.
  if (parsed.protocol !== DAEMON_ALLOWED_PROTOCOL) {
    throw new Error('Daemon WS URL must use ws://');
  }

  if (parsed.hostname !== DAEMON_ALLOWED_HOST) {
    throw new Error(`Daemon WS URL host must be ${DAEMON_ALLOWED_HOST}`);
  }

  if (parsed.pathname !== DAEMON_ALLOWED_PATH) {
    throw new Error(`Daemon WS URL path must be ${DAEMON_ALLOWED_PATH}`);
  }

  if (parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error('Daemon WS URL must not include query/hash/auth components');
  }

  return `ws://${DAEMON_ALLOWED_HOST}${parsed.port ? `:${parsed.port}` : ''}${DAEMON_ALLOWED_PATH}`;
}

function scheduleReconnect() {
  clearReconnectTimer();
  state.daemon.retryCount += 1;
  const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * (2 ** Math.max(0, state.daemon.retryCount - 1)));

  state.daemon.reconnectTimer = setTimeout(() => {
    connectSocket();
  }, delay);
}

function clearReconnectTimer() {
  if (state.daemon.reconnectTimer) {
    clearTimeout(state.daemon.reconnectTimer);
    state.daemon.reconnectTimer = null;
  }
}

async function handleSocketMessage(rawData) {
  let envelope;
  try {
    envelope = JSON.parse(String(rawData));
  } catch {
    setError('Invalid JSON from daemon.');
    return;
  }

  if (envelope.type === 'PING') {
    state.daemon.lastPingAt = envelope.ts;
    sendSocket({ type: 'PONG', ts: new Date().toISOString() });
    return;
  }

  if (envelope.type !== 'COMMAND') {
    return;
  }

  const requestId = envelope.request_id;

  try {
    const result = await runCommand(envelope.command, envelope.payload || {});
    sendSocket({ type: 'RESULT', request_id: requestId, ok: true, result });
  } catch (error) {
    const structured = toStructuredError(error);
    state.lastError = structured;
    sendSocket({
      type: 'RESULT',
      request_id: requestId,
      ok: false,
      error: structured,
    });
  }
}

function sendSocket(payload) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    return;
  }

  state.socket.send(JSON.stringify(payload));
}

function sendExtensionEvent(name, payload = {}) {
  sendSocket({
    type: 'EVENT',
    name,
    payload,
  });
}

async function runCommand(command, payload) {
  switch (command) {
    case 'list_tabs': {
      const tabs = await chrome.tabs.query({});
      return {
        tabs: tabs
          .filter((tab) => typeof tab.id === 'number')
          .map((tab) => ({
            id: tab.id,
            active: Boolean(tab.active),
            title: tab.title || '',
            url: tab.url || '',
          })),
      };
    }

    case 'select_tab': {
      const tabId = await resolveTabId(payload.target);
      state.target.tabId = tabId;
      return {
        tab_id: tabId,
      };
    }

    case 'snapshot': {
      const tabId = await resolveTabId(payload.target);
      await ensureAttached(tabId);
      const nodes = await evaluateScript(tabId, SNAPSHOT_SCRIPT, {
        interactive: Boolean(payload.interactive),
        cursor: Boolean(payload.cursor),
        compact: Boolean(payload.compact),
        depth:
          typeof payload.depth === 'number' && Number.isInteger(payload.depth) && payload.depth >= 0
            ? payload.depth
            : undefined,
        selector: typeof payload.selector === 'string' ? payload.selector : undefined,
      });
      return {
        tab_id: tabId,
        nodes,
      };
    }

    case 'click': {
      const tabId = await resolveTabId(payload.tab_id);
      await ensureAttached(tabId);
      const response = await evaluateScript(tabId, CLICK_SCRIPT, {
        selector: String(payload.selector),
      });
      if (!response?.ok) {
        throw response?.error || new Error('click failed');
      }
      return response;
    }

    case 'fill': {
      const tabId = await resolveTabId(payload.tab_id);
      await ensureAttached(tabId);
      const response = await evaluateScript(tabId, FILL_SCRIPT, {
        selector: String(payload.selector),
        value: String(payload.value),
      });
      if (!response?.ok) {
        throw response?.error || new Error('fill failed');
      }
      return response;
    }

    case 'keypress': {
      const tabId = await resolveTabId(payload.tab_id);
      await ensureAttached(tabId);
      const response = await evaluateScript(tabId, KEYPRESS_SCRIPT, {
        key: String(payload.key),
      });
      return response;
    }

    case 'scroll': {
      const tabId = await resolveTabId(payload.tab_id);
      await ensureAttached(tabId);
      const response = await evaluateScript(tabId, SCROLL_SCRIPT, {
        x: Number(payload.x),
        y: Number(payload.y),
      });
      return response;
    }

    case 'navigate': {
      const tabId = await resolveTabId(payload.tab_id);
      await ensureAttached(tabId);
      const response = await evaluateScript(tabId, NAVIGATE_SCRIPT, {
        url: String(payload.url),
      });
      return response;
    }

    case 'open': {
      const tabId = await resolveTabId(payload.tab_id);
      const url = String(payload.url);
      await chrome.tabs.update(tabId, { url });
      return {
        ok: true,
        tab_id: tabId,
        url,
      };
    }

    case 'close': {
      const tabId = await resolveTabId(payload.tab_id);
      await chrome.tabs.remove(tabId);
      if (state.target.attached && state.target.tabId === tabId) {
        state.target.attached = false;
        state.target.tabId = null;
      }
      return {
        ok: true,
        tab_id: tabId,
      };
    }

    case 'hover': {
      const tabId = await resolveTabId(payload.tab_id);
      await ensureAttached(tabId);
      const point = await evaluateScript(tabId, HOVER_POINT_SCRIPT, {
        selector: String(payload.selector),
      });
      if (!point?.ok) {
        throw point?.error || new Error('hover failed');
      }
      await chrome.debugger.sendCommand(
        { tabId },
        'Input.dispatchMouseEvent',
        {
          type: 'mouseMoved',
          x: Number(point.x),
          y: Number(point.y),
        },
      );
      return {
        ok: true,
        x: point.x,
        y: point.y,
      };
    }

    case 'eval': {
      const tabId = await resolveTabId(payload.tab_id);
      await ensureAttached(tabId);
      const result = await evaluateRaw(tabId, String(payload.script));
      return {
        ok: true,
        result,
      };
    }

    case 'text': {
      const tabId = await resolveTabId(payload.tab_id);
      await ensureAttached(tabId);
      const response = await evaluateScript(tabId, TEXT_SCRIPT, {
        selector: String(payload.selector),
      });
      if (!response?.ok) {
        throw response?.error || new Error('text failed');
      }
      return response;
    }

    case 'html': {
      const tabId = await resolveTabId(payload.tab_id);
      await ensureAttached(tabId);
      const response = await evaluateScript(tabId, HTML_SCRIPT, {
        selector: typeof payload.selector === 'string' ? payload.selector : undefined,
      });
      if (!response?.ok) {
        throw response?.error || new Error('html failed');
      }
      return response;
    }

    case 'wait': {
      const tabId = await resolveTabId(payload.tab_id);
      await ensureAttached(tabId);
      const response = await evaluateScript(tabId, WAIT_SCRIPT, {
        selector: typeof payload.selector === 'string' ? payload.selector : undefined,
        sleep_ms: typeof payload.sleep_ms === 'number' ? payload.sleep_ms : undefined,
        timeout_ms: typeof payload.timeout_ms === 'number' ? payload.timeout_ms : undefined,
        text: typeof payload.text === 'string' ? payload.text : undefined,
        url_pattern: typeof payload.url_pattern === 'string' ? payload.url_pattern : undefined,
        load_state: typeof payload.load_state === 'string' ? payload.load_state : undefined,
        expression: typeof payload.expression === 'string' ? payload.expression : undefined,
      });
      if (!response?.ok) {
        throw response?.error || new Error('wait failed');
      }
      return response;
    }

    case 'screenshot': {
      const tabId = await resolveTabId(payload.tab_id);
      await ensureAttached(tabId);
      await chrome.debugger.sendCommand({ tabId }, 'Page.enable');

      const options = {
        format: 'png',
      };

      if (Boolean(payload.full_page)) {
        const metrics = await chrome.debugger.sendCommand({ tabId }, 'Page.getLayoutMetrics');
        const contentSize = metrics?.contentSize;
        if (!contentSize) {
          throw {
            code: 'SCREENSHOT_FAILED',
            message: 'Page.getLayoutMetrics returned no contentSize',
          };
        }
        const capture = await chrome.debugger.sendCommand(
          { tabId },
          'Page.captureScreenshot',
          {
            ...options,
            captureBeyondViewport: true,
            fromSurface: true,
            clip: {
              x: 0,
              y: 0,
              width: Number(contentSize.width),
              height: Number(contentSize.height),
              scale: 1,
            },
          },
        );
        return {
          ok: true,
          format: 'png',
          data_base64: capture.data,
        };
      }

      const capture = await chrome.debugger.sendCommand(
        { tabId },
        'Page.captureScreenshot',
        {
          ...options,
          fromSurface: true,
        },
      );

      return {
        ok: true,
        format: 'png',
        data_base64: capture.data,
      };
    }

    case 'pdf': {
      const tabId = await resolveTabId(payload.tab_id);
      await ensureAttached(tabId);
      await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
      const printed = await chrome.debugger.sendCommand({ tabId }, 'Page.printToPDF', {
        printBackground: true,
      });
      return {
        ok: true,
        data_base64: printed.data,
      };
    }

    case 'cookies_get': {
      const tabId = await resolveTabId(payload.tab_id);
      await ensureAttached(tabId);
      const url = typeof payload.url === 'string' ? payload.url : await getTabUrl(tabId);
      const result = await chrome.debugger.sendCommand({ tabId }, 'Network.getCookies', {
        urls: [url],
      });
      return {
        ok: true,
        cookies: result.cookies || [],
      };
    }

    case 'cookies_set': {
      const tabId = await resolveTabId(payload.tab_id);
      await ensureAttached(tabId);
      const name = String(payload.name);
      const value = String(payload.value);
      const url = typeof payload.url === 'string' ? payload.url : await getTabUrl(tabId);
      await chrome.debugger.sendCommand({ tabId }, 'Network.setCookies', {
        cookies: [{ name, value, url }],
      });
      return {
        ok: true,
        name,
        url,
      };
    }

    case 'cookies_delete': {
      const tabId = await resolveTabId(payload.tab_id);
      await ensureAttached(tabId);
      const name = String(payload.name);
      const url = typeof payload.url === 'string' ? payload.url : await getTabUrl(tabId);
      await chrome.debugger.sendCommand({ tabId }, 'Network.deleteCookies', {
        name,
        url,
      });
      return {
        ok: true,
        name,
        url,
      };
    }

    case 'cookies_clear': {
      const tabId = await resolveTabId(payload.tab_id);
      await ensureAttached(tabId);
      const currentUrl = await getTabUrl(tabId);
      const result = await chrome.debugger.sendCommand({ tabId }, 'Network.getCookies', {
        urls: [currentUrl],
      });
      const cookies = Array.isArray(result.cookies) ? result.cookies : [];
      let cleared = 0;
      for (const cookie of cookies) {
        try {
          await chrome.debugger.sendCommand({ tabId }, 'Network.deleteCookies', {
            name: cookie.name,
            domain: cookie.domain,
            path: cookie.path,
          });
          cleared += 1;
        } catch {
          // Ignore per-cookie deletion errors so one bad cookie does not block all deletions.
        }
      }
      return {
        ok: true,
        cleared,
      };
    }

    case 'network_start': {
      const tabId = await resolveTabId(payload.tab_id);
      await ensureAttached(tabId);
      await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
      state.monitor.network.enabled = true;
      return {
        ok: true,
        tab_id: tabId,
      };
    }

    case 'network_stop': {
      const tabId = await resolveTabId(payload.tab_id);
      await ensureAttached(tabId);
      state.monitor.network.enabled = false;
      return {
        ok: true,
        tab_id: tabId,
      };
    }

    case 'network_dump': {
      const tabId = await resolveTabId(payload.tab_id);
      await ensureAttached(tabId);
      await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
      state.monitor.network.enabled = true;

      const filter = typeof payload.filter === 'string' ? payload.filter.toLowerCase() : null;
      const events = filter
        ? state.monitor.network.events.filter((entry) => String(entry.url || '').toLowerCase().includes(filter))
        : state.monitor.network.events;
      const response = {
        ok: true,
        events,
      };

      if (payload.clear === true) {
        state.monitor.network.events = [];
        state.monitor.network.byRequestId = {};
      }

      return response;
    }

    case 'console_start': {
      const tabId = await resolveTabId(payload.tab_id);
      await ensureAttached(tabId);
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
      state.monitor.console.enabled = true;
      return {
        ok: true,
        tab_id: tabId,
      };
    }

    case 'console_stop': {
      const tabId = await resolveTabId(payload.tab_id);
      await ensureAttached(tabId);
      state.monitor.console.enabled = false;
      return {
        ok: true,
        tab_id: tabId,
      };
    }

    case 'console_dump': {
      const tabId = await resolveTabId(payload.tab_id);
      await ensureAttached(tabId);
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
      state.monitor.console.enabled = true;

      const messages = state.monitor.console.events;
      if (payload.clear === true) {
        state.monitor.console.events = [];
      }
      return {
        ok: true,
        messages,
      };
    }

    case 'reconnect': {
      connectSocket({ force: true });
      return { ok: true, requested: true };
    }

    case 'reset': {
      await resetSession();
      return { ok: true, reset: true };
    }

    default:
      throw {
        code: 'BAD_REQUEST',
        message: `Unknown command: ${command}`,
      };
  }
}

async function resolveTabId(target) {
  if (target === undefined || target === null || target === 'active') {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const active = tabs.find((tab) => typeof tab.id === 'number');
    if (!active || typeof active.id !== 'number') {
      throw {
        code: 'NO_ACTIVE_TAB',
        message: 'No active tab found',
      };
    }
    return active.id;
  }

  if (typeof target === 'number' && Number.isFinite(target)) {
    return target;
  }

  if (typeof target === 'string') {
    const parsed = Number(target);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw {
    code: 'BAD_REQUEST',
    message: 'Invalid tab target',
    details: { target },
  };
}

async function ensureAttached(tabId) {
  if (state.target.attached && state.target.tabId === tabId) {
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
      return;
    } catch {
      state.target.attached = false;
      state.target.tabId = null;
    }
  }

  if (state.target.attached && typeof state.target.tabId === 'number') {
    try {
      await chrome.debugger.detach({ tabId: state.target.tabId });
    } catch {
      // Ignore stale detach errors.
    }
  }

  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
  } catch (error) {
    throw {
      code: 'DEBUGGER_ATTACH_FAILED',
      message: error instanceof Error ? error.message : String(error),
      details: { tab_id: tabId },
    };
  }

  state.target.attached = true;
  state.target.tabId = tabId;
}

async function evaluateScript(tabId, scriptBody, input) {
  const expression = `(${scriptBody})(${JSON.stringify(input)})`;

  let response;
  try {
    response = await chrome.debugger.sendCommand(
      { tabId },
      'Runtime.evaluate',
      {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      },
    );
  } catch (error) {
    throw {
      code: 'CDP_EVALUATE_FAILED',
      message: error instanceof Error ? error.message : String(error),
      details: {
        tab_id: tabId,
      },
    };
  }

  if (response?.exceptionDetails) {
    throw {
      code: 'SCRIPT_EXCEPTION',
      message: 'Page script execution failed',
      details: {
        tab_id: tabId,
        text: response.exceptionDetails.text,
      },
    };
  }

  return response?.result?.value;
}

async function resetSession() {
  const attachedTabId = state.target.attached && typeof state.target.tabId === 'number'
    ? state.target.tabId
    : null;
  state.target.attached = false;
  state.target.tabId = null;
  state.monitor.network.enabled = false;
  state.monitor.console.enabled = false;

  if (attachedTabId !== null) {
    try {
      await chrome.debugger.detach({ tabId: attachedTabId });
    } catch {
      // Ignore detach errors.
    }
  }
}

function handleDebuggerEvent(source, method, params) {
  if (!source || typeof source.tabId !== 'number') {
    return;
  }

  const tabId = source.tabId;
  if (state.target.tabId !== tabId) {
    return;
  }

  if (state.monitor.network.enabled) {
    if (method === 'Network.requestWillBeSent') {
      const requestId = String(params?.requestId ?? '');
      if (!requestId) {
        return;
      }
      state.monitor.network.byRequestId[requestId] = {
        request_id: requestId,
        url: String(params?.request?.url ?? ''),
        method: String(params?.request?.method ?? ''),
        resource_type: String(params?.type ?? ''),
        started_at: Date.now(),
      };
      return;
    }

    if (method === 'Network.responseReceived') {
      const requestId = String(params?.requestId ?? '');
      if (!requestId) {
        return;
      }
      const entry = state.monitor.network.byRequestId[requestId] || {};
      const nextEntry = {
        request_id: requestId,
        url: String(params?.response?.url ?? entry.url ?? ''),
        method: String(entry.method ?? ''),
        resource_type: String(params?.type ?? entry.resource_type ?? ''),
        status: Number(params?.response?.status ?? 0),
        status_text: String(params?.response?.statusText ?? ''),
        mime_type: String(params?.response?.mimeType ?? ''),
        timestamp: Date.now(),
      };
      pushMonitorEvent(state.monitor.network.events, nextEntry);
      delete state.monitor.network.byRequestId[requestId];
      return;
    }
  }

  if (state.monitor.console.enabled) {
    if (method === 'Runtime.consoleAPICalled') {
      const args = Array.isArray(params?.args) ? params.args : [];
      const text = args.map((entry) => stringifyRemoteValue(entry)).join(' ');
      pushMonitorEvent(state.monitor.console.events, {
        type: String(params?.type ?? 'log'),
        text,
        timestamp: Date.now(),
      });
      return;
    }

    if (method === 'Runtime.exceptionThrown') {
      const details = params?.exceptionDetails || {};
      const text = String(details.text || details.exception?.description || 'Uncaught exception');
      pushMonitorEvent(state.monitor.console.events, {
        type: 'error',
        text,
        timestamp: Date.now(),
      });
    }
  }
}

function stringifyRemoteValue(input) {
  if (!input || typeof input !== 'object') {
    return String(input ?? '');
  }

  if (typeof input.value === 'string' || typeof input.value === 'number' || typeof input.value === 'boolean') {
    return String(input.value);
  }

  if (input.value === null) {
    return 'null';
  }

  if (typeof input.description === 'string' && input.description.length > 0) {
    return input.description;
  }

  return String(input.type ?? 'unknown');
}

function pushMonitorEvent(bucket, item) {
  bucket.push(item);
  if (bucket.length > MAX_MONITOR_EVENTS) {
    bucket.splice(0, bucket.length - MAX_MONITOR_EVENTS);
  }
}

async function evaluateRaw(tabId, expression) {
  let response;
  try {
    response = await chrome.debugger.sendCommand(
      { tabId },
      'Runtime.evaluate',
      {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      },
    );
  } catch (error) {
    throw {
      code: 'CDP_EVALUATE_FAILED',
      message: error instanceof Error ? error.message : String(error),
      details: {
        tab_id: tabId,
      },
    };
  }

  if (response?.exceptionDetails) {
    throw {
      code: 'SCRIPT_EXCEPTION',
      message: 'Page script execution failed',
      details: {
        tab_id: tabId,
        text: response.exceptionDetails.text,
      },
    };
  }

  return response?.result?.value;
}

async function getTabUrl(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const url = String(tab.url || '').trim();
  if (!url) {
    throw {
      code: 'NO_TAB_URL',
      message: 'Could not resolve tab URL',
      details: {
        tab_id: tabId,
      },
    };
  }
  return url;
}

function toStructuredError(error) {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    const casted = error;
    return {
      code: String(casted.code),
      message: String(casted.message),
      details: casted.details && typeof casted.details === 'object' ? casted.details : undefined,
    };
  }

  if (error instanceof Error) {
    return {
      code: 'INTERNAL',
      message: error.message,
    };
  }

  return {
    code: 'INTERNAL',
    message: String(error),
  };
}

function setError(message) {
  state.lastError = {
    code: 'CONNECTION_ERROR',
    message,
  };
}

function updateActionIcon() {
  const stateKey = state.daemon.connected ? 'connected' : 'disconnected';
  chrome.action.setIcon({
    path: ACTION_ICON_PATHS[stateKey],
  });
}

function getUiStatus() {
  return {
    daemon: {
      connected: state.daemon.connected,
      ws_url: state.daemon.wsUrl,
      last_ping_at: state.daemon.lastPingAt,
      retry_count: state.daemon.retryCount,
      last_disconnect_reason: state.daemon.lastDisconnectReason,
    },
    target: {
      tab_id: state.target.tabId,
      attached: state.target.attached,
    },
    last_error: state.lastError,
  };
}
