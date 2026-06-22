// popup.js — 弹窗逻辑

const brandListTextarea = document.getElementById('brandList');
const brandCount = document.getElementById('brandCount');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const exportBtn = document.getElementById('exportBtn');
const progressSection = document.getElementById('progressSection');
const progressText = document.getElementById('progressText');
const currentBrandName = document.getElementById('currentBrandName');
const currentChannelTag = document.getElementById('currentChannelTag');
const progressFill = document.getElementById('progressFill');
const brandStatusList = document.getElementById('brandStatusList');
const resetBtn = document.getElementById('resetBtn');

const POLL_INTERVAL_MS = 500;

let allResults = [];
let pollTimer = null;
let polling = false;

// 恢复上次保存的设置
chrome.storage.local.get(['savedBrands', 'scraperState'], (data) => {
  if (data.savedBrands) { brandListTextarea.value = data.savedBrands; updateBrandCount(); }
  const state = data.scraperState;
  if (state && state.status === 'running') {
    updateUI('running');
    updateProgress(state);
    renderBrandStatuses(state.brandStatuses || []);
    startPolling();
  } else if (state && state.status === 'done') {
    allResults = state.results || [];
    updateUI('done');
    updateProgress(state);
    renderBrandStatuses(state.brandStatuses || []);
  } else if (state && state.status === 'stopped') {
    allResults = state.results || [];
    updateUI('stopped');
    updateProgress(state);
    renderBrandStatuses(state.brandStatuses || []);
  }
});

function updateUI(status) {
  switch (status) {
    case 'idle':
      startBtn.classList.remove('hidden');
      startBtn.textContent = '开始采集';
      stopBtn.classList.add('hidden');
      exportBtn.classList.add('hidden');
      progressSection.classList.add('hidden');
      brandListTextarea.classList.remove('hidden');
      brandStatusList.classList.add('hidden');
      brandListTextarea.disabled = false;
      startBtn.disabled = false;
      break;
    case 'running':
      startBtn.disabled = true;
      stopBtn.classList.remove('hidden');
      exportBtn.classList.add('hidden');
      progressSection.classList.remove('hidden');
      brandListTextarea.classList.add('hidden');
      brandStatusList.classList.remove('hidden');
      brandListTextarea.disabled = true;
      break;
    case 'done':
    case 'stopped':
      startBtn.classList.remove('hidden');
      startBtn.textContent = '开始采集';
      startBtn.disabled = false;
      stopBtn.classList.add('hidden');
      exportBtn.classList.remove('hidden');
      progressSection.classList.remove('hidden');
      brandListTextarea.classList.add('hidden');
      brandStatusList.classList.remove('hidden');
      brandListTextarea.disabled = false;
      break;
  }
}

function updateProgress(progress) {
  const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  progressText.textContent = `${progress.completed} / ${progress.total}`;
  startBtn.textContent = `采集中 ${pct}%`;
  currentBrandName.textContent = progress.current || '';
  currentChannelTag.textContent = progress.currentChannel || '';
  currentChannelTag.classList.toggle('hidden', !progress.currentChannel);
  progressFill.style.width = pct + '%';
  // Update ARIA attributes
  const progressBar = progressFill.parentElement;
  progressBar.setAttribute('aria-valuenow', pct);
  progressSection.classList.remove('hidden');
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (polling) return;
    polling = true;
    chrome.storage.local.get(['scraperState'], (data) => {
      polling = false;
      const state = data.scraperState;
      if (!state) return;
      if (state.status === 'running') {
        updateProgress(state);
        renderBrandStatuses(state.brandStatuses || []);
      } else if (state.status === 'done') {
        clearInterval(pollTimer);
        pollTimer = null;
        allResults = state.results || [];
        updateProgress(state);
        renderBrandStatuses(state.brandStatuses || []);
        updateUI('done');
      } else if (state.status === 'stopped') {
        clearInterval(pollTimer);
        pollTimer = null;
        allResults = state.results || [];
        updateUI('stopped');
        renderBrandStatuses(state.brandStatuses || []);
      } else if (state.status === 'error') {
        clearInterval(pollTimer);
        pollTimer = null;
        updateUI('done');
      }
    });
  }, POLL_INTERVAL_MS);
}

startBtn.addEventListener('click', async () => {
  if (pollTimer) return;
  startScraping();
});

// Enter 开始采集，Ctrl+Enter 开始采集
brandListTextarea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    startScraping();
  }
});

