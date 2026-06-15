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
