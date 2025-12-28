const requireApiKeyInput = document.getElementById('require-api-key');
const maxRoomsInput = document.getElementById('max-rooms');
const roomCount = document.getElementById('room-count');
const configStatus = document.getElementById('config-status');
const keyList = document.getElementById('key-list');
const newKeyInput = document.getElementById('new-key');
const addKeyButton = document.getElementById('add-key');
const generateKeyButton = document.getElementById('generate-key');
const langSelect = document.getElementById('lang-select');

const LANG_STORAGE_KEY = 'miliastra-collab:lang';

const translations = {
  en: {
    'header.title': 'Miliastra Collaboration Server',
    'header.subtitle': 'Configure public rooms, API keys, and capacity.',
    'header.language': 'Language',
    'config.title': 'Server Configuration',
    'config.requireApiKey': 'Require API key to create rooms',
    'config.maxRooms': 'Maximum rooms (0 = unlimited)',
    'config.activeRooms': 'Active rooms',
    'keys.title': 'API Keys',
    'keys.placeholder': 'Paste or leave empty to generate',
    'keys.add': 'Add key',
    'keys.generate': 'Generate key',
    'keys.empty': 'No API keys configured.',
    'keys.copy': 'Copy',
    'keys.remove': 'Remove',
    'status.saving': 'Saving settings...',
    'status.saved': 'Settings saved.',
    'status.saveFailed': 'Failed to save settings.',
    'status.addingKey': 'Adding key...',
    'status.keyAdded': 'API key added.',
    'status.addKeyFailed': 'Failed to add API key.',
    'status.generatingKey': 'Generating key...',
    'status.keyGenerated': 'API key generated.',
    'status.generateKeyFailed': 'Failed to generate API key.',
    'status.keyRemoved': 'API key removed.',
    'status.removeKeyFailed': 'Failed to remove API key.',
    'status.keyCopied': 'API key copied.',
    'status.keyCopyFailed': 'Unable to copy API key.',
    'status.loadFailed': 'Failed to load config.',
  },
  zh: {
    'header.title': 'Miliastra 协作服务器',
    'header.subtitle': '配置公共房间、API 密钥与容量。',
    'header.language': '语言',
    'config.title': '服务器设置',
    'config.requireApiKey': '创建房间需要 API 密钥',
    'config.maxRooms': '最大房间数（0 表示无限）',
    'config.activeRooms': '当前房间',
    'keys.title': 'API 密钥',
    'keys.placeholder': '粘贴密钥或留空以生成',
    'keys.add': '添加密钥',
    'keys.generate': '生成密钥',
    'keys.empty': '暂无 API 密钥。',
    'keys.copy': '复制',
    'keys.remove': '移除',
    'status.saving': '正在保存设置...',
    'status.saved': '设置已保存。',
    'status.saveFailed': '保存设置失败。',
    'status.addingKey': '正在添加密钥...',
    'status.keyAdded': '已添加密钥。',
    'status.addKeyFailed': '添加密钥失败。',
    'status.generatingKey': '正在生成密钥...',
    'status.keyGenerated': '已生成密钥。',
    'status.generateKeyFailed': '生成密钥失败。',
    'status.keyRemoved': '已移除密钥。',
    'status.removeKeyFailed': '移除密钥失败。',
    'status.keyCopied': '已复制密钥。',
    'status.keyCopyFailed': '复制密钥失败。',
    'status.loadFailed': '加载设置失败。',
  },
};

const detectDefaultLang = () => {
  const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
  if (stored && translations[stored]) return stored;
  const lang = navigator.language?.toLowerCase() ?? '';
  return lang.startsWith('zh') ? 'zh' : 'en';
};

let currentLang = detectDefaultLang();
let cachedKeys = [];
let cachedConfig = { requireApiKey: false, maxRooms: 0, roomCount: 0 };
let statusState = { key: '', state: '' };
let configSaveTimer = null;

const t = (key) => translations[currentLang]?.[key] ?? translations.en[key] ?? key;

const setStatus = (message, state) => {
  configStatus.textContent = message;
  if (state) {
    configStatus.dataset.state = state;
  } else {
    delete configStatus.dataset.state;
  }
};

const setStatusKey = (key, state) => {
  statusState = { key, state: state || '' };
  if (!key) {
    setStatus('', '');
    return;
  }
  setStatus(t(key), state);
};

