// content.js — Nint 页面 DOM 操控自动化

let stopFlag = false;

// === 初始化：检查是否有待处理任务（页面跳转后恢复） ===
(async function init() {
  const state = await getState();
  if (state && state.pendingTask) {
    stopFlag = state.pendingTask.stopFlag || false;
    // 等待表格加载完成
    const tableReady = await waitForTable(15000);
    if (!tableReady) {
      console.warn('[QBT] 页面加载后未检测到结果表格，2秒后重试...');
      await sleep(2000);
      const retry = await waitForTable(10000);
      if (!retry) {
        console.error('[QBT] 表格加载超时，跳过当前步骤');
        // 仍尝试解析（可能表格结构不同）
      }
    }
    await resumeAfterReload(state.pendingTask);
  }
})();

async function resumeAfterReload(task) {
  console.log('[QBT] 页面跳转后恢复, 渠道:', task.channel, '品牌:', task.brand);

  // 页面刚跳转回来，解析当前表格
  const data = parseTable();
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
    // 刚完成"全部"，现在做"淘宝全部"
    nextChannel = 'taobao';
    nextBrandIdx = task.brandIndex;
  } else {
    // 刚完成"淘宝全部"，移到下一个品牌
    nextChannel = 'all';
    nextBrandIdx = task.brandIndex + 1;
  }

  // 检查是否全部完成
  if (nextBrandIdx >= task.brands.length || stopFlag) {
    updateState({
      status: stopFlag ? 'stopped' : 'done',
      completed: task.totalBrands,
      current: '',
      results: results,
      pendingTask: null
    });
    return;
  }

  const nextBrand = task.brands[nextBrandIdx];

  updateState({
    completed: nextBrandIdx,
    current: nextBrand,
    results: results
  });

  // 设置页面并点击检索
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
    sendResponse({ accepted: true });
  }
  return true;
});

