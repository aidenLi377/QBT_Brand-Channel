// content.js — Nint 页面 DOM 操控自动化

let stopFlag = false;

// === 初始化：检查是否有待处理任务（页面跳转后恢复） ===
(async function init() {
  const state = await getState();
  if (state && state.pendingTask) {
    stopFlag = state.pendingTask.stopFlag || false;
    updateBadge(state.completed || 0, state.total || 0);
    // 等待结果表格出现
    const ready = await waitForResultTable(15000);
    if (!ready) {
      console.warn('[QBT] 页面加载后未检测到结果表格，2秒后重试...');
      await sleep(2000);
      await waitForResultTable(10000);
    }
    await resumeAfterReload(state.pendingTask);
  }
})();

async function resumeAfterReload(task) {
  console.log('[QBT] 页面跳转后恢复, 渠道:', task.channel, '品牌:', task.brand);

  // 直接从 DOM 获取表格数据（innerText → TSV）
  const tsv = getTableData();
  const data = parseTSV(tsv);
  let results = task.results || [];

  if (data && data.length > 0) {
    data.forEach(row => results.push({ channel: task.channel, brand: task.brand, ...row }));
    console.log('[QBT] 成功解析', data.length, '行数据, 累计:', results.length);
  } else {
    console.warn('[QBT] 未解析到数据，继续下一步');
  }

  // 判断下一步
  let nextChannel, nextBrandIdx;

  if (task.channel === 'all') {
    nextChannel = 'taobao';
    nextBrandIdx = task.brandIndex;
  } else {
    nextChannel = 'all';
    nextBrandIdx = task.brandIndex + 1;
  }

  // 检查是否全部完成
  if (nextBrandIdx >= task.brands.length || stopFlag) {
    updateState({
      status: stopFlag ? 'stopped' : 'done',
      completed: task.totalBrands,
      total: task.totalBrands,
      current: '',
      results: results,
      pendingTask: null
    });
    updateBadge(task.totalBrands, task.totalBrands);
    return;
  }

  const nextBrand = task.brands[nextBrandIdx];

  updateState({
    completed: nextBrandIdx,
    total: task.totalBrands,
    current: nextBrand,
    results: results
  });
  updateBadge(nextBrandIdx, task.totalBrands);

  await setupAndSearch(nextBrand, nextChannel, nextBrandIdx, task.brands, task.totalBrands, results);
}

// === 消息监听 ===
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startScraping') {
    stopFlag = false;
    sendResponse({ accepted: true });
    startNewScraping(message.brands);
  } else if (message.action === 'stopScraping') {
    stopFlag = true;
    updateState({ stopFlag: true });
    updateBadge(0, 0);
    sendResponse({ accepted: true });
  }
  return true;
});

async function startNewScraping(brands) {
  const brand = brands[0];
  updateBadge(0, brands.length);

  updateState({
    status: 'running',
    completed: 0,
    total: brands.length,
    current: brand,
    results: [],
    brands: brands
  });

  await setupAndSearch(brand, 'all', 0, brands, brands.length, []);
}

// === 设置页面并点击检索 ===
async function setupAndSearch(brand, channel, brandIndex, brands, totalBrands, results) {
  ensureCustomSelected();
  inputBrandName(brand);

  if (channel === 'all') {
    ensureCheckboxSelected('全部');
  } else if (channel === 'taobao') {
    ensureCheckboxDeselected('全部');
    ensureCheckboxSelected('淘宝全部');
  }

  ensureSortOrderSelected('销售额');

  updateState({
    pendingTask: {
      brand: brand,
      channel: channel,
      brandIndex: brandIndex,
      brands: brands,
      totalBrands: totalBrands,
      results: results,
      stopFlag: stopFlag
    }
  });

  clickSearch();
}

