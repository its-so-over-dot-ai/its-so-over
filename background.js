// background.js

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "executeAction") {
    console.log("Executing action:", message.action);
    // Add specific action execution logic here or forward the action to content scripts
    // For example, you can send a message to the active tab's content script to perform the action
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: "executeAction",
          action: message.action,
        }, (response) => {
          sendResponse({ status: "Action executed", details: response });
        });
      } else {
        sendResponse({ status: "No active tab found." });
      }
    });
    // Return true to indicate that the response will be sent asynchronously
    return true;
  }
});