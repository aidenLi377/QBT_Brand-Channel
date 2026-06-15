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

  // 直接从 DOM 解析表格（利用 colSpan 定位"销售额"列）
  const table = findBestTable();
  const data = table ? parseTableDOM(table) : [];
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

  if (!inputChecked) return;
  if (!afterContent || afterContent === 'none') return;

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

// === 直接从 DOM 解析表格：按 colSpan 定位"销售额"列 ===
// 表格结构：
//   Row 0: 类别名称 | 202601(colSpan=N) | 202602(colSpan=N) | ... | 总计
//   Row 1: 销量 | 占比 | ... | 销售额 | ... | 销量 | 占比 | ... | 销售额 | ...
//   Row 2: 数据...
//   Row 3: 总计
// 每个月有多个指标子列，我们只取"销售额"列
function parseTableDOM(table) {
  const trs = table.querySelectorAll('tr');
  if (trs.length < 3) { console.warn('[QBT] 表格行数<3'); return []; }

  // Row 0: 月份表头（含 colSpan）
  const headerCells = Array.from(trs[0].querySelectorAll('th, td'));
  let colIdx = 0;
  const monthRanges = [];
  for (const cell of headerCells) {
    const text = cell.textContent.trim();
    const span = cell.colSpan || 1;
    if (text && text !== '类别名称' && text !== '总计' && /^\d{6}$/.test(text)) {
      monthRanges.push({ month: text, start: colIdx, end: colIdx + span });
    }
    colIdx += span;
  }
  console.log('[QBT] 月份区间:', JSON.stringify(monthRanges));

  // Row 1: 子表头（每个指标的列名）
  const subCells = Array.from(trs[1].querySelectorAll('th, td'));
  const subHeaders = subCells.map(c => c.textContent.trim());
  console.log('[QBT] 子表头列数:', subHeaders.length);

  // 找出所有"销售额"所在的列索引
  const salesIndices = [];
  for (let i = 0; i < subHeaders.length; i++) {
    if (subHeaders[i] === '销售额') {
      salesIndices.push(i);
    }
  }
  console.log('[QBT] 销售额列索引:', salesIndices);

  if (salesIndices.length === 0) { console.warn('[QBT] 未找到销售额列'); return []; }

  // Row 2: 数据行
  const dataCells = Array.from(trs[2].querySelectorAll('td'));

  // 检测数据行偏移：第一列通常是"0-∞元"之类的类别占位
  // 子表头从第1列开始（跳过类别列），所以要加偏移
  const firstCellText = dataCells.length > 0 ? dataCells[0].textContent.trim() : '';
  const dataOffset = (firstCellText.includes('元') || firstCellText === '') ? 1 : 0;
  console.log('[QBT] 数据行第一格:', firstCellText, '→ 偏移:', dataOffset);
  console.log('[QBT] 数据行列数:', dataCells.length, '子表头列数:', subHeaders.length);

  // 构建结果：每个销售额值对应一个月份
  const categoryName = getCategoryFromBreadcrumb();
  console.log('[QBT] 类目名称:', categoryName);

  // 只取月份数量的销售额值（排除总计列的"销售额"）
  const count = Math.min(salesIndices.length, monthRanges.length);

  const rowData = { category: categoryName };
  for (let si = 0; si < count; si++) {
    const idx = salesIndices[si] + dataOffset;
    rowData[monthRanges[si].month] = (idx < dataCells.length && dataCells[idx]) ? dataCells[idx].textContent.trim() : '';
  }

  console.log('[QBT] 解析结果:', rowData);
  return [rowData];
}

// === 从面包屑获取类目名称 ===
function getCategoryFromBreadcrumb() {
  // 尝试多个 XPath
  let breadcrumb = getElementByXPath(
    '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[1]/div[1]'
  );
  if (!breadcrumb) {
    breadcrumb = getElementByXPath(
      '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[1]'
    );
  }
  // 回退：查找页面上所有面包屑结构（含多个 a 标签的容器）
  if (!breadcrumb) {
    const allDivs = document.querySelectorAll('div');
    for (const div of allDivs) {
      const links = div.querySelectorAll('a');
      if (links.length >= 2) {
        const texts = Array.from(links).map(a => a.textContent.trim()).filter(t => t.length > 0);
        if (texts.length >= 2) {
          const last = texts[texts.length - 1];
          if (last.length > 1 && last.length < 30) {
            console.log('[QBT] 回退找到类目:', last, '(来自', texts.length, '级面包屑)');
            return last;
          }
        }
      }
    }
  }

  if (!breadcrumb) { console.warn('[QBT] 未找到面包屑元素'); return ''; }

  const links = breadcrumb.querySelectorAll('a');
  const names = Array.from(links).map(a => a.textContent.trim()).filter(t => t.length > 0);
  console.log('[QBT] 面包屑层级:', names);
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
