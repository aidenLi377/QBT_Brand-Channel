# QBT 控盘数据采集 Chrome 扩展 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 Chrome 扩展，用户输入品牌列表后在 Nint 页面上自动逐个检索品牌数据（全部+淘宝全部），导出 CSV。

**Architecture:** Popup（用户交互）+ Content Script（DOM 操控）+ Background（Service Worker 桥接）。Popup 通过 `chrome.tabs.sendMessage` 发送品牌列表给 Content Script，Content Script 顺序处理每个品牌，通过 `chrome.storage.local` 持久化进度和结果，Popup 轮询展示进度并支持 CSV 导出。

**Tech Stack:** Chrome Extension Manifest V3, Vanilla JavaScript, HTML/CSS

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `manifest.json` | MV3 配置：权限、content_scripts、action、background |
| `popup.html` | 弹窗 UI：URL 输入、品牌列表输入、进度条、操作按钮 |
| `popup.js` | 弹窗逻辑：发送指令、轮询进度、渲染状态、导出 CSV |
| `popup.css` | 弹窗样式 |
| `content.js` | 核心：DOM 操控自动化 + 表格解析 |
| `background.js` | Service Worker：消息中继、storage 管理 |

---

### Task 1: manifest.json

**Files:**
- Create: `E:\QBT控盘插件\manifest.json`

- [ ] **Step 1: 创建 manifest.json**

```json
{
  "manifest_version": 3,
  "name": "QBT 控盘数据采集",
  "version": "1.0.0",
  "description": "自动检索 Nint 品牌数据，支持批量品牌采集并导出 CSV",
  "permissions": ["activeTab", "scripting", "storage"],
  "host_permissions": ["https://art.nint.com/*"],
  "action": {
    "default_popup": "popup.html",
    "default_title": "QBT 控盘数据采集"
  },
  "content_scripts": [
    {
      "matches": ["https://art.nint.com/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "background": {
    "service_worker": "background.js"
  }
}
```

- [ ] **Step 2: 在 chrome://extensions 加载扩展，确认无报错**

---

### Task 2: background.js — Service Worker

**Files:**
- Create: `E:\QBT控盘插件\background.js`

- [ ] **Step 1: 创建 background.js**

```js
// background.js — 轻量 Service Worker
// 负责中继 popup 和 content script 之间的消息
// 以及管理 chrome.storage.local 中的数据持久化

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getState') {
    chrome.storage.local.get(['scraperState'], (result) => {
      sendResponse(result.scraperState || { status: 'idle', progress: 0, total: 0, results: [] });
    });
    return true; // 异步响应
  }
});
```

- [ ] **Step 2: 在 chrome://extensions 重新加载，确认 Service Worker 正常启动**

---

### Task 3: popup.html — 弹窗界面

**Files:**
- Create: `E:\QBT控盘插件\popup.html`

- [ ] **Step 1: 创建 popup.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>QBT 控盘数据采集</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div class="container">
    <h1 class="title">QBT 控盘数据采集</h1>

    <div class="section">
      <label class="label" for="targetUrl">目标 URL</label>
      <input type="text" id="targetUrl" class="input"
             value="https://art.nint.com/stat-ali-new?cid=50010788&site=ali&pos=%E8%87%AA%E5%AE%9A%E4%B9%89%E4%BB%B7%E6%A0%BC%E6%AE%B5%E5%88%86%E6%9E%90&rcid=2011010113&zdy_cid=#fold_line"
             placeholder="输入 Nint 目标页面 URL">
    </div>

    <div class="section">
      <label class="label" for="brandList">品牌列表（一行一个）</label>
      <textarea id="brandList" class="textarea" rows="8"
                placeholder="品牌A&#10;品牌B&#10;品牌C"></textarea>
    </div>

    <div id="progressSection" class="section hidden">
      <div class="progress-info">
        <span id="progressText">进度: 0/0</span>
        <span id="currentBrand"></span>
      </div>
      <div class="progress-bar">
        <div id="progressFill" class="progress-fill" style="width: 0%"></div>
      </div>
    </div>

    <div class="actions">
      <button id="startBtn" class="btn btn-primary">开始采集</button>
      <button id="stopBtn" class="btn btn-danger hidden">停止</button>
      <button id="exportBtn" class="btn btn-success hidden">导出 CSV</button>
    </div>

    <div id="statusMessage" class="status-message hidden"></div>
  </div>

  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: 在 chrome://extensions 重新加载，点击扩展图标确认弹窗显示正常**

