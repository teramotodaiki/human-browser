const elements = {
  daemonConnected: document.getElementById('daemon-connected'),
  lastPing: document.getElementById('last-ping'),
  retryCount: document.getElementById('retry-count'),
  disconnectReason: document.getElementById('disconnect-reason'),
  targetTab: document.getElementById('target-tab'),
  targetAttached: document.getElementById('target-attached'),
  daemonWsUrl: document.getElementById('daemon-ws-url'),
  daemonToken: document.getElementById('daemon-token'),
  lastError: document.getElementById('last-error'),
  saveConfig: document.getElementById('save-config'),
  reconnect: document.getElementById('reconnect'),
  resetSession: document.getElementById('reset-session'),
};

let refreshTimer = null;

void init();

async function init() {
  await loadConfig();
  await refreshStatus();

  elements.saveConfig.addEventListener('click', () => {
    void saveConfig();
  });

  elements.reconnect.addEventListener('click', () => {
    void sendCommand({ type: 'RECONNECT' }).then(refreshStatus);
  });

  elements.resetSession.addEventListener('click', () => {
    void sendCommand({ type: 'RESET_SESSION' }).then(refreshStatus);
  });

  refreshTimer = setInterval(() => {
    void refreshStatus();
  }, 1000);

  window.addEventListener('unload', () => {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  });
}

async function loadConfig() {
  const response = await sendCommand({ type: 'GET_CONFIG' });
  const config = response.data || {};
  elements.daemonWsUrl.value = config.daemonWsUrl || '';
  elements.daemonToken.value = config.token || '';
}

async function saveConfig() {
  await sendCommand({
    type: 'SAVE_CONFIG',
    daemonWsUrl: elements.daemonWsUrl.value.trim(),
    token: elements.daemonToken.value.trim(),
  });

  await refreshStatus();
}

async function refreshStatus() {
  const response = await sendCommand({ type: 'GET_STATUS' });
  const status = response.data || {};

  elements.daemonConnected.textContent = status.daemon?.connected ? 'connected' : 'disconnected';
  elements.lastPing.textContent = status.daemon?.last_ping_at || '-';
  elements.retryCount.textContent = String(status.daemon?.retry_count ?? '-');
  elements.disconnectReason.textContent = status.daemon?.last_disconnect_reason || '-';
  elements.targetTab.textContent = status.target?.tab_id === null || status.target?.tab_id === undefined
    ? '-'
    : String(status.target.tab_id);
  elements.targetAttached.textContent = status.target?.attached ? 'yes' : 'no';
  elements.lastError.textContent = status.last_error ? JSON.stringify(status.last_error, null, 2) : '-';
}

async function sendCommand(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error?.message || 'Unknown extension error');
  }
  return response;
}
