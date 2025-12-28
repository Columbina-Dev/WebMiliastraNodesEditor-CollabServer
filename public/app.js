const configForm = document.getElementById('config-form');
const requireApiKeyInput = document.getElementById('require-api-key');
const maxRoomsInput = document.getElementById('max-rooms');
const roomCount = document.getElementById('room-count');
const configStatus = document.getElementById('config-status');
const keyList = document.getElementById('key-list');
const newKeyInput = document.getElementById('new-key');
const addKeyButton = document.getElementById('add-key');
const generateKeyButton = document.getElementById('generate-key');

const setStatus = (message, state) => {
  configStatus.textContent = message;
  if (state) {
    configStatus.dataset.state = state;
  } else {
    delete configStatus.dataset.state;
  }
};

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data?.error || 'Request failed');
    error.payload = data;
    throw error;
  }
  return data;
};

const copyText = async (value) => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fallback below
  }
  const temp = document.createElement('textarea');
  temp.value = value;
  temp.style.position = 'fixed';
  temp.style.opacity = '0';
  document.body.appendChild(temp);
  temp.select();
  const success = document.execCommand('copy');
  document.body.removeChild(temp);
  return success;
};

const renderKeys = (keys) => {
  keyList.innerHTML = '';
  if (!keys.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No API keys configured.';
    empty.className = 'status';
    keyList.appendChild(empty);
    return;
  }
  keys.forEach((key) => {
    const item = document.createElement('li');
    item.className = 'key-item';

    const code = document.createElement('code');
    code.textContent = key;
    item.appendChild(code);

    const actions = document.createElement('div');
    actions.className = 'row';

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = 'Copy';
    copyButton.className = 'secondary';
    copyButton.addEventListener('click', async () => {
      const ok = await copyText(key);
      setStatus(ok ? 'API key copied.' : 'Unable to copy API key.', ok ? '' : 'error');
    });

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.textContent = 'Remove';
    removeButton.className = 'danger';
    removeButton.addEventListener('click', async () => {
      try {
        await fetchJson('/api/keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'remove', key }),
        });
        await loadConfig();
        setStatus('API key removed.', '');
      } catch {
        setStatus('Failed to remove API key.', 'error');
      }
    });

    actions.appendChild(copyButton);
    actions.appendChild(removeButton);
    item.appendChild(actions);
    keyList.appendChild(item);
  });
};

const loadConfig = async () => {
  const data = await fetchJson('/api/config');
  requireApiKeyInput.checked = Boolean(data.requireApiKey);
  maxRoomsInput.value = data.maxRooms ?? 0;
  roomCount.textContent = data.roomCount ?? 0;
  renderKeys(Array.isArray(data.apiKeys) ? data.apiKeys : []);
};

configForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus('Saving settings...', '');
  try {
    await fetchJson('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requireApiKey: requireApiKeyInput.checked,
        maxRooms: Number(maxRoomsInput.value || 0),
      }),
    });
    await loadConfig();
    setStatus('Settings saved.', '');
  } catch {
    setStatus('Failed to save settings.', 'error');
  }
});

addKeyButton.addEventListener('click', async () => {
  setStatus('Adding key...', '');
  try {
    await fetchJson('/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add',
        key: newKeyInput.value.trim() || undefined,
      }),
    });
    newKeyInput.value = '';
    await loadConfig();
    setStatus('API key added.', '');
  } catch {
    setStatus('Failed to add API key.', 'error');
  }
});

generateKeyButton.addEventListener('click', async () => {
  setStatus('Generating key...', '');
  try {
    await fetchJson('/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add' }),
    });
    newKeyInput.value = '';
    await loadConfig();
    setStatus('API key generated.', '');
  } catch {
    setStatus('Failed to generate API key.', 'error');
  }
});

loadConfig().catch(() => {
  setStatus('Failed to load config.', 'error');
});