---

### Task 4: popup.css — 弹窗样式

**Files:**
- Create: `E:\QBT控盘插件\popup.css`

- [ ] **Step 1: 创建 popup.css**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  width: 420px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  color: #1a1a2e;
  background: #f8f9fc;
}

.container { padding: 20px; }

.title {
  font-size: 18px;
  font-weight: 700;
  color: #1a56db;
  margin-bottom: 16px;
  text-align: center;
}

.section { margin-bottom: 14px; }

.label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: #4a5568;
  margin-bottom: 6px;
}

.input, .textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
  background: #fff;
  transition: border-color 0.2s;
}

.input:focus, .textarea:focus {
  outline: none;
  border-color: #1a56db;
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.1);
}

.textarea { resize: vertical; }

.progress-info {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 6px;
}

.progress-bar {
  height: 6px;
  background: #e5e7eb;
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #1a56db, #3b82f6);
  border-radius: 3px;
  transition: width 0.3s;
}

.actions { display: flex; gap: 8px; margin-top: 16px; }

.btn {
  flex: 1;
  padding: 10px 12px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary { background: #1a56db; color: #fff; }
.btn-primary:hover { background: #1d4ed8; }
.btn-primary:disabled { background: #94a3b8; cursor: not-allowed; }

.btn-danger { background: #ef4444; color: #fff; }
.btn-danger:hover { background: #dc2626; }

.btn-success { background: #10b981; color: #fff; }
.btn-success:hover { background: #059669; }

.status-message {
  margin-top: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  text-align: center;
}

.status-message.success { background: #d1fae5; color: #065f46; }
.status-message.error { background: #fee2e2; color: #991b1b; }
.status-message.info { background: #dbeafe; color: #1e40af; }

.hidden { display: none !important; }
```

- [ ] **Step 2: 刷新扩展弹窗，确认样式生效**

---

### Task 5: popup.js — 弹窗逻辑（UI 交互 + 消息通信）

**Files:**
- Create: `E:\QBT控盘插件\popup.js`

- [ ] **Step 1: 创建 popup.js — DOM 元素引用和初始化**

```js
// popup.js — 弹窗逻辑

const urlInput = document.getElementById('targetUrl');
const brandListTextarea = document.getElementById('brandList');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const exportBtn = document.getElementById('exportBtn');
const progressSection = document.getElementById('progressSection');
const progressText = document.getElementById('progressText');
const currentBrand = document.getElementById('currentBrand');
const progressFill = document.getElementById('progressFill');
const statusMessage = document.getElementById('statusMessage');

let allResults = [];
let pollTimer = null;

// 恢复上次保存的设置
chrome.storage.local.get(['savedUrl', 'savedBrands', 'scraperState'], (data) => {
  if (data.savedUrl) urlInput.value = data.savedUrl;
  if (data.savedBrands) brandListTextarea.value = data.savedBrands;
  if (data.scraperState && data.scraperState.status === 'running') {
    updateUI('running');
    startPolling();
  } else if (data.scraperState && data.scraperState.status === 'done') {
    allResults = data.scraperState.results || [];
    updateUI('done');
  }
});
```

- [ ] **Step 2: 添加 updateUI 和 showStatus 辅助函数**

```js
function updateUI(status) {
  switch (status) {
    case 'idle':
      startBtn.classList.remove('hidden');
      stopBtn.classList.add('hidden');
      exportBtn.classList.add('hidden');
      progressSection.classList.add('hidden');
      urlInput.disabled = false;
      brandListTextarea.disabled = false;
      startBtn.disabled = false;
      break;
    case 'running':
      startBtn.disabled = true;
      startBtn.textContent = '采集中...';
      stopBtn.classList.remove('hidden');
      exportBtn.classList.add('hidden');
      progressSection.classList.remove('hidden');
      urlInput.disabled = true;
      brandListTextarea.disabled = true;
      break;
    case 'done':
      startBtn.classList.remove('hidden');
      startBtn.textContent = '开始采集';
      startBtn.disabled = false;
      stopBtn.classList.add('hidden');
      exportBtn.classList.remove('hidden');
      progressSection.classList.remove('hidden');
      urlInput.disabled = false;
      brandListTextarea.disabled = false;
      break;
    case 'stopped':
      startBtn.classList.remove('hidden');
      startBtn.textContent = '开始采集';
      startBtn.disabled = false;
      stopBtn.classList.add('hidden');
      exportBtn.classList.remove('hidden');
      urlInput.disabled = false;
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
  progressText.textContent = `进度: ${progress.completed}/${progress.total}`;
  currentBrand.textContent = progress.current || '';
  progressFill.style.width = pct + '%';
  progressSection.classList.remove('hidden');
}
```

- [ ] **Step 3: 添加轮询逻辑**

```js
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    chrome.storage.local.get(['scraperState'], (data) => {
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
        showStatus(`采集完成！共 ${allResults.length} 条数据`, 'success');
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
  }, 500);
}
```

- [ ] **Step 4: 添加"开始采集"按钮处理**

```js
startBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  const brandsText = brandListTextarea.value.trim();

  if (!url) { showStatus('请输入目标 URL', 'error'); return; }
  if (!brandsText) { showStatus('请输入品牌列表', 'error'); return; }

  const brands = brandsText.split('\n')
    .map(b => b.trim())
    .filter(b => b.length > 0);

  if (brands.length === 0) { showStatus('品牌列表为空', 'error'); return; }

  // 保存设置
  chrome.storage.local.set({ savedUrl: url, savedBrands: brandsText });

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
    chrome.tabs.sendMessage(tab.id, {
      action: 'startScraping',
      brands: brands
    });
  } catch (err) {
    showStatus('通信失败: ' + err.message, 'error');
    updateUI('idle');
  }
});
```

- [ ] **Step 5: 添加"停止"按钮处理**

```js
stopBtn.addEventListener('click', async () => {
  chrome.storage.local.set({
    scraperState: { status: 'stopped', completed: 0, total: 0, current: '', results: allResults }
  });
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, { action: 'stopScraping' });
  } catch (err) { /* ignore */ }
});
```

- [ ] **Step 6: 添加"导出 CSV"按钮处理**

```js
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
  const headers = ['渠道', '品牌名称', '类别名称', ...sortedMonths];
  const rows = allResults.map(r => {
    const cells = [
      r.channel,
      r.brand,
      r.category,
      ...sortedMonths.map(m => r[m] || '')
    ];
    return cells.map(c => {
      // CSV 转义：如果包含逗号、引号或换行，用引号包裹
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
  a.download = 'qbt_data_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);

  showStatus('CSV 已下载', 'success');
});
```

- [ ] **Step 7: 刷新扩展，确认弹窗交互正常（按钮点击、状态切换）**

---

### Task 6: content.js — DOM 自动化核心

**Files:**
- Create: `E:\QBT控盘插件\content.js`

- [ ] **Step 1: 创建 content.js — 消息监听和主控流程**

```js
// content.js — Nint 页面 DOM 操控自动化

let stopFlag = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startScraping') {
    stopFlag = false;
    scrapeAllBrands(message.brands);
  } else if (message.action === 'stopScraping') {
    stopFlag = true;
  }
});

async function scrapeAllBrands(brands) {
  const results = [];
  for (let i = 0; i < brands.length; i++) {
    if (stopFlag) break;
    const brand = brands[i];
    updateState({ completed: i, current: brand });

    try {
      // 渠道1: 全部
      const allData = await scrapeChannel(brand, 'all');
      if (allData) {
        allData.forEach(row => results.push({ channel: '全部', brand, ...row }));
      }

      // 渠道2: 淘宝全部
      const taobaoData = await scrapeChannel(brand, 'taobao');
      if (taobaoData) {
        taobaoData.forEach(row => results.push({ channel: '淘宝全部', brand, ...row }));
      }
    } catch (err) {
      console.error(`品牌 "${brand}" 采集失败:`, err);
    }
  }

  updateState({
    status: stopFlag ? 'stopped' : 'done',
    completed: brands.length,
    current: '',
    results: [...(await getState()).results, ...results]
  });
}
```

- [ ] **Step 2: 添加 scrapeChannel 函数 — 单渠道采集**

```js
async function scrapeChannel(brand, channel) {
  // Step 1: 确保"自定义"已选中
  ensureCustomSelected();

  // Step 2: 输入品牌名称
  inputBrandName(brand);

  // Step 3: 设置查看范围
  if (channel === 'all') {
    ensureCheckboxSelected('全部');
  } else if (channel === 'taobao') {
    ensureCheckboxDeselected('全部');
    ensureCheckboxSelected('淘宝全部');
  }

  // Step 4: 点击检索并等待
  clickSearch();
  await waitForTableReload();

  // Step 5: 解析表格
  return parseTable();
}
```

- [ ] **Step 3: 添加 ensureCustomSelected — 确保"自定义"选中**

```js
function ensureCustomSelected() {
  // XPath: /html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[2]/form/table/tbody/tr[2]/td[2]/div/select
  const select = getElementByXPath(
    '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[2]/form/table/tbody/tr[2]/td[2]/div/select'
  );
  if (!select) return;

  const selectedOption = select.options[select.selectedIndex];
  if (selectedOption && selectedOption.text.includes('自定义')) return;

  // 选第一个选项（自定义在列表顶部）
  select.selectedIndex = 0;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}
```

- [ ] **Step 4: 添加 inputBrandName — 输入品牌名称**

```js
function inputBrandName(brand) {
  // XPath: /html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[2]/form/table/tbody/tr[2]/td[2]/div/input
  const input = getElementByXPath(
    '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[2]/form/table/tbody/tr[2]/td[2]/div/input'
  );
  if (!input) return;

  // 清空并输入新值
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.value = brand;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
```

- [ ] **Step 5: 添加 ensureCheckboxSelected — 确保复选框选中**

```js
function ensureCheckboxSelected(labelText) {
  // 匹配包含指定文本的 label 元素
  const labels = document.querySelectorAll('label');
  let targetLabel = null;
  for (const label of labels) {
    if (label.textContent.trim() === labelText) {
      targetLabel = label;
      break;
    }
  }
  if (!targetLabel) return;

  // 检查是否已选中：查找关联的 input 或检查 ::after 伪元素
  const input = targetLabel.querySelector('input') || targetLabel.previousElementSibling;
  if (input && (input.type === 'checkbox' || input.type === 'radio') && input.checked) return;

  // 检查 ::after 伪元素 — 通过 computed style
  const afterStyle = window.getComputedStyle(targetLabel, '::after');
  if (afterStyle && afterStyle.content && afterStyle.content !== 'none') return;

  // 未选中，点击
  targetLabel.click();
}
```

- [ ] **Step 6: 添加 ensureCheckboxDeselected — 取消复选框选中**

```js
function ensureCheckboxDeselected(labelText) {
  const labels = document.querySelectorAll('label');
  let targetLabel = null;
  for (const label of labels) {
    if (label.textContent.trim() === labelText) {
      targetLabel = label;
      break;
    }
  }
  if (!targetLabel) return;

  const input = targetLabel.querySelector('input') || targetLabel.previousElementSibling;
  if (input && (input.type === 'checkbox' || input.type === 'radio') && !input.checked) return;

  const afterStyle = window.getComputedStyle(targetLabel, '::after');
  if (!afterStyle || !afterStyle.content || afterStyle.content === 'none') return;

  // 已选中，点击取消
  targetLabel.click();
}
```

- [ ] **Step 7: 添加 clickSearch — 点击检索按钮**

```js
function clickSearch() {
  // XPath: /html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[2]/form/div[2]/button
  const btn = getElementByXPath(
    '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[2]/form/div[2]/button'
  );
  if (btn) btn.click();
}
```

- [ ] **Step 8: 添加 waitForTableReload — 等待页面加载**

```js
function waitForTableReload(timeout = 30000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const check = () => {
      if (stopFlag) { resolve(); return; }
      if (Date.now() - startTime > timeout) { resolve(); return; }

      // 检查表格是否已重新加载（colgroup 元素存在且有数据行）
      const colgroup = getElementByXPath(
        '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[5]/div/div[2]/div[1]/div/div[2]/div[2]/div[3]/div[1]/div[1]/div[1]/div[2]/div/table/colgroup'
      );
      if (colgroup) {
        const table = colgroup.closest('table');
        const rows = table.querySelectorAll('tbody tr');
        if (rows.length > 2) {
          resolve();
          return;
        }
      }
      setTimeout(check, 500);
    };
    check();
  });
}
```

- [ ] **Step 9: 添加 parseTable — 解析表格数据**

```js
function parseTable() {
  const colgroup = getElementByXPath(
    '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[5]/div/div[2]/div[1]/div/div[2]/div[2]/div[3]/div[1]/div[1]/div[1]/div[2]/div/table/colgroup'
  );
  if (!colgroup) return [];

  const table = colgroup.closest('table');
  const tbody = table.querySelector('tbody');
  if (!tbody) return [];

  const allRows = Array.from(tbody.querySelectorAll('tr'));

  // 移除最后一行（总计）
  const dataRows = allRows.slice(0, -1);

  // 跳过第二行（销量子表头，index=1）
  const filteredRows = dataRows.filter((row, index) => index !== 1);

  // 获取表头中的月份列名（第一行）
  const headerCells = allRows[0] ? Array.from(allRows[0].querySelectorAll('th, td')) : [];
  const monthHeaders = headerCells.slice(1, -1).map(cell => cell.textContent.trim());

  const results = [];
  for (const row of filteredRows) {
    const cells = Array.from(row.querySelectorAll('td'));

    // 移除最后一列（总计）
    const dataCells = cells.slice(0, -1);

    if (dataCells.length === 0) continue;

    const categoryName = dataCells[0] ? dataCells[0].textContent.trim() : '';

    const rowData = { category: categoryName };
    monthHeaders.forEach((header, idx) => {
      const cell = dataCells[idx + 1];
      rowData[header] = cell ? cell.textContent.trim() : '';
    });

    results.push(rowData);
  }

  return results;
}
```

- [ ] **Step 10: 添加辅助函数**

```js
function getElementByXPath(xpath) {
  const result = document.evaluate(
    xpath, document, null,
    XPathResult.FIRST_ORDERED_NODE_TYPE, null
  );
  return result.singleNodeValue;
}

function getState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['scraperState'], (data) => {
      resolve(data.scraperState || { status: 'idle', completed: 0, total: 0, current: '', results: [] });
    });
  });
}

