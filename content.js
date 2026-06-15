// content.js — Nint 页面 DOM 操控自动化

let stopFlag = false;
let isRunning = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startScraping') {
    if (isRunning) {
      sendResponse({ accepted: false, reason: 'already running' });
      return;
    }
    stopFlag = false;
    isRunning = true;
    scrapeAllBrands(message.brands).finally(() => { isRunning = false; });
    sendResponse({ accepted: true });
  } else if (message.action === 'stopScraping') {
    stopFlag = true;
    sendResponse({ accepted: true });
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

function ensureCustomSelected() {
  const select = getElementByXPath(
    '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[2]/form/table/tbody/tr[2]/td[2]/div/select'
  );
  if (!select) { console.warn('[QBT] 未找到"自定义"下拉框元素'); return; }

  const selectedOption = select.options[select.selectedIndex];
  if (selectedOption && selectedOption.text.includes('自定义')) return;

  // 选第一个选项（自定义在列表顶部）
  select.selectedIndex = 0;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function inputBrandName(brand) {
  const input = getElementByXPath(
    '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[2]/form/table/tbody/tr[2]/td[2]/div/input'
  );
  if (!input) { console.warn('[QBT] 未找到品牌输入框元素'); return; }

  // 清空并输入新值
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.value = brand;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function ensureCheckboxSelected(labelText) {
  const labels = document.querySelectorAll('label');
  let targetLabel = null;
  for (const label of labels) {
    if (label.textContent.trim() === labelText) {
      targetLabel = label;
      break;
    }
  }
  if (!targetLabel) { console.warn('[QBT] 未找到"' + labelText + '"复选框元素'); return; }

  // 检查是否已选中：查找关联的 input
  const input = targetLabel.querySelector('input') || targetLabel.previousElementSibling;
  if (input && (input.type === 'checkbox' || input.type === 'radio') && input.checked) return;

  // 检查 ::after 伪元素 — 通过 computed style
  const afterStyle = window.getComputedStyle(targetLabel, '::after');
  if (afterStyle && afterStyle.content && afterStyle.content !== 'none') return;

  // 未选中，点击
  targetLabel.click();
}

function ensureCheckboxDeselected(labelText) {
  const labels = document.querySelectorAll('label');
  let targetLabel = null;
  for (const label of labels) {
    if (label.textContent.trim() === labelText) {
      targetLabel = label;
      break;
    }
  }
  if (!targetLabel) { console.warn('[QBT] 未找到"' + labelText + '"复选框元素'); return; }

  const input = targetLabel.querySelector('input') || targetLabel.previousElementSibling;
  if (input && (input.type === 'checkbox' || input.type === 'radio') && !input.checked) return;

  const afterStyle = window.getComputedStyle(targetLabel, '::after');
  if (!afterStyle || !afterStyle.content || afterStyle.content === 'none') return;

  // 已选中，点击取消
  targetLabel.click();
}

function clickSearch() {
  const btn = getElementByXPath(
    '/html/body/div[1]/div[2]/div[1]/div[3]/div/div[3]/div[2]/form/div[2]/button'
  );
  if (btn) btn.click();
  else console.warn('[QBT] 未找到检索按钮');
}

function waitForTableReload(timeout = 30000) {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const check = () => {
      if (stopFlag) { resolve(); return; }
      if (Date.now() - startTime > timeout) { console.warn('[QBT] 表格加载超时'); resolve(); return; }

      // 检查表格是否已重新加载
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