// === 下拉框操作 ===
function ensureCustomSelected() {
  const select = getElementByXPath(
    '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[2]/form/table/tbody/tr[2]/td[2]/div/select'
  );
  if (!select) { console.warn('[QBT] 未找到"自定义"下拉框元素'); return; }

  const selectedOption = select.options[select.selectedIndex];
  if (selectedOption && selectedOption.text.includes('自定义')) return;

  select.selectedIndex = 0;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

// === 品牌输入 ===
function inputBrandName(brand) {
  const input = getElementByXPath(
    '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[2]/form/table/tbody/tr[2]/td[2]/div/input'
  );
  if (!input) { console.warn('[QBT] 未找到品牌输入框元素'); return; }

  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.value = brand;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

// === 复选框操作 ===
function ensureCheckboxSelected(labelText) {
  const targetLabel = findLabelByText(labelText);
  if (!targetLabel) { console.warn('[QBT] 未找到"' + labelText + '"复选框元素'); return; }

  const input = targetLabel.querySelector('input') || targetLabel.previousElementSibling;
  if (input && (input.type === 'checkbox' || input.type === 'radio') && input.checked) return;

  const afterStyle = window.getComputedStyle(targetLabel, '::after');
  if (afterStyle && afterStyle.content && afterStyle.content !== 'none') return;

  targetLabel.click();
}

function ensureCheckboxDeselected(labelText) {
  const targetLabel = findLabelByText(labelText);
  if (!targetLabel) { console.warn('[QBT] 未找到"' + labelText + '"复选框元素'); return; }

  const input = targetLabel.querySelector('input') || targetLabel.previousElementSibling;
  if (input && (input.type === 'checkbox' || input.type === 'radio') && !input.checked) return;

  const afterStyle = window.getComputedStyle(targetLabel, '::after');
  if (!afterStyle || !afterStyle.content || afterStyle.content === 'none') return;

  targetLabel.click();
}

// === 排序方式操作 ===
function ensureSortOrderSelected(labelText) {
  let targetLabel = getElementByXPath(
    '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[2]/form/table/tbody/tr[9]/td[2]/label[2]'
  );
  if (!targetLabel) {
    targetLabel = findLabelByText(labelText);
  }
  if (!targetLabel) { console.warn('[QBT] 未找到"' + labelText + '"排序方式元素'); return; }

  const afterStyle = window.getComputedStyle(targetLabel, '::after');
  if (afterStyle && afterStyle.content && afterStyle.content !== 'none') return;

  targetLabel.click();
}

function findLabelByText(text) {
  const labels = document.querySelectorAll('label');
  for (const label of labels) {
    if (label.textContent.trim() === text) return label;
  }
  return null;
}

// === 检索按钮 ===
function clickSearch() {
  const btn = getElementByXPath(
    '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[2]/form/div[2]/button'
  );
  if (btn) btn.click();
  else console.warn('[QBT] 未找到检索按钮');
}

// === 等待结果表格出现 ===
function waitForResultTable(timeout = 15000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const check = () => {
      if (Date.now() - startTime > timeout) { resolve(false); return; }
      const tsv = getTableData();
      if (tsv && tsv.trim().length > 0) { console.log('[QBT] 结果表格已出现'); resolve(true); return; }
      setTimeout(check, 500);
    };
    check();
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// === 直接从 DOM 获取表格数据（遍历 tr/td 构建 TSV） ===
function getTableData() {
  // 在结果区域找表格
  const resultArea = getElementByXPath(
    '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[5]'
  );
  if (!resultArea) { console.warn('[QBT] 未找到结果区域'); return ''; }

  // 查找所有表格，取第一个有数据的
  const tables = resultArea.querySelectorAll('table');
  let bestTable = null;
  let maxCells = 0;
  for (const t of tables) {
    const cells = t.querySelectorAll('td, th');
    if (cells.length > maxCells) {
      maxCells = cells.length;
      bestTable = t;
    }
  }

  if (!bestTable) { console.warn('[QBT] 未找到数据表格'); return ''; }

  // 遍历 tr 元素读取每个单元格
  const trs = bestTable.querySelectorAll('tr');
  const rows = [];
  for (const tr of trs) {
    const cells = tr.querySelectorAll('td, th');
    if (cells.length === 0) continue;
    const rowData = Array.from(cells).map(c => c.textContent.trim());
    rows.push(rowData.join('\t'));
  }

  const result = rows.join('\n');
  console.log('[QBT] 表格共', trs.length, '行,', maxCells, '个单元格, TSV长度:', result.length);
  return result;
}

// === 解析 TSV 数据 ===
function parseTSV(tsvText) {
  console.log('[QBT] 原始复制数据:\n', tsvText ? tsvText.substring(0, 200) : '(空)');

  if (!tsvText || tsvText.trim().length === 0) {
    console.warn('[QBT] 复制数据为空');
    return [];
  }

  const lines = tsvText.split(/\r?\n/).filter(line => line.trim().length > 0);
  console.log('[QBT] 共', lines.length, '行');

  if (lines.length < 2) { console.warn('[QBT] 数据行数不足'); return []; }

  const rows = lines.map(line => line.split('\t'));

  // 移除 Row 1（销售额子表头）和最后一行（总计），每行去掉最后一列
  const processedRows = [];
  for (let i = 0; i < rows.length; i++) {
    if (i === 1 || i === rows.length - 1) continue;
    processedRows.push(rows[i].slice(0, -1));
  }

  if (processedRows.length < 2) { console.warn('[QBT] 处理后数据行数不足'); return []; }

  const headerRow = processedRows[0];
  const monthHeaders = headerRow.slice(1);
  console.log('[QBT] 月份列:', monthHeaders);

  const categoryName = getCategoryFromBreadcrumb();
  console.log('[QBT] 类目名称:', categoryName);

  const results = [];
  for (let i = 1; i < processedRows.length; i++) {
    const dataRow = processedRows[i];
    const rowData = { category: categoryName };
    monthHeaders.forEach((header, idx) => {
      rowData[header] = (dataRow[idx + 1] || '').trim();
    });
    results.push(rowData);
  }

  console.log('[QBT] 解析结果:', results);
  return results;
}

// === 从面包屑获取类目名称 ===
function getCategoryFromBreadcrumb() {
  const breadcrumb = getElementByXPath(
    '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[1]/div[1]'
  );
  if (!breadcrumb) { console.warn('[QBT] 未找到面包屑元素'); return ''; }

  const links = breadcrumb.querySelectorAll('a');
  const names = Array.from(links).map(a => a.textContent.trim()).filter(t => t.length > 0);
  return names.length > 0 ? names[names.length - 1] : '';
}

// === 工具函数 ===
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

// === 扩展图标角标 ===
function updateBadge(completed, total) {
  const text = total > 0 ? String(completed) : '';
  chrome.runtime.sendMessage({ type: 'updateBadge', text: text }).catch(() => {});
  if (completed >= total && total > 0) {
    // 完成时用绿色
    chrome.runtime.sendMessage({ type: 'updateBadge', text: '✓', color: '#10b981' }).catch(() => {});
  }
}
