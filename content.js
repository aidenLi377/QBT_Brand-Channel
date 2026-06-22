// content.js — Nint 页面 DOM 操控自动化

let stopFlag = false;
let pageLayout = null; // 'v1': 有"全部"复选框 | 'v2': 只有"淘宝全部"+"天猫全部"

function detectLayout() {
  if (pageLayout) return pageLayout;
  const v2El = getElementByXPath('/html/body/div[1]/div[2]/div[1]/div[4]/div/div[3]/div[2]/form/table/tbody/tr[6]/td[2]/label[1]');
  if (v2El && v2El.textContent.includes('淘宝全部')) { pageLayout = 'v2'; }
  else { pageLayout = 'v1'; }
  console.log('[QBT] 页面布局:', pageLayout);
  return pageLayout;
}

// v1: 有"全部" → 渠道: all(全部) → taobao(淘宝) → 计算天猫
// v2: 无"全部" → 渠道: taobao(淘宝) → tmall(天猫) → 计算全部
const LAYOUT_CHANNELS = {
  v1: { first: 'all', second: 'taobao', calc: 'tmall', baseline: 'first', firstLabel: '全部', secondLabel: '淘宝全部', calcLabel: '天猫' },
  v2: { first: 'taobao', second: 'tmall', calc: 'all', baseline: 'second', firstLabel: '淘宝全部', secondLabel: '天猫全部', calcLabel: '全部' },
};

function getLayoutChannels() { return LAYOUT_CHANNELS[detectLayout()]; }

// === 初始化：检查是否有待处理任务（页面跳转后恢复） ===
(async function init() {
  const state = await getState();
  if (state && state.pendingTask) {
    stopFlag = state.stopFlag || (state.pendingTask && state.pendingTask.stopFlag) || false;
    updateBadge(state.completed || 0, state.total || 0);

    // 基线采集阶段：空白检索结果
    if (state.pendingTask.phase === 'baseline') {
      await waitForResultTable(5000);
      const table = findBestTable();
      const data = table ? parseTableDOM(table) : [];
      const baselineData = (data && data.length > 0) ? data[0] : {};
      delete baselineData.category;

      const ch = getLayoutChannels();
      const task = state.pendingTask;
      const brand = task.brands[0];
      const brandStatuses = task.brands.map(b => ({ brand: b, status: b === brand ? 'running' : 'pending' }));

      updateState({
        current: brand,
        currentChannel: ch.firstLabel,
        baselineData: baselineData,
        failedBrands: [],
        brandStatuses: brandStatuses,
        pendingTask: {
          ...task,
          phase: 'scraping',
          brand: brand,
          channel: ch.first,
          brandIndex: 0,
          results: [],
          errors: [],
          failedBrands: [],
          brandStatuses: brandStatuses,
          baselineData: baselineData,
          stopFlag: false
        }
      });
      updateBadge(0, task.totalBrands);
      await setupAndSearch(brand, ch.first);
      return;
    }

    // 正常采集阶段
    if (checkNoData()) {
      let errors = state.pendingTask.errors || [];
      if (!errors.find(e => e.brand === state.pendingTask.brand)) {
        errors.push({ brand: state.pendingTask.brand, channel: '' });
      }
      state.pendingTask.errors = errors;
      resumeAfterReload(state.pendingTask);
      return;
    }

    const ready = await waitForResultTable(5000);
    if (!ready) {
      console.warn('[QBT] 表格加载超时，尝试解析...');
    }
    await resumeAfterReload(state.pendingTask);
  }
})();

