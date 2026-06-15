// content.js — Nint 页面 DOM 操控自动化

let stopFlag = false;

// === 初始化：检查是否有待处理任务（页面跳转后恢复） ===
(async function init() {
  const state = await getState();
  if (state && state.pendingTask) {
    stopFlag = state.pendingTask.stopFlag || false;
    // 等待一键复制按钮出现
    const btnReady = await waitForCopyButton(15000);
    if (!btnReady) {
      console.warn('[QBT] 页面加载后未检测到一键复制按钮，2秒后重试...');
      await sleep(2000);
      const retry = await waitForCopyButton(10000);
      if (!retry) {
        console.error('[QBT] 一键复制按钮加载超时');
      }
    }
    await resumeAfterReload(state.pendingTask);
  }
})();

async function resumeAfterReload(task) {
  console.log('[QBT] 页面跳转后恢复, 渠道:', task.channel, '品牌:', task.brand);

  // 通过一键复制按钮获取数据
  const data = await copyAndParseData();
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

// === 等待一键复制按钮出现 ===
function waitForCopyButton(timeout = 15000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const check = () => {
      if (Date.now() - startTime > timeout) { resolve(false); return; }
      const btn = getCopyButton();
      if (btn) { resolve(true); return; }
      setTimeout(check, 500);
    };
    check();
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function getCopyButton() {
  return getElementByXPath(
    '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[5]/div/div[2]/div[1]/div/div[2]/div[1]/div[1]/button'
  );
}

// === 通过一键复制获取并解析数据 ===
function copyAndParseData() {
  return new Promise((resolve) => {
    const btn = getCopyButton();
    if (!btn) {
      console.warn('[QBT] 未找到一键复制按钮');
      resolve([]);
      return;
    }

    let resolved = false;
    let capturedText = null;

    // 猴子补丁拦截 navigator.clipboard.write（页面用的是 Clipboard API）
    const originalWrite = navigator.clipboard.write.bind(navigator.clipboard);
    navigator.clipboard.write = async function (clipboardItems) {
      console.log('[QBT] 拦截到 clipboard.write, items:', clipboardItems.length);
      for (const item of clipboardItems) {
        if (item.types.includes('text/plain')) {
          try {
            const blob = await item.getType('text/plain');
            capturedText = await blob.text();
            console.log('[QBT] 捕获到文本数据, 长度:', capturedText.length);
          } catch (e) {
            console.warn('[QBT] 提取 text/plain 失败:', e.message);
          }
        }
      }
    };

    // 点击按钮
    btn.click();

    // 等待 ClipboardItem promises 完成
    setTimeout(async () => {
      navigator.clipboard.write = originalWrite;
      if (resolved) return;
      resolved = true;

      if (capturedText) {
        console.log('[QBT] 成功捕获剪贴板数据');
        resolve(parseTSV(capturedText));
      } else {
        console.warn('[QBT] 未能捕获剪贴板数据');
        resolve([]);
      }
    }, 1500);
  });
}

// === 解析 TSV 数据 ===
// 复制的数据格式（制表符分隔）：
// Row 0: 类别名称\t202601\t202602\t...\t总计
// Row 1: 销售额\t销售额\t销售额\t...\t销售额     ← 跳过
// Row 2: 0-∞元\t79339027\t60920183\t...\t...  ← 数据行
// Row 3: 总计\t...                              ← 跳过
function parseTSV(tsvText) {
  console.log('[QBT] 原始复制数据:\n', tsvText);

  if (!tsvText || tsvText.trim().length === 0) {
    console.warn('[QBT] 复制数据为空');
    return [];
  }

  // 按换行分割
  const lines = tsvText.split(/\r?\n/).filter(line => line.trim().length > 0);
  console.log('[QBT] 共', lines.length, '行');

  if (lines.length < 2) {
    console.warn('[QBT] 数据行数不足');
    return [];
  }

  // 将每行按制表符分割
  const rows = lines.map(line => line.split('\t'));

  // 移除第2行（index 1，销售额子表头）
  // 移除最后一行（总计）
  // 同时移除每行最后一列（总计列）
  const processedRows = [];
  for (let i = 0; i < rows.length; i++) {
    // 跳过 Row 1（销售额子表头）和最后一行（总计）
    if (i === 1 || i === rows.length - 1) continue;
    // 去掉最后一列
    processedRows.push(rows[i].slice(0, -1));
  }

  if (processedRows.length < 2) {
    console.warn('[QBT] 处理后数据行数不足');
    return [];
  }

  // 第一行是表头（类别名称 + 月份列）
  const headerRow = processedRows[0];
  const monthHeaders = headerRow.slice(1); // 跳过"类别名称"列
  console.log('[QBT] 月份列:', monthHeaders);

  // 从面包屑获取真实类目名称
  const categoryName = getCategoryFromBreadcrumb();
  console.log('[QBT] 类目名称:', categoryName);

  // 后续行是数据行
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
