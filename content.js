// content.js — Nint 页面 DOM 操控自动化

let stopFlag = false;

// === 初始化：检查是否有待处理任务（页面跳转后恢复） ===
(async function init() {
  const state = await getState();
  if (state && state.pendingTask) {
    stopFlag = state.pendingTask.stopFlag || false;
    await resumeAfterReload(state.pendingTask);
  }
})();

async function resumeAfterReload(task) {
  // 页面刚跳转回来，解析当前表格
  const data = parseTable();
  let results = task.results || [];

  if (data && data.length > 0) {
    data.forEach(row => results.push({ channel: task.channel, brand: task.brand, ...row }));
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

// === 表格解析 ===
function parseTable() {
  const colgroup = getElementByXPath(
    '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[5]/div/div[2]/div[1]/div/div[2]/div[2]/div[3]/div[1]/div[1]/div[1]/div[2]/div/table/colgroup'
  );
  if (!colgroup) { console.warn('[QBT] 未找到结果表格'); return []; }

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
