// popup.js — 弹窗逻辑

const brandListTextarea = document.getElementById('brandList');
const brandCount = document.getElementById('brandCount');
const clearBtn = document.getElementById('clearBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const exportBtn = document.getElementById('exportBtn');
const progressSection = document.getElementById('progressSection');
const progressText = document.getElementById('progressText');
const currentBrand = document.getElementById('currentBrand');
const progressFill = document.getElementById('progressFill');
const statusMessage = document.getElementById('statusMessage');

const POLL_INTERVAL_MS = 500;

let allResults = [];
let pollTimer = null;
let polling = false;

// 恢复上次保存的设置
chrome.storage.local.get(['savedBrands', 'scraperState'], (data) => {
  if (data.savedBrands) { brandListTextarea.value = data.savedBrands; updateBrandCount(); }
  if (data.scraperState && data.scraperState.status === 'running') {
    updateUI('running');
    startPolling();
  } else if (data.scraperState && data.scraperState.status === 'done') {
    allResults = data.scraperState.results || [];
    updateUI('done');
  }
});

function updateUI(status) {
  switch (status) {
    case 'idle':
      startBtn.classList.remove('hidden');
      stopBtn.classList.add('hidden');
      exportBtn.classList.add('hidden');
      progressSection.classList.add('hidden');
      brandListTextarea.disabled = false;
      startBtn.disabled = false;
      break;
    case 'running':
      startBtn.disabled = true;
      startBtn.textContent = '采集中...';
      stopBtn.classList.remove('hidden');
      exportBtn.classList.add('hidden');
      progressSection.classList.remove('hidden');
      brandListTextarea.disabled = true;
      break;
    case 'done':
      startBtn.classList.remove('hidden');
      startBtn.textContent = '开始采集';
      startBtn.disabled = false;
      stopBtn.classList.add('hidden');
      exportBtn.classList.remove('hidden');
      progressSection.classList.remove('hidden');
      brandListTextarea.disabled = false;
      break;
    case 'stopped':
      startBtn.classList.remove('hidden');
      startBtn.textContent = '开始采集';
      startBtn.disabled = false;
      stopBtn.classList.add('hidden');
      exportBtn.classList.remove('hidden');
      brandListTextarea.disabled = false;
      break;
  }
}

function showStatus(message, type) {
  statusMessage.textContent = message;
  statusMessage.className = 'status-message ' + type;
  statusMessage.classList.remove('hidden');
}

function updateProgress(progress) {
  const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  progressText.textContent = `${progress.completed} / ${progress.total}`;
  currentBrand.textContent = (progress.current || '') + (progress.currentChannel ? ' · ' + progress.currentChannel : '');
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
      } else if (state.status === 'done') {
        clearInterval(pollTimer);
        pollTimer = null;
        allResults = state.results || [];
        updateProgress(state);
        updateUI('done');
        const errors = state.errors || [];
        if (errors.length > 0) {
          const errorBrands = [...new Set(errors.map(e => e.brand))].join('、');
          showStatus(`完成 • ${allResults.length} 条数据 | ⚠ ${errorBrands} 无数据`, 'error');
        } else {
          showStatus(`采集完成 • ${allResults.length} 条数据`, 'success');
        }
      } else if (state.status === 'stopped') {
        clearInterval(pollTimer);
        pollTimer = null;
        allResults = state.results || [];
        updateUI('stopped');
        showStatus('采集已停止', 'info');
      } else if (state.status === 'error') {
        clearInterval(pollTimer);
        pollTimer = null;
        updateUI('done');
        showStatus(state.error || '采集出错', 'error');
      }
    });
  }, POLL_INTERVAL_MS);
}

startBtn.addEventListener('click', async () => {
  if (pollTimer) { showStatus('已在采集中', 'info'); return; }
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

// 一键清空
clearBtn.addEventListener('click', () => {
  brandListTextarea.value = '';
  updateBrandCount();
  brandListTextarea.focus();
});

function parseBrands(text) {
  return text.split(/[\n\t]/)
    .map(b => b.trim())
    .filter(b => b.length > 0);
}

function updateBrandCount() {
  const brands = parseBrands(brandListTextarea.value);
  brandCount.textContent = brands.length > 0 ? brands.length + ' 个品牌' : '';
  clearBtn.classList.toggle('visible', brandListTextarea.value.length > 0);
}

async function startScraping() {
  if (pollTimer) { showStatus('已在采集中', 'info'); return; }

  const brandsText = brandListTextarea.value.trim();

  if (!brandsText) { showStatus('请输入品牌列表', 'error'); return; }

  const brands = parseBrands(brandsText);

  if (brands.length === 0) { showStatus('品牌列表为空', 'error'); return; }

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
  showStatus('正在初始化...', 'info');
  startPolling();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.url.includes('art.nint.com')) {
      showStatus('请在 art.nint.com 页面上使用此扩展', 'error');
      chrome.storage.local.set({ scraperState: { status: 'error', error: '非 Nint 页面' } });
      updateUI('idle');
      return;
    }
    chrome.tabs.sendMessage(tab.id, {
      action: 'startScraping',
      brands: brands
    });
  } catch (err) {
    showStatus('通信失败: ' + err.message, 'error');
    updateUI('idle');
  }
});

stopBtn.addEventListener('click', async () => {
  chrome.storage.local.set({
    scraperState: { status: 'stopped', completed: 0, total: 0, current: '', results: allResults }
  });
  updateUI('stopped');
  showStatus('正在停止...', 'info');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, { action: 'stopScraping' });
  } catch (err) {
    console.warn('停止消息发送失败:', err.message);
  }
});

exportBtn.addEventListener('click', () => {
  if (allResults.length === 0) {
    showStatus('没有数据可导出', 'error');
    return;
  }

  // 收集所有唯一的月份列名
  const monthKeys = new Set();
  allResults.forEach(r => Object.keys(r).forEach(k => {
    if (k !== 'channel' && k !== 'brand' && k !== 'category') monthKeys.add(k);
  }));
  const sortedMonths = Array.from(monthKeys).sort();

  // 构建 CSV
  const headers = ['渠道', '品牌名称', ...sortedMonths];
  const rows = allResults.map(r => {
    const cells = [
      r.channel,
      r.brand,
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

  showStatus('CSV 已下载', 'success');
});