async function startNewScraping(brands) {
  const brand = brands[0];

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
  // 1. 确保"自定义"已选中
  ensureCustomSelected();

  // 2. 输入品牌名称
  inputBrandName(brand);

  // 3. 设置查看范围
  if (channel === 'all') {
    ensureCheckboxSelected('全部');
  } else if (channel === 'taobao') {
    ensureCheckboxDeselected('全部');
    ensureCheckboxSelected('淘宝全部');
  }

  // 4. 设置排序方式为"销售额"
  ensureSortOrderSelected('销售额');

  // 5. 保存待处理任务（页面跳转后恢复用）
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

  // 6. 点击检索（会触发页面跳转）
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
  // 优先使用用户提供的精确 XPath
  let targetLabel = getElementByXPath(
    '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[2]/form/table/tbody/tr[9]/td[2]/label[2]'
  );

  // 回退：按文本查找
  if (!targetLabel) {
    targetLabel = findLabelByText(labelText);
  }

  if (!targetLabel) { console.warn('[QBT] 未找到"' + labelText + '"排序方式元素'); return; }

  // 检查是否已选中：::after 伪元素存在表示已选中
  const afterStyle = window.getComputedStyle(targetLabel, '::after');
  if (afterStyle && afterStyle.content && afterStyle.content !== 'none') return;

  // 未选中，点击
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

// === 等待表格出现 ===
function waitForTable(timeout = 15000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const check = () => {
      if (Date.now() - startTime > timeout) { resolve(false); return; }
      const table = findResultTable();
      if (table) {
        const tbody = table.querySelector('tbody');
        const rows = tbody ? tbody.querySelectorAll('tr') : [];
        if (rows.length >= 2) { resolve(true); return; }
      }
      setTimeout(check, 500);
    };
    check();
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// === 查找结果表格（多种策略） ===
function findResultTable() {
  // 策略1: 用户提供的 XPath 到 colgroup
  let colgroup = getElementByXPath(
    '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[5]/div/div[2]/div[1]/div/div[2]/div[2]/div[3]/div[1]/div[1]/div[1]/div[2]/div/table/colgroup'
  );
  if (colgroup) return colgroup.closest('table');

  // 策略2: 简化 XPath（div[5] 区域下的第一个 table）
  const area = getElementByXPath(
    '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[5]'
  );
  if (area) {
    const tables = area.querySelectorAll('table');
    for (const t of tables) {
      const rows = t.querySelectorAll('tbody tr');
      if (rows.length >= 2) return t;
    }
  }

  // 策略3: 全局搜索包含 colgroup 且有 tbody 的 table
  const allTables = document.querySelectorAll('table');
  for (const t of allTables) {
    if (t.querySelector('colgroup') && t.querySelector('tbody tr')) {
      return t;
    }
  }

  return null;
}

// === 表格解析 ===
function parseTable() {
  const table = findResultTable();
  if (!table) { console.warn('[QBT] 未找到结果表格'); return []; }

  const tbody = table.querySelector('tbody');
  if (!tbody) { console.warn('[QBT] 表格无 tbody'); return []; }

  const allRows = Array.from(tbody.querySelectorAll('tr'));
  console.log('[QBT] 表格共', allRows.length, '行');

  if (allRows.length < 2) { console.warn('[QBT] 表格行数不足'); return []; }

  // 实际表格结构（4行，取第1行和第3行）：
  // Row 0: 表头行 — 类别名称 | 月份1 | 月份2 | ... | 总计
  // Row 1: 跳过（暂无数据 或 销量子表头）
  // Row 2: 数据行 — 0-∞元 | 数值1 | 数值2 | ... | 总计
  // Row 3: 总计行 — 跳过

  // 取第1行 (index 0) 和第3行 (index 2)
  const headerRow = allRows[0];
  let dataRow = allRows.length >= 3 ? allRows[2] : null;

  // 如果只有2-3行，尝试取最后一行非总计的行作为数据行
  if (!dataRow && allRows.length >= 2) {
    dataRow = allRows[1];
  }

  if (!headerRow || !dataRow) { console.warn('[QBT] 无法定位表头行或数据行'); return []; }

  // 从表头行提取月份列名
  const headerCells = Array.from(headerRow.querySelectorAll('th, td'));
  // 去掉第一列（类别名称）和最后一列（总计）
  const monthHeaders = headerCells.slice(1, -1).map(cell => cell.textContent.trim());
  console.log('[QBT] 月份列:', monthHeaders);

  // 从数据行提取数值
  const dataCells = Array.from(dataRow.querySelectorAll('td'));

  // 去掉最后一列（总计）
  const valueCells = dataCells.slice(0, -1);

  if (valueCells.length === 0) { console.warn('[QBT] 数据行无单元格'); return []; }

  // 第一列是类别占位（0-∞元），替换为面包屑类目名称
  const categoryName = getCategoryFromBreadcrumb();
  console.log('[QBT] 类目名称:', categoryName);

  const rowData = { category: categoryName };
  monthHeaders.forEach((header, idx) => {
    const cell = valueCells[idx + 1];
    rowData[header] = cell ? cell.textContent.trim() : '';
  });

  console.log('[QBT] 解析结果:', rowData);
  return [rowData];
}

// === 从面包屑获取类目名称 ===
function getCategoryFromBreadcrumb() {
  // XPath: /html/body/div[1]/div[2]/div[1]/div[3]/div/div[1]
  const breadcrumb = getElementByXPath(
    '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[1]'
  );
  if (!breadcrumb) {
    console.warn('[QBT] 未找到面包屑元素');
    return '';
  }

  // 获取所有 a 标签的文本，拼接为完整类目路径
  const links = breadcrumb.querySelectorAll('a');
  const names = Array.from(links).map(a => a.textContent.trim()).filter(t => t.length > 0);

  // 返回最后一级类目（最具体的类目名称）
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