async function resumeAfterReload(task) {
  const ch = getLayoutChannels();
  const channelLabel = task.channel === ch.first ? ch.firstLabel : ch.secondLabel;
  console.log('[QBT] 页面跳转后恢复, 渠道:', channelLabel, '品牌:', task.brand);

  const table = findBestTable();
  const data = table ? parseTableDOM(table) : [];
  let results = task.results || [];

  let errors = task.errors || [];

  if (data && data.length > 0) {
    data.forEach(row => results.push({ channel: channelLabel, brand: task.brand, ...row }));
    console.log('[QBT] 成功解析', data.length, '行数据, 累计:', results.length);
  } else {
    console.warn('[QBT] 未解析到数据');
    if (!errors.find(e => e.brand === task.brand && e.channel === channelLabel)) {
      errors.push({ brand: task.brand, channel: channelLabel });
    }
    // 任意渠道取不到数据 → 标记无数据
    const bs = task.brandStatuses || [];
    const entry = bs.find(e => e.brand === task.brand);
    if (entry) entry.status = 'no_data';
  }

  let brandStatuses = task.brandStatuses || [];
  let failedBrands = task.failedBrands || [];

  // second 渠道完成后，计算第三行 + 基线对比
  if (task.channel === ch.second) {
    const firstEntries = results.filter(r => r.channel === ch.firstLabel && r.brand === task.brand);
    const secondEntries = results.filter(r => r.channel === ch.secondLabel && r.brand === task.brand);
    if (firstEntries.length > 0 && secondEntries.length > 0) {
      const monthKeys = Object.keys(firstEntries[0]).filter(k => k !== 'channel' && k !== 'brand' && k !== 'category' && k !== 'priceBand');

      // 对比基线：用第一个价格带 vs 基线第一个价格带
      const baseline = task.baselineData || {};
      const baselinePriceBand = baseline.priceBand || '';
      const cmpEntry = ch.baseline === 'first' ? firstEntries[0] : secondEntries[0];
      let brandFailed = false;
      if (Object.keys(baseline).length > 0 && monthKeys.length > 0) {
        brandFailed = true;
        for (const key of monthKeys) {
          if (String(cmpEntry[key] || '') !== String(baseline[key] || '')) {
            brandFailed = false;
            break;
          }
        }
      }

      if (brandFailed) {
        results = results.filter(r => r.brand !== task.brand);
        if (!failedBrands.includes(task.brand)) failedBrands.push(task.brand);
        const fe = brandStatuses.find(e => e.brand === task.brand);
        if (fe) fe.status = 'failed';
      } else {
        // 每个价格带计算一行
        for (const fe of firstEntries) {
          const pb = fe.priceBand || '';
          const se = secondEntries.find(e => e.priceBand === pb);
          if (!se) continue;
          const calcEntry = { channel: ch.calcLabel, brand: task.brand, category: fe.category || '', priceBand: pb };
          for (const key of monthKeys) {
            const v1 = parseFloat(String(fe[key]).replace(/,/g, '')) || 0;
            const v2 = parseFloat(String(se[key]).replace(/,/g, '')) || 0;
            calcEntry[key] = ch.calc === 'tmall' ? String(v1 - v2) : String(v1 + v2);
          }
          results.push(calcEntry);
        }
        const se = brandStatuses.find(e => e.brand === task.brand);
        if (se) se.status = 'success';
      }
    }
  }

  // 判断下一步
  let nextChannel, nextBrandIdx;
  if (task.channel === ch.first) {
    nextChannel = ch.second;
    nextBrandIdx = task.brandIndex;
  } else {
    nextChannel = ch.first;
    nextBrandIdx = task.brandIndex + 1;
  }

  if (nextBrandIdx >= task.brands.length || stopFlag) {
    updateState({
      status: stopFlag ? 'stopped' : 'done',
      completed: task.totalBrands,
      total: task.totalBrands,
      current: '',
      currentChannel: '',
      results: results,
      errors: errors,
      failedBrands: failedBrands,
      brandStatuses: brandStatuses,
      pendingTask: null
    });
    updateBadge(task.totalBrands, task.totalBrands);
    return;
  }

  const nextBrand = task.brands[nextBrandIdx];
  const nextChannelLabel = nextChannel === ch.first ? ch.firstLabel : ch.secondLabel;
  // 不覆盖已有的终端状态
  const nextEntry = brandStatuses.find(e => e.brand === nextBrand);
  if (nextEntry && nextEntry.status === 'pending') nextEntry.status = 'running';

  const newPendingTask = {
    brand: nextBrand,
    channel: nextChannel,
    brandIndex: nextBrandIdx,
    brands: task.brands,
    totalBrands: task.totalBrands,
    results: results,
    errors: errors,
    baselineData: task.baselineData,
    failedBrands: failedBrands,
    brandStatuses: brandStatuses,
    stopFlag: stopFlag
  };

  updateState({
    completed: nextBrandIdx,
    total: task.totalBrands,
    current: nextBrand,
    currentChannel: nextChannelLabel,
    results: results,
    errors: errors,
    failedBrands: failedBrands,
    brandStatuses: brandStatuses,
    pendingTask: newPendingTask
  });
  updateBadge(nextBrandIdx, task.totalBrands);

  await setupAndSearch(nextBrand, nextChannel);
}

// === 消息监听 ===
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startScraping') {
    stopFlag = false;
    sendResponse({ accepted: true });
    startNewScraping(message.brands);
  } else if (message.action === 'stopScraping') {
    stopFlag = true;
    chrome.storage.local.get(['scraperState'], (data) => {
      const s = data.scraperState || {};
      const pt = s.pendingTask ? { ...s.pendingTask, stopFlag: true } : null;
      chrome.storage.local.set({ scraperState: { ...s, stopFlag: true, pendingTask: pt } });
    });
    updateBadge(0, 0);
    sendResponse({ accepted: true });
  }
  return true;
});

