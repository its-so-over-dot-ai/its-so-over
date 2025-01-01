// popup.js

let isRequestInProgress = false; // Flag to track if an API call is in progress

// Helper function to truncate HTML content to a limited length string
function truncateHtmlContent(htmlString, maxLength = 10000) {
  return htmlString.length > maxLength ? htmlString.slice(0, maxLength) : htmlString;
}

function resizeImage(base64Str, targetPixelCount) {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const originalPixelCount = img.width * img.height;
      const scale = Math.sqrt(targetPixelCount / originalPixelCount);
      const newWidth = Math.round(img.width * scale);
      const newHeight = Math.round(img.height * scale);

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      canvas.width = newWidth;
      canvas.height = newHeight;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL());
    };
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const actionInput = document.getElementById("actionInput");
  const lastActionDiv = document.getElementById("lastAction");
  const lastActionText = document.getElementById("lastActionText");
  const htmlToggle = document.getElementById("htmlToggle");
  const apiKeyInput = document.getElementById("apiKeyInput");
  const saveApiKeyButton = document.getElementById("saveApiKey");

  // Load the last action, toggle state, and API key from localStorage
  const lastAction = localStorage.getItem("lastAction");
  const sendFullHTML = localStorage.getItem("sendFullHTML") === "true";
  const storedApiKey = localStorage.getItem("OPENROUTER_API_KEY");

  if (lastAction) {
    lastActionText.textContent = lastAction;
    lastActionDiv.style.display = "block";
  }

  htmlToggle.checked = sendFullHTML;

  if (storedApiKey) {
    apiKeyInput.value = storedApiKey;
  }

  // Auto-select the input field when the popup opens
  actionInput.focus();

  // Handle Enter key press to submit the form
  actionInput.addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
      event.preventDefault(); // Prevent form submission
      document.getElementById("saveAction").click(); // Trigger button click
    }
  });

  // Handle click on the last action to re-trigger it
  lastActionDiv.addEventListener("click", () => {
    actionInput.value = lastAction;
    document.getElementById("saveAction").click();
  });

  // Save toggle state to localStorage
  htmlToggle.addEventListener("change", () => {
    localStorage.setItem("sendFullHTML", htmlToggle.checked);
  });

  // Handle saving the API key
  saveApiKeyButton.addEventListener("click", () => {
    const apiKey = apiKeyInput.value.trim();
    if (apiKey) {
      localStorage.setItem("OPENROUTER_API_KEY", apiKey);
      alert("API Key saved successfully.");
    } else {
      alert("Please enter a valid API Key.");
    }
  });
});

