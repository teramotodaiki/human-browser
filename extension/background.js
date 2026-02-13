const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30000;

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
  lastError: null,
};

const SNAPSHOT_SCRIPT = `(input) => {
  const matches = document.querySelectorAll('a[href], button, input, textarea, select, [role="button"], [contenteditable="true"], [tabindex]');
  const nodes = [];

  const isVisible = (el) => {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const toRole = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.toLowerCase();

    const tag = el.tagName.toLowerCase();
    if (tag === 'a' && el.getAttribute('href')) return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';

    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      return 'textbox';
    }

    return 'generic';
  };

  const toName = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelNode = document.getElementById(labelledBy);
      if (labelNode && labelNode.textContent && labelNode.textContent.trim()) {
        return labelNode.textContent.trim();
      }
    }

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (el.value && el.value.trim()) return el.value.trim();
      if (el.placeholder && el.placeholder.trim()) return el.placeholder.trim();
    }

    if (el.textContent && el.textContent.trim()) {
      return el.textContent.trim().replace(/\s+/g, ' ').slice(0, 120);
    }

    return '';
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

  const seen = new Set();

  for (const el of matches) {
    if (!(el instanceof Element)) continue;
    if (!isVisible(el)) continue;
    const selector = cssPath(el);
    if (seen.has(selector)) continue;
    seen.add(selector);

    nodes.push({
      role: toRole(el),
      name: toName(el),
      selector,
      suffix: '',
    });
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

chrome.runtime.onInstalled.addListener(() => {
  void bootstrap();
});

chrome.runtime.onStartup.addListener(() => {
  void bootstrap();
});

void bootstrap();

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
        const daemonWsUrl = String(message.daemonWsUrl ?? '').trim();
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
  state.daemon.wsUrl = String(stored.daemonWsUrl ?? '');
  state.daemon.token = String(stored.daemonToken ?? '');
  connectSocket();
}

function connectSocket(options = { force: false }) {
  if (!state.daemon.wsUrl || !state.daemon.token) {
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

  const wsUrl = `${state.daemon.wsUrl}?token=${encodeURIComponent(state.daemon.token)}`;
  const socket = new WebSocket(wsUrl);
  state.socket = socket;

  socket.onopen = () => {
    state.daemon.connected = true;
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
    state.daemon.lastDisconnectReason = event.reason || `close_code_${event.code}`;
    scheduleReconnect();
  };
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
      const nodes = await evaluateScript(tabId, SNAPSHOT_SCRIPT, {});
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
    return;
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
  if (state.target.attached && typeof state.target.tabId === 'number') {
    try {
      await chrome.debugger.detach({ tabId: state.target.tabId });
    } catch {
      // Ignore detach errors.
    }
  }

  state.target.attached = false;
  state.target.tabId = null;
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