const applyTranslations = () => {
  document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const key = node.dataset.i18n;
    if (key) {
      node.textContent = t(key);
    }
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    const key = node.dataset.i18nPlaceholder;
    if (key && node instanceof HTMLInputElement) {
      node.placeholder = t(key);
    }
  });
  if (langSelect) {
    langSelect.value = currentLang;
  }
  renderKeys(cachedKeys);
  if (statusState.key) {
    setStatus(t(statusState.key), statusState.state);
  }
};

const setLanguage = (lang) => {
  if (!translations[lang]) return;
  currentLang = lang;
  window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  applyTranslations();
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
  cachedKeys = Array.isArray(keys) ? [...keys] : [];
  keyList.innerHTML = '';
  if (!cachedKeys.length) {
    const empty = document.createElement('li');
    empty.textContent = t('keys.empty');
    empty.className = 'status';
    keyList.appendChild(empty);
    return;
  }
  cachedKeys.forEach((key) => {
    const item = document.createElement('li');
    item.className = 'key-item';

    const code = document.createElement('code');
    code.textContent = key;
    item.appendChild(code);

    const actions = document.createElement('div');
    actions.className = 'row';

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = t('keys.copy');
    copyButton.className = 'secondary';
    copyButton.addEventListener('click', async () => {
      const ok = await copyText(key);
      setStatusKey(ok ? 'status.keyCopied' : 'status.keyCopyFailed', ok ? '' : 'error');
    });

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.textContent = t('keys.remove');
    removeButton.className = 'danger';
    removeButton.addEventListener('click', async () => {
      try {
        await fetchJson('/api/keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'remove', key }),
        });
        await loadConfig();
        setStatusKey('status.keyRemoved', '');
      } catch {
        setStatusKey('status.removeKeyFailed', 'error');
      }
    });

    actions.appendChild(copyButton);
    actions.appendChild(removeButton);
    item.appendChild(actions);
    keyList.appendChild(item);
  });
};

const applyConfig = (data) => {
  cachedConfig = {
    requireApiKey: Boolean(data.requireApiKey),
    maxRooms: Number(data.maxRooms ?? 0),
    roomCount: Number(data.roomCount ?? 0),
  };
  requireApiKeyInput.checked = cachedConfig.requireApiKey;
  maxRoomsInput.value = Number.isFinite(cachedConfig.maxRooms) ? String(cachedConfig.maxRooms) : '0';
  roomCount.textContent = String(cachedConfig.roomCount ?? 0);
  renderKeys(Array.isArray(data.apiKeys) ? data.apiKeys : []);
};

const loadConfig = async () => {
  const data = await fetchJson('/api/config');
  applyConfig(data);
};

const saveConfig = async () => {
  setStatusKey('status.saving', '');
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
    setStatusKey('status.saved', '');
  } catch {
    setStatusKey('status.saveFailed', 'error');
  }
};

const scheduleConfigSave = () => {
  if (configSaveTimer) {
    window.clearTimeout(configSaveTimer);
  }
  configSaveTimer = window.setTimeout(() => {
    configSaveTimer = null;
    void saveConfig();
  }, 450);
};

requireApiKeyInput.addEventListener('change', () => {
  void saveConfig();
});

maxRoomsInput.addEventListener('input', scheduleConfigSave);
maxRoomsInput.addEventListener('change', () => {
  void saveConfig();
});

addKeyButton.addEventListener('click', async () => {
  setStatusKey('status.addingKey', '');
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
    setStatusKey('status.keyAdded', '');
  } catch {
    setStatusKey('status.addKeyFailed', 'error');
  }
});

generateKeyButton.addEventListener('click', async () => {
  setStatusKey('status.generatingKey', '');
  try {
    await fetchJson('/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add' }),
    });
    newKeyInput.value = '';
    await loadConfig();
    setStatusKey('status.keyGenerated', '');
  } catch {
    setStatusKey('status.generateKeyFailed', 'error');
  }
});

if (langSelect) {
  langSelect.addEventListener('change', (event) => {
    const value = event.target.value;
    setLanguage(value);
  });
}

applyTranslations();
loadConfig().catch(() => {
  setStatusKey('status.loadFailed', 'error');
});