async function startNewScraping(brands) {
  const ch = getLayoutChannels();
  updateBadge(0, brands.length);

  const brandStatuses = brands.map(b => ({ brand: b, status: 'pending' }));

  updateState({
    status: 'running',
    completed: 0,
    total: brands.length,
    current: '',
    currentChannel: '采集基线数据...',
    results: [],
    errors: [],
    baselineData: {},
    failedBrands: [],
    brandStatuses: brandStatuses,
    pendingTask: {
      phase: 'baseline',
      brands: brands,
      totalBrands: brands.length,
      results: [],
      errors: [],
      failedBrands: [],
      brandStatuses: brandStatuses,
      baselineData: {},
      stopFlag: false
    }
  });

  // 空白检索：清空输入框，只选基线渠道，点检索获取基线数据
  ensureCustomSelected();
  const input = getElementByXPath(getBrandInputXPath());
  if (input) {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // v1: 只选"全部" / v2: 只选"天猫全部"
  const baselineLabel = ch.baseline === 'first' ? ch.firstLabel : ch.secondLabel;
  const otherLabel = ch.baseline === 'first' ? ch.secondLabel : ch.firstLabel;
  ensureCheckboxDeselected(otherLabel);
  ensureCheckboxSelected(baselineLabel);
  ensureSortOrderSelected('销售额');
  ensureOnlySalesSelected();
  await sleep(300);
  clickSearch();
}

// === 设置页面并点击检索 ===
async function setupAndSearch(brand, channel) {
  const ch = getLayoutChannels();
  console.log('[QBT] === 设置表单: 品牌=' + brand + ', 渠道=' + channel + ' ===');

  ensureCustomSelected();
  inputBrandName(brand);
  await clickFirstDropdownItem(brand);

  if (channel === ch.first) {
    // first channel: ensure only it's selected
    const firstLabel = ch.firstLabel;
    const secondLabel = ch.secondLabel;
    ensureCheckboxDeselected(secondLabel);
    ensureCheckboxSelected(firstLabel);
  } else {
    // second channel: deselect first, select second
    const firstLabel = ch.firstLabel;
    const secondLabel = ch.secondLabel;
    ensureCheckboxDeselected(firstLabel);
    ensureCheckboxSelected(secondLabel);
  }

  ensureSortOrderSelected('销售额');
  ensureOnlySalesSelected();

  console.log('[QBT] === 表单设置完成，即将点击检索 ===');
  await sleep(300);
  clickSearch();
}

// === 页面元素 XPath 助手 ===
const FORM_BASE = {
  v1: '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[2]/form',
  v2: '/html/body/div[1]/div[2]/div[1]/div[4]/div/div[3]/div[2]/form',
};
const INDICATOR_BASE = {
  v1: '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[5]',
  v2: '/html/body/div[1]/div[2]/div[1]/div[4]/div/div[3]/div[5]',
};

function formXpath(suffix) { return FORM_BASE[detectLayout()] + suffix; }
function indicatorXpath(suffix) { return INDICATOR_BASE[detectLayout()] + suffix; }

// 复选框 XPath — v1: 有"全部" / v2: 只有"淘宝全部"+"天猫全部"
const CHECKBOX_XPATHS = {
  v1: {
    '全部': '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[2]/form/table/tbody/tr[6]/td[2]/div/div[1]/div[1]/label',
    '淘宝全部': '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[2]/form/table/tbody/tr[6]/td[2]/div/div[1]/div[2]/label',
  },
  v2: {
    '淘宝全部': '/html/body/div[1]/div[2]/div[1]/div[4]/div/div[3]/div[2]/form/table/tbody/tr[6]/td[2]/label[1]',
    '天猫全部': '/html/body/div[1]/div[2]/div[1]/div[4]/div/div[3]/div[2]/form/table/tbody/tr[6]/td[2]/label[2]',
  },
};

// === 下拉框操作 ===
function ensureCustomSelected() {
  const select = getElementByXPath(formXpath('/table/tbody/tr[2]/td[2]/div/select'));
  if (!select) { console.warn('[QBT] 未找到"自定义"下拉框元素'); return; }

  const selectedOption = select.options[select.selectedIndex];
  if (selectedOption && selectedOption.text.includes('自定义')) return;

  select.selectedIndex = 0;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

// 品牌输入框 XPath
function getBrandInputXPath() { return formXpath('/table/tbody/tr[2]/td[2]/div/input'); }

// === 品牌输入 ===
function inputBrandName(brand) {
  const input = getElementByXPath(getBrandInputXPath());
  if (!input) { console.warn('[QBT] 未找到品牌输入框元素'); return; }

  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.value = brand;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.focus();
}

// === 自动完成：调接口取第一条建议，填入输入框 ===
async function clickFirstDropdownItem(brand) {
  const input = getElementByXPath(getBrandInputXPath());
  if (!input) { console.warn('[QBT] 未找到输入框'); return false; }

  try {
    const urlParams = new URLSearchParams(window.location.search);
    const cid = urlParams.get('cid') || '';
    const site = urlParams.get('site') || 'ali';

    const apiUrl = 'https://art.nint.com/stat-ali-new/rbidnameautocomplete' +
      '?site=' + encodeURIComponent(site) +
      '&cid=' + encodeURIComponent(cid) +
      '&keyword=' + encodeURIComponent(brand);

    const response = await fetch(apiUrl, { credentials: 'include' });
    const suggestions = await response.json();

    if (Array.isArray(suggestions) && suggestions.length > 0) {
      const first = suggestions[0];
      console.log('[QBT] 自动完成第一项:', first);
      input.value = first;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    console.warn('[QBT] 自动完成接口返回空');
    return false;
  } catch (err) {
    console.warn('[QBT] 自动完成接口请求失败:', err.message);
    return false;
  }
}

function getCheckboxLabel(labelText) {
  const layout = detectLayout();
  const paths = CHECKBOX_XPATHS[layout];
  if (paths && paths[labelText]) {
    const el = getElementByXPath(paths[labelText]);
    if (el) return el;
  }
  return findLabelByText(labelText);
}

function isCheckboxChecked(label) {
  const input = label.querySelector('input') || label.previousElementSibling;
  if (input && (input.type === 'checkbox' || input.type === 'radio') && input.checked) return true;
  const afterStyle = window.getComputedStyle(label, '::after');
  return afterStyle && afterStyle.content && afterStyle.content !== 'none';
}

function ensureCheckboxSelected(labelText) {
  const label = getCheckboxLabel(labelText);
  if (!label) { console.warn('[QBT] 未找到"' + labelText + '"复选框元素'); return; }

  if (isCheckboxChecked(label)) return;
  console.log('[QBT] 点击选中"' + labelText + '"');
  label.click();
}

function ensureCheckboxDeselected(labelText) {
  const label = getCheckboxLabel(labelText);
  if (!label) { console.warn('[QBT] 未找到"' + labelText + '"复选框元素'); return; }

  if (!isCheckboxChecked(label)) return;
  console.log('[QBT] 点击取消"' + labelText + '"');
  label.click();
}

// === 排序方式操作 ===
function ensureSortOrderSelected(labelText) {
  const tr = detectLayout() === 'v1' ? 'tr[9]' : 'tr[8]';
  let targetLabel = getElementByXPath(formXpath('/table/tbody/' + tr + '/td[2]/label[2]'));
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
    indicatorXpath('/div/div[2]/div[1]/div/div[1]/div[1]/div/div[1]')
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
  const btn = getElementByXPath(formXpath('/div[2]/button'));
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

  // Row 0: 提取日期列名（月维度 202604 / 日维度 2026-01-01）
  const headerCells = Array.from(trs[0].querySelectorAll('th, td'));
  const months = [];
  for (const cell of headerCells) {
    const text = cell.textContent.trim();
    if (/^\d{4}(?:\d{2}|-\d{2}(?:-\d{2})?)$/.test(text)) months.push(text);
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

  const categoryName = getCategoryFromBreadcrumb();
  const count = Math.min(salesIndices.length, months.length);
  const results = [];

  // 数据行: row 2 到 row n-2（跳过表头、子表头、总计行），支持多价格带
  for (let r = 2; r < trs.length - 1; r++) {
    const cells = Array.from(trs[r].querySelectorAll('td'));
    if (cells.length === 0) continue;
    const priceBand = cells[0].textContent.trim();
    const dataOffset = (priceBand.includes('元') || priceBand === '') ? 1 : 0;

    const rowData = { category: categoryName, priceBand: priceBand };
    for (let i = 0; i < count; i++) {
      const cellIdx = salesIndices[i] + dataOffset;
      rowData[months[i]] = (cellIdx < cells.length && cells[cellIdx]) ? cells[cellIdx].textContent.trim() : '';
    }
    results.push(rowData);
  }

  console.log('[QBT] 解析结果:', results.length, '行');
  return results;
}

// === 从面包屑获取类目名称 ===
function getCategoryFromBreadcrumb() {
  const xpaths = [
    '/html/body/div[1]/div[2]/div[1]/div[4]/div/div[1]',
    '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[1]',
  ];
  for (const xp of xpaths) {
    const container = getElementByXPath(xp);
    if (!container) continue;
    const links = container.querySelectorAll('a[href*="stat-ali-new?cid="]:not([href*="pos="])');
    const names = Array.from(links).map(a => a.textContent.trim()).filter(t => t.length > 0);
    if (names.length > 0) return names.join('>');
  }
  return '';
}

// === 工具函数 ===
// === 检查页面是否显示"暂无符合条件的数据" ===
function checkNoData() {
  const el = getElementByXPath(
    indicatorXpath('/div/div[2]/div')
  );
  if (!el) return false;
  return el.textContent.includes('暂时没有符合条件的数据');
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