// 实时显示品牌数
brandListTextarea.addEventListener('input', updateBrandCount);

function parseBrands(text) {
  return text.split(/[\n\t]/)
    .map(b => b.trim())
    .filter(b => b.length > 0);
}

const STATUS_LABELS = {
  pending: '等待中',
  running: '采集中',
  success: '成功',
  no_data: '无数据',
  failed: '取数失败',
};

function renderBrandStatuses(brandStatuses) {
  const list = brandStatuses || [];
  if (list.length === 0) {
    brandStatusList.classList.add('hidden');
    brandListTextarea.classList.remove('hidden');
    return;
  }
  brandStatusList.innerHTML = list.map(({ brand, status }) => {
    const cls = status || 'pending';
    return `<div class="brand-status-row ${cls}">
      <span class="brand-status-name">${escapeHtml(brand)}</span>
      <span class="badge brand-status-badge">${STATUS_LABELS[cls] || cls}</span>
    </div>`;
  }).join('');
  brandStatusList.classList.remove('hidden');
  brandListTextarea.classList.add('hidden');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function updateBrandCount() {
  const brands = parseBrands(brandListTextarea.value);
  const channelsPerBrand = 3; // 全部 + 淘宝全部 + 天猫
  if (brands.length > 0) {
    brandCount.textContent = brands.length + ' 个品牌 × ' + channelsPerBrand + ' 渠道 = ' + (brands.length * channelsPerBrand) + ' 条';
  } else {
    brandCount.textContent = '';
  }
}

async function startScraping() {
  if (pollTimer) return;

  const brandsText = brandListTextarea.value.trim();

  if (!brandsText) return;

  const brands = parseBrands(brandsText);

  if (brands.length === 0) return;

  // 保存设置
  chrome.storage.local.set({ savedBrands: brandsText });

  // 初始化状态
  const state = {
    status: 'running',
    completed: 0,
    total: brands.length,
    current: '',
    results: []
  };
  chrome.storage.local.set({ scraperState: state });

  updateUI('running');
  startPolling();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.url.includes('art.nint.com')) {
      chrome.storage.local.set({ scraperState: { status: 'error', error: '非 Nint 页面' } });
      updateUI('idle');
      return;
    }
    chrome.tabs.sendMessage(tab.id, {
      action: 'startScraping',
      brands: brands
    });
  } catch (err) {
    updateUI('idle');
  }
}

resetBtn.addEventListener('click', () => {
  brandListTextarea.value = '';
  updateBrandCount();
  allResults = [];
  chrome.storage.local.remove(['savedBrands', 'scraperState']);
  updateUI('idle');
  statusMessage.classList.add('hidden');
  progressFill.style.width = '0%';
  progressText.textContent = '0 / 0';
});

stopBtn.addEventListener('click', async () => {
  chrome.storage.local.get(['scraperState'], (data) => {
    const prev = data.scraperState || {};
    chrome.storage.local.set({
      scraperState: { ...prev, status: 'stopped', current: '', pendingTask: null }
    });
  });
  updateUI('stopped');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, { action: 'stopScraping' });
  } catch (err) {
    console.warn('停止消息发送失败:', err.message);
  }
});

exportBtn.addEventListener('click', () => {
  if (allResults.length === 0) return;

  // 收集所有唯一的月份列名
  const monthKeys = new Set();
  allResults.forEach(r => Object.keys(r).forEach(k => {
    if (k !== 'channel' && k !== 'brand' && k !== 'category' && k !== 'priceBand') monthKeys.add(k);
  }));
  const sortedMonths = Array.from(monthKeys).sort();

  // 构建 CSV
  const headers = ['类目', '渠道', '品牌名称', '价格带', ...sortedMonths];
  const rows = allResults.map(r => {
    const cells = [
      r.category || '',
      r.channel,
      r.brand,
      r.priceBand || '',
      ...sortedMonths.map(m => r[m] || '')
    ];
    return cells.map(c => {
      const str = String(c);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    }).join(',');
  });

  const csv = '﻿' + headers.join(',') + '\n' + rows.join('\n'); // BOM for Excel
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const brandCount = new Set(allResults.map(r => r.brand)).size;
  a.download = 'QBT_' + new Date().toISOString().slice(0, 10) + '_' + brandCount + 'brands.csv';
  a.click();
  URL.revokeObjectURL(url);
});