function updateState(partial) {
  chrome.storage.local.get(['scraperState'], (data) => {
    const state = { ...(data.scraperState || {}), ...partial };
    chrome.storage.local.set({ scraperState: state });
  });
}
```

- [ ] **Step 11: 在 chrome://extensions 重新加载，准备端到端测试**

---

### Task 7: 端到端验证

**说明:** 在 Nint 目标页面上实际测试完整的采集流程。

- [ ] **Step 1: 打开目标 URL**

```
在 Chrome 中打开:
https://art.nint.com/stat-ali-new?cid=50010788&site=ali&pos=%E8%87%AA%E5%AE%9A%E4%B9%89%E4%BB%B7%E6%A0%BC%E6%AE%B5%E5%88%86%E6%9E%90&rcid=2011010113&zdy_cid=#fold_line
```

- [ ] **Step 2: 点击扩展图标，输入测试品牌**

在弹窗中输入 1-2 个测试品牌，点击"开始采集"，观察：
- 下拉框是否自动切换到"自定义"
- 品牌名是否自动填入输入框
- "全部"/"淘宝全部"是否正确切换
- 检索按钮是否自动点击
- 表格数据是否正确解析

- [ ] **Step 3: 验证 CSV 导出**

采集完成后点击"导出 CSV"，用 Excel 打开 CSV 文件，确认：
- 列：渠道, 品牌名称, 类别名称, 月份...
- 每个品牌有"全部"和"淘宝全部"两套数据
- 无总计行、无总计列、无销量子表头行

- [ ] **Step 4: 测试停止功能**

在采集过程中点击"停止"，确认采集立即停止，已有数据可导出。

- [ ] **Step 5: 测试错误恢复**

输入一个不存在的品牌名，确认：
- 不会崩溃
- 继续处理下一个品牌
- 有数据的结果正常导出