document.getElementById("saveAction").addEventListener("click", async () => {
  const action = document.getElementById("actionInput").value;
  const sendFullHTML = document.getElementById("htmlToggle").checked;
  const OPENROUTER_API_KEY = localStorage.getItem("OPENROUTER_API_KEY");

  if (!OPENROUTER_API_KEY) {
    alert("Please enter and save your OpenRouter API Key.");
    return;
  }

  if (action && !isRequestInProgress) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: "displayMessage",
        message: `Action saved: ${action}`,
        role: "User",
      });
    });

    isRequestInProgress = true; // Set flag to indicate a request is in progress

    // Save the current action to localStorage
    localStorage.setItem("lastAction", action);

    const actionHistory = []; // Array to store action history

    chrome.storage.local.set({ userAction: action }, () =>
      console.log("Action saved:", action)
    );

    // Step 1: Break down the objective into a detailed plan
    const detailedPlan = await getDetailedPlan(action, OPENROUTER_API_KEY);
    if (detailedPlan) {
      actionHistory.push(detailedPlan);
      console.log("Detailed Plan:", detailedPlan);
      alert(`Detailed Plan:\n${detailedPlan}`); // Alert the detailed plan to the user
    } else {
      console.error("Failed to generate a detailed plan.");
      alert("Failed to generate a detailed plan. Please try again.");
    }

    // Query the current active tab
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      const tabId = tab.id;
      const currentUrl = tab.url; // Get the current page URL
      console.log(`Current Tab URL: ${currentUrl}`);

      if (
        currentUrl.startsWith("chrome://") ||
        currentUrl.startsWith("chrome-extension://")
      ) {
        alert("This extension cannot access chrome:// or chrome-extension:// URLs.");
        console.log("Access denied to chrome:// or chrome-extension:// URLs.");
        isRequestInProgress = false; // Reset flag
        return;
      }

      // Alert the user before making the OpenRouter API call
      const userApproval = confirm(
        "OpenRouter API will be called to determine the next action. Do you approve?"
      );
      if (!userApproval) {
        isRequestInProgress = false;
        return; // Exit if user does not approve
      }

      try {
        // Start the loop until the objective is achieved
        let objectiveAchieved = false;
        while (!objectiveAchieved) {
          let screenshot = await chrome.tabs.captureVisibleTab();
          console.log("Screenshot captured successfully.");
          const targetPixelCount = 48000; // Example: 48000 pixels
          screenshot = await resizeImage(screenshot, targetPixelCount);
          console.log("Screenshot resized successfully.");

          // Fetch HTML content with expanded context for relevant elements
          const htmlContent = await new Promise((resolve) => {
            chrome.scripting.executeScript(
              {
                target: { tabId },
                func: () => {
                  const bodyClone = document.body.cloneNode(true);

                  // Remove <script> and <head> tags
                  const scriptsAndHead = bodyClone.querySelectorAll("script, head");
                  scriptsAndHead.forEach((el) => el.remove());

                  // Serialize to a single HTML string
                  return bodyClone.innerHTML;
                },
              },
              (results) => resolve(results[0]?.result || "")
            );
          });

          // Decide whether to send full HTML or truncated HTML + screenshot
          const contentToSend = sendFullHTML
            ? htmlContent.slice(0, 120000 / 4.5)
            : truncateHtmlContent(htmlContent);
          const screenshotToSend = sendFullHTML
            ? ""
            : `Current Screenshot:\n${screenshot}`;

          console.log("Content to send:", contentToSend);

          // Single API Call to OpenRouter for Action Suggestion or Task Completion
          const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${OPENROUTER_API_KEY}`
            },
            body: JSON.stringify({
              model: "openai/gpt-3.5-turbo",
              messages: [
                {
                  role: "system",
                  content: `
You are an expert automated browsing LLM agent. Your task is to assist with browser
automation by using the current screenshot and HTML content as the ground truth for the
page's status. Use the detailed plan as guidance, but rely on the current status to
determine if an action was successful and what to do next. The response should be a
JSON object containing reasoning and result fields. The "reasoning" field will explain
the chain of thought, and the "result" field will suggest the next action in the form
of an action_type (click, type, navigate, or achieved) with details about the target
and any additional information needed to complete the action. Ensure the structure
adheres to the following schema:

* click: To simulate a click event, specify the target as either id, text, or href,
followed by the element value. For example:
    * {
        "reasoning": "The button with the text 'Submit' needs to be clicked.",
        "result": {
            "action_type": "click",
            "target": {
                "type": "text",
                "value": "Submit"
            },
            "details": ""
        }
    }
* type: To simulate a typing event, specify the target as either id or text, followed
by the text to be typed. For example:
    * {
        "reasoning": "The input field with the id 'username' needs to be typed
'myusername'.",
        "result": {
            "action_type": "type",
            "target": {
                "type": "id",
                "value": "username"
            },
            "details": "myusername"
        }
    }
* navigate: To navigate to a specific URL, specify the target as only the url value.
For example:
    * {
        "reasoning": "The page needs to be navigated to 'https://www.example.com'.",
        "result": {
            "action_type": "navigate",
            "target": {
                "type": "",
                "value": "https://www.example.com"
            },
            "details": ""
        }
    }
* achieved: This action type is used to indicate that a specific action has been
successfully completed. For example:
    * {
        "reasoning": "The login process has been successfully completed.",
        "result": {
            "action_type": "achieved",
            "target": {},
            "details": ""
        }
    }`,
                },
                {
                  role: "user",
                  content: `Objective: "${action}". Current URL: ${currentUrl}. Action History:\n${JSON.stringify(
                    actionHistory.slice(-3)
                  )}\nHTML Content:\n${contentToSend}\n${screenshotToSend}`,
                },
              ],
              temperature: 0,
              max_tokens: 250,
              response_format: { type: "json_object" },
            }),
          });

          if (!response.ok) {
            const errorResponse = await response.json();
            console.error("Failed to get detailed plan:", errorResponse);
            alert("Failed to generate a detailed plan.");
            break;
          }

          const llmResponse = await response.json();

          if (llmResponse.refusal) {
            console.error("Refusal from OpenRouter API:", llmResponse.refusal);
            alert("The assistant refused to provide an action. Please try again.");
            break;
          }

          if (!llmResponse.choices || llmResponse.choices.length === 0) {
            console.error("No choices returned from OpenRouter API.");
            alert("No response from the assistant. Please try again.");
            break;
          }

          let parsedResponse;
          try {
            parsedResponse = JSON.parse(llmResponse.choices[0].message.content);
          } catch (parseError) {
            console.error("Failed to parse API response:", parseError);
            alert("Invalid response format from the assistant.");
            break;
          }

          // Send message to content.js to display in sidebar
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, {
              type: "displayMessage",
              message:
                parsedResponse.reasoning +
                " Action: " +
                JSON.stringify(parsedResponse.result),
              role: "Assistant",
            });
          });

          const suggestedAction = parsedResponse.result;

          // Handle the suggested action based on its type
          if (suggestedAction.action_type === "achieved") {
            const userConfirm = confirm(
              "The task was marked as achieved. Do you confirm the task completion?"
            );
            if (userConfirm) {
              alert("Task achieved. Stopping further actions.");
              objectiveAchieved = true;
              break;
            } else {
              // If user does not confirm, continue the loop
              console.log("User did not confirm task completion.");
              continue;
            }
          }

          // Perform the suggested action
          await performSuggestedAction(suggestedAction, tabId);

          // Add the performed action to the history
          actionHistory.push(suggestedAction);

          // Optional: Add a delay between actions to avoid rapid-fire actions
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        console.log("Objective has been achieved or task completion was confirmed.");
      } catch (error) {
        console.error("Error fetching detailed plan:", error);
        alert("Error fetching detailed plan. Please check the console.");
      }

      isRequestInProgress = false; // Reset flag after completion
    });
  }
});

/**
 * Function to get the detailed plan from OpenRouter
 * @param {string} action - The user-provided action
 * @param {string} apiKey - The OpenRouter API Key
 * @returns {Promise<string|null>} - Returns the detailed plan as a string or null if failed
 */
async function getDetailedPlan(action, apiKey) {
  try {
    // Make the API call to OpenRouter
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "openai/gpt4o-mini",
        messages: [
          {
            role: "system",
            content: `
You are an expert task planner. Break down the following objective into a detailed, step-by-step plan to accomplish it. Each step should be actionable and clear.
Objective: "${action}"`
          }
        ],
        temperature: 0.5,
        response_format: { type: "json_schema" },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("API Error:", errorData);
      return null;
    }

    const data = await response.json();
    const detailedPlan = data.choices[0].message.content.trim();
    return detailedPlan;
  } catch (error) {
    console.error("Error fetching detailed plan:", error);
    return null;
  }
}

/**
 * Function to perform the suggested action
 * @param {Object} action - The action object containing action_type, target, and details
 * @param {number} tabId - The ID of the current tab
 */
async function performSuggestedAction(action, tabId) {
  try {
    switch (action.action_type) {
      case "click":
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (type, value) => {
            let element;
            switch (type) {
              case "id":
                element = document.getElementById(value);
                break;
              case "text":
                element = Array.from(document.querySelectorAll("*")).find(
                  (el) => el.textContent.trim() === value
                );
                break;
              case "href":
                element = Array.from(document.querySelectorAll("a")).find(
                  (el) => el.href === value
                );
                break;
              default:
                console.error("Unknown target type for click:", type);
            }
            if (element) {
              element.click();
            } else {
              console.error("Element not found for click action.");
            }
          },
          args: [action.target.type, action.target.value],
        });
        console.log("Clicked on element:", action.target);
        break;

      case "type":
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (type, value, details) => {
            let inputElement;
            switch (type) {
              case "id":
                inputElement = document.getElementById(value);
                break;
              case "text":
                inputElement = Array.from(document.querySelectorAll("input, textarea")).find(
                  (el) => el.placeholder === value || el.getAttribute("aria-label") === value
                );
                break;
              default:
                console.error("Unknown target type for type:", type);
            }
            if (inputElement) {
              inputElement.value = details;
              inputElement.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
              console.error("Input element not found for type action.");
            }
          },
          args: [action.target.type, action.target.value, action.details],
        });
        console.log("Typed into element:", action.target);
        break;

      case "navigate":
        await chrome.tabs.update(tabId, { url: action.target.value });
        console.log("Navigated to URL:", action.target.value);
        break;

      case "achieved":
        // No action needed; the loop will handle stopping
        console.log("Objective achieved.");
        break;

      default:
        console.error("Unknown action type:", action.action_type);
    }
  } catch (error) {
    console.error("Error performing action:", error);
    alert("An error occurred while performing the action. Please check the console.");
  }
}