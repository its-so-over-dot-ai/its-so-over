document.addEventListener("DOMContentLoaded", () => {

    // Debugging: Confirm that sidebar.js is loaded
    console.log("sidebar.js has been loaded.");
    
    // Listen for messages from the parent (content script)
    window.addEventListener("message", (event) => {
      const { type, message, role } = event.data;
    
      if (type === "displayMessage") {
        displayMessage(message, role);
      }
    });
    
    // Function to display messages in the sidebar
    function displayMessage(message, role) {
      const sidebar = document.getElementById("messageBubble");
      if (sidebar) {
        const messageElement = document.createElement("div");
        messageElement.style.marginBottom = "10px";
        messageElement.innerHTML = `<b>${role}:</b> ${message}`;
        sidebar.appendChild(messageElement);
        // Scroll to the bottom
        sidebar.scrollTop = sidebar.scrollHeight;
      } else {
        console.error("Sidebar message bubble not found.");
      }
    }
    
    // Toggle functionality
    const toggleButton = document.getElementById("toggleSidebar");
    const sidebar = document.getElementById("messageBubble");
    const actionAssistantSidebar = document.getElementById("bodyaction");
    
    
    toggleButton.addEventListener("click", () => {
        console.log(actionAssistantSidebar)
      if (sidebar.classList.contains("hidden")) {
        sidebar.classList.remove("hidden");
        actionAssistantSidebar.style.display = 'block';
        toggleButton.textContent = "Hide Sidebar";
        console.log("Sidebar shown.");
      } else {
        actionAssistantSidebar.style.display= 'none';
        sidebar.classList.add("hidden");
        toggleButton.textContent = "Show Sidebar";
        console.log("Sidebar hidden.");
      }
    });
    });