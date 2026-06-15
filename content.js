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

  // 检查是否显示"暂时没有符合条件的数据"
  if (checkNoData()) {
    console.log('[QBT] 品牌"' + task.brand + '"无数据，跳过');
    let errors = task.errors || [];
    if (!errors.find(e => e.brand === task.brand)) {
      errors.push({ brand: task.brand, channel: '' });
    }
    // 直接跳到下一个品牌
    skipToNextBrand(task, task.results || [], errors);
    return;
  }

  // 直接从 DOM 解析表格（利用 colSpan 定位"销售额"列）
  const table = findBestTable();
  const data = table ? parseTableDOM(table) : [];
  let results = task.results || [];

  const channelLabel = task.channel === 'all' ? '全部' : '淘宝全部';
  let errors = task.errors || [];

  if (data && data.length > 0) {
    data.forEach(row => results.push({ channel: channelLabel, brand: task.brand, ...row }));
    console.log('[QBT] 成功解析', data.length, '行数据, 累计:', results.length);
  } else {
    console.warn('[QBT] 未解析到数据');
    // 去重记录
    if (!errors.find(e => e.brand === task.brand && e.channel === channelLabel)) {
      errors.push({ brand: task.brand, channel: channelLabel });
    }
  }

  // taobao 渠道完成后，计算天猫 = all - taobao
  if (task.channel === 'taobao') {
    const allEntry = results.find(r => r.channel === '全部' && r.brand === task.brand);
    const taobaoEntry = results.find(r => r.channel === '淘宝全部' && r.brand === task.brand);
    if (allEntry && taobaoEntry) {
      const tianmaoEntry = { channel: '天猫', brand: task.brand };
      const monthKeys = Object.keys(allEntry).filter(k => k !== 'channel' && k !== 'brand' && k !== 'category');
      for (const key of monthKeys) {
        const allVal = parseFloat(String(allEntry[key]).replace(/,/g, '')) || 0;
        const tmallVal = parseFloat(String(taobaoEntry[key]).replace(/,/g, '')) || 0;
        tianmaoEntry[key] = String(allVal - tmallVal);
      }
      results.push(tianmaoEntry);
      console.log('[QBT] 已计算天猫行:', tianmaoEntry);
    }
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
      currentChannel: '',
      results: results,
      errors: errors,
      pendingTask: null
    });
    updateBadge(task.totalBrands, task.totalBrands);
    return;
  }

  const nextBrand = task.brands[nextBrandIdx];

  const nextChannelLabel = nextChannel === 'all' ? '全部' : '淘宝全部';

  const newPendingTask = {
    brand: nextBrand,
    channel: nextChannel,
    brandIndex: nextBrandIdx,
    brands: task.brands,
    totalBrands: task.totalBrands,
    results: results,
    errors: errors,
    stopFlag: stopFlag
  };

  updateState({
    completed: nextBrandIdx,
    total: task.totalBrands,
    current: nextBrand,
    currentChannel: nextChannelLabel,
    results: results,
    errors: errors,
    pendingTask: newPendingTask
  });
  updateBadge(nextBrandIdx, task.totalBrands);

  await setupAndSearch(nextBrand, nextChannel, results);
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
    currentChannel: '全部',
    results: [],
    errors: [],
    brands: brands,
    pendingTask: {
      brand: brand,
      channel: 'all',
      brandIndex: 0,
      brands: brands,
      totalBrands: brands.length,
      results: [],
      errors: [],
      stopFlag: false
    }
  });

  await setupAndSearch(brand, 'all');
}

