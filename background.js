// background.js — 轻量 Service Worker
// 为 popup 提供 scraperState 的读取接口
// popup 和 content script 之间通过 chrome.tabs.sendMessage 直接通信
// 状态写入由 content script 和 popup 直接操作 chrome.storage.local

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getState') {
    chrome.storage.local.get(['scraperState'], (result) => {
      if (chrome.runtime.lastError) {
        sendResponse({ status: 'error', error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse(result.scraperState || { status: 'idle', progress: 0, total: 0, results: [] });
    });
    return true;
  }

  if (message.type === 'getTabId') {
    sendResponse({ tabId: sender.tab ? sender.tab.id : null });
    return true;
  }

  if (message.type === 'updateBadge') {
    if (message.text) {
      chrome.action.setBadgeText({ text: message.text });
      chrome.action.setBadgeBackgroundColor({ color: message.color || '#1a56db' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  }
});
