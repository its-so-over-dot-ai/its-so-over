// content.js

// Function to inject the sidebar into the webpage
function injectSidebar() {
  if (document.getElementById("actionAssistantSidebar")) {
    // Sidebar already exists
    return;
  }

  const iframe = document.createElement("iframe");
  iframe.src = chrome.runtime.getURL("sidebar.html");
  iframe.style.width = "300px";
  iframe.style.height = "100%";
  iframe.style.position = "fixed";
  iframe.style.top = "0";
  iframe.style.right = "0";
  iframe.style.zIndex = "100000";
  iframe.style.border = "none";
  iframe.id = "actionAssistantSidebar";
  document.body.appendChild(iframe);
}

// Inject the sidebar when the content script runs
injectSidebar();

// Listener for messages from popup.js or background.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "displayMessage") {
    // Find the iframe
    const iframe = document.getElementById("actionAssistantSidebar");
    if (iframe) {
      // Post message to the iframe's content window
      iframe.contentWindow.postMessage(request, "*");
      sendResponse({ status: "Message sent to sidebar" });
    } else {
      console.error("Sidebar iframe not found.");
      sendResponse({ status: "Sidebar iframe not found." });
    }
  } else if (request.type === "executeAction") {
    // Execute the received action
    executeAction(request.action);
    sendResponse({ status: "Action execution started." });
  }
});

// Function to execute an action
function executeAction(action) {
  switch (action.action_type) {
    case "click":
      handleClickAction(action.target);
      break;
    case "type":
      handleTypeAction(action.target, action.details);
      break;
    case "navigate":
      handleNavigateAction(action.target.value);
      break;
    case "achieved":
      console.log("Objective achieved.");
      break;
    default:
      console.error("Unknown action type:", action.action_type);
  }
}

function handleClickAction(target) {
  let element;
  switch (target.type) {
    case "id":
      element = document.getElementById(target.value);
      break;
    case "text":
      element = Array.from(document.querySelectorAll("*")).find(
        (el) => el.textContent.trim() === target.value
      );
      break;
    case "href":
      element = Array.from(document.querySelectorAll("a")).find(
        (el) => el.href === target.value
      );
      break;
    default:
      console.error("Unknown target type for click:", target.type);
  }
  if (element) {
    element.click();
    console.log("Clicked on element:", target);
  } else {
    console.error("Element not found for click action.");
  }
}

function handleTypeAction(target, details) {
  let inputElement;
  switch (target.type) {
    case "id":
      inputElement = document.getElementById(target.value);
      break;
    case "text":
      inputElement = Array.from(document.querySelectorAll("input, textarea")).find(
        (el) => el.placeholder === target.value || el.getAttribute("aria-label") === target.value
      );
      break;
    default:
      console.error("Unknown target type for type:", target.type);
  }
  if (inputElement) {
    inputElement.value = details;
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    console.log("Typed into element:", target);
  } else {
    console.error("Input element not found for type action.");
  }
}

function handleNavigateAction(url) {
  window.location.href = url;
  console.log("Navigated to URL:", url);
}