// === 设置页面并点击检索 ===
async function setupAndSearch(brand, channel) {
  console.log('[QBT] === 设置表单: 品牌=' + brand + ', 渠道=' + channel + ' ===');

  ensureCustomSelected();
  inputBrandName(brand);

  if (channel === 'all') {
    ensureCheckboxSelected('全部');
  } else if (channel === 'taobao') {
    ensureCheckboxDeselected('全部');
    ensureCheckboxSelected('淘宝全部');
  }

  ensureSortOrderSelected('销售额');

  console.log('[QBT] === 表单设置完成，即将点击检索 ===');
  await sleep(300);
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
// "全部" 和 "淘宝全部" 用精确 XPath 定位（页面上可能有多个同名元素）
const CHECKBOX_XPATHS = {
  '全部': '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[2]/form/table/tbody/tr[6]/td[2]/div/div[1]/div[1]/label',
  '淘宝全部': '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[2]/form/table/tbody/tr[6]/td[2]/div/div[1]/div[2]/label'
};

function getCheckboxLabel(labelText) {
  if (CHECKBOX_XPATHS[labelText]) {
    const el = getElementByXPath(CHECKBOX_XPATHS[labelText]);
    if (el) return el;
  }
  return findLabelByText(labelText);
}

function ensureCheckboxSelected(labelText) {
  const targetLabel = getCheckboxLabel(labelText);
  if (!targetLabel) { console.warn('[QBT] 未找到"' + labelText + '"复选框元素'); return; }

  const input = targetLabel.querySelector('input') || targetLabel.previousElementSibling;
  const inputChecked = input && (input.type === 'checkbox' || input.type === 'radio') && input.checked;
  const afterStyle = window.getComputedStyle(targetLabel, '::after');
  const afterContent = afterStyle ? afterStyle.content : 'none';

  console.log('[QBT] 复选框"' + labelText + '": inputChecked=' + inputChecked + ', afterContent=' + afterContent);

  // 任一信号指示已选中 → 跳过
  if (inputChecked) return;
  if (afterContent && afterContent !== 'none') return;

  console.log('[QBT] 点击选中"' + labelText + '"');
  targetLabel.click();
}

function ensureCheckboxDeselected(labelText) {
  const targetLabel = getCheckboxLabel(labelText);
  if (!targetLabel) { console.warn('[QBT] 未找到"' + labelText + '"复选框元素'); return; }

  const input = targetLabel.querySelector('input') || targetLabel.previousElementSibling;
  const inputChecked = input && (input.type === 'checkbox' || input.type === 'radio') && input.checked;
  const afterStyle = window.getComputedStyle(targetLabel, '::after');
  const afterContent = afterStyle ? afterStyle.content : 'none';

  console.log('[QBT] 复选框"' + labelText + '": inputChecked=' + inputChecked + ', afterContent=' + afterContent);

  // 两个信号都指示未选中 → 已取消，跳过；否则点击取消
  if (!inputChecked && (!afterContent || afterContent === 'none')) return;

  console.log('[QBT] 点击取消"' + labelText + '"');
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

// === 指标选择：确保只有"销售额"被选中 ===
function ensureOnlySalesSelected() {
  const container = getElementByXPath(
    '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[5]/div/div[2]/div[1]/div/div[1]/div[1]/div/div[1]'
  );
  if (!container) { console.warn('[QBT] 未找到指标列表容器'); return; }

  const labels = container.querySelectorAll('label');
  console.log('[QBT] 指标列表共', labels.length, '个');

  for (const label of labels) {
    const span = label.querySelector('span:nth-child(2)');
    if (!span) continue;
    const name = span.textContent.trim();
    const isSelected = checkLabelSelected(label);

    if (name === '销售额') {
      if (!isSelected) {
        console.log('[QBT] 点击选中"销售额"');
        label.click();
      }
    } else {
      if (isSelected) {
        console.log('[QBT] 点击取消"' + name + '"');
        label.click();
      }
    }
  }
}

function checkLabelSelected(label) {
  const afterStyle = window.getComputedStyle(label, '::after');
  return afterStyle && afterStyle.content && afterStyle.content !== 'none';
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
      if (findBestTable()) { console.log('[QBT] 结果表格已出现'); resolve(true); return; }
      setTimeout(check, 500);
    };
    check();
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// === 从 DOM 获取数据表格（影刀思路：按数据密度评分找表） ===
// 评分标准：表格中含有 N 个看起来像金额的单元格（数字+可选小数点）
function findBestTable() {
  const allTables = document.querySelectorAll('table');
  let bestTable = null;
  let bestScore = 0;

  for (const t of allTables) {
    const cells = t.querySelectorAll('td');
    let score = 0;
    for (const c of cells) {
      const text = c.textContent.trim();
      // 匹配金额格式：纯数字（可能含逗号和小数点），且长度>4（排除年份）
      if (/^[\d,]+\.?\d*$/.test(text) && text.replace(/[,\.]/g, '').length > 4) {
        score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestTable = t;
    }
  }

  if (bestTable) {
    console.log('[QBT] 数据表评分:', bestScore, '个金额单元格, 行数:', bestTable.querySelectorAll('tr').length);
  }
  return bestTable;
}

// === 直接从 DOM 解析表格：按子表头定位"销售额"列 ===
// 表格不使用 colSpan，而是通过 <colgroup> 定义列。
// Row 0: 类别名称 | 202601 | 202602 | 202603 | 202604 | 202605 | 总计
// Row 1: 销量 | 占比 | ... | 销售额 | ... (每个月的指标重复)
// Row 2: 0-∞元 | 数据...
// 策略：从 Row 0 提取月份，从 Row 1 找"销售额"位置，按顺序一一对应
function parseTableDOM(table) {
  const trs = table.querySelectorAll('tr');
  if (trs.length < 3) { console.warn('[QBT] 表格行数<3'); return []; }

  // Row 0: 提取月份名（匹配6位数字的单元格）
  const headerCells = Array.from(trs[0].querySelectorAll('th, td'));
  const months = [];
  for (const cell of headerCells) {
    const text = cell.textContent.trim();
    if (/^\d{6}$/.test(text)) months.push(text);
  }
  console.log('[QBT] 月份:', months);

  // Row 1: 子表头（指标名称）
  const subCells = Array.from(trs[1].querySelectorAll('th, td'));
  const subHeaders = subCells.map(c => c.textContent.trim());
  console.log('[QBT] 子表头列数:', subHeaders.length);

  // 找出所有"销售额"的列索引
  const salesIndices = [];
  for (let i = 0; i < subHeaders.length; i++) {
    if (subHeaders[i] === '销售额') salesIndices.push(i);
  }
  console.log('[QBT] 销售额列索引:', salesIndices, '→ 月份数:', months.length);

  if (salesIndices.length === 0) { console.warn('[QBT] 未找到销售额列'); return []; }

  // Row 2: 数据行
  const dataCells = Array.from(trs[2].querySelectorAll('td'));

  // 数据行第一列是 "0-∞元" 类别占位，需要偏移 +1
  const firstCellText = dataCells.length > 0 ? dataCells[0].textContent.trim() : '';
  const dataOffset = (firstCellText.includes('元') || firstCellText === '') ? 1 : 0;
  console.log('[QBT] 数据行第一格:', firstCellText, '→ 偏移:', dataOffset);

  // 一一对应：第 i 个"销售额" → 第 i 个月（跳过最后的总计列）
  const categoryName = getCategoryFromBreadcrumb();
  console.log('[QBT] 类目名称:', categoryName);

  const rowData = { category: categoryName };
  const count = Math.min(salesIndices.length, months.length);
  for (let i = 0; i < count; i++) {
    const cellIdx = salesIndices[i] + dataOffset;
    rowData[months[i]] = (cellIdx < dataCells.length && dataCells[cellIdx]) ? dataCells[cellIdx].textContent.trim() : '';
  }

  console.log('[QBT] 解析结果:', rowData);
  return [rowData];
}

// === 从面包屑获取类目名称 ===
function getCategoryFromBreadcrumb() {
  // 策略1: 用户提供的精确 XPath
  let container = getElementByXPath(
    '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[1]/div[1]'
  );
  if (!container) {
    container = getElementByXPath(
      '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[1]'
    );
  }

  if (container) {
    const links = container.querySelectorAll('a');
    const names = Array.from(links).map(a => a.textContent.trim()).filter(t => t.length > 0);
    console.log('[QBT] XPath面包屑:', names);
    if (names.length > 0) return names[names.length - 1];
  }

  // 策略2: 全页搜索面包屑（含 >=2 个链接且类目名合理的容器）
  const allWithLinks = document.querySelectorAll('a');
  // 找有 ">" 或 "/" 分隔符的连续链接组
  const candidates = [];
  for (const a of allWithLinks) {
    const text = a.textContent.trim();
    if (text.length >= 2 && text.length < 20 && !/^\d/.test(text)) {
      // 检查父元素是否包含多个链接
      const parent = a.parentElement;
      if (parent) {
        const siblingLinks = parent.querySelectorAll('a');
        if (siblingLinks.length >= 2) {
          const allTexts = Array.from(siblingLinks).map(l => l.textContent.trim()).filter(t => t.length > 1);
          if (allTexts.length >= 2 && !candidates.includes(allTexts)) {
            candidates.push(allTexts);
          }
        }
      }
    }
  }

  // 取最长的面包屑（级数最多的）
  let best = [];
  for (const c of candidates) {
    if (c.length > best.length) best = c;
  }

  if (best.length > 0) {
    const last = best[best.length - 1];
    console.log('[QBT] 回退面包屑:', best, '→ 类目:', last);
    return last;
  }

  console.warn('[QBT] 未找到面包屑');
  return '';
}

// === 工具函数 ===
// === 检查页面是否显示"暂无符合条件的数据" ===
function checkNoData() {
  const el = getElementByXPath(
    '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[5]/div/div[2]/div'
  );
  if (!el) return false;
  return el.textContent.includes('暂时没有符合条件的数据');
}

// === 跳过当前品牌，直接进入下一个 ===
function skipToNextBrand(task, results, errors) {
  const nextBrandIdx = task.brandIndex + 1;
  if (nextBrandIdx >= task.brands.length || stopFlag) {
    updateState({
      status: stopFlag ? 'stopped' : 'done',
      completed: task.totalBrands,
      total: task.totalBrands,
      current: '',
      currentChannel: '',
      results: results,
      errors: errors,
      pendingTask: null
    });
    updateBadge(task.totalBrands, task.totalBrands);
    return;
  }

  const nextBrand = task.brands[nextBrandIdx];
  const newPendingTask = {
    brand: nextBrand,
    channel: 'all',
    brandIndex: nextBrandIdx,
    brands: task.brands,
    totalBrands: task.totalBrands,
    results: results,
    errors: errors,
    stopFlag: stopFlag
  };

  updateState({
    completed: nextBrandIdx,
    total: task.totalBrands,
    current: nextBrand,
    currentChannel: '全部',
    results: results,
    errors: errors,
    pendingTask: newPendingTask
  });
  updateBadge(nextBrandIdx, task.totalBrands);

  setupAndSearch(nextBrand, 'all');
}

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
