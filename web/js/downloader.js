import { app } from "../../../scripts/app.js";
import { DownloaderUI } from "./UI.js";

console.log("Loading ComfyUI-Downloader...");

// --- Configuration ---
const EXTENSION_NAME = "ComfyUI-Downloader";
const API_PREFIX = "35b631e00fa2dbc173ee4a5f899cba8f";
const CSS_URL = `/${API_PREFIX}/extensions/ComfyUI-Downloader/css/downloader.css`;

// Load CSS
function loadCSS() {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.type = "text/css";
    link.href = CSS_URL;
    document.head.appendChild(link);
}

// Add Menu Button to ComfyUI
let retryCount = 0;
const MAX_RETRIES = 10;

function addMenuButton() {
    const buttonGroup = document.querySelector(".comfyui-button-group");

    if (!buttonGroup) {
        retryCount++;
        if (retryCount < MAX_RETRIES) {
            console.warn(`[${EXTENSION_NAME}] ComfyUI button group not found. Retrying... (${retryCount}/${MAX_RETRIES})`);
            setTimeout(addMenuButton, 500);
            return;
        } else {
            console.warn(`[${EXTENSION_NAME}] Button group not found after ${MAX_RETRIES} attempts. Creating button in absolute position.`);
            createAbsolutePositionButton();
            return;
        }
    }

    if (document.getElementById("downloader-button")) {
        console.log(`[${EXTENSION_NAME}] Button already exists.`);
        return;
    }

    const downloaderButton = document.createElement("button");
    downloaderButton.textContent = "Downloader";
    downloaderButton.id = "downloader-button";
    downloaderButton.title = "Open Downloader";
    downloaderButton.style.margin = "0 5px";

    downloaderButton.onclick = async () => {
        if (!window.downloaderUI) {
            console.info(`[${EXTENSION_NAME}] Creating DownloaderUI instance...`);
            window.downloaderUI = new DownloaderUI();

            try {
                await window.downloaderUI.initializeUI();
                console.info(`[${EXTENSION_NAME}] UI Initialization complete.`);
            } catch (error) {
                console.error(`[${EXTENSION_NAME}] Error during UI initialization:`, error);
            }
        }

        if (window.downloaderUI) {
            window.downloaderUI.openModal();
        } else {
            console.error(`[${EXTENSION_NAME}] Cannot open modal: UI instance not available.`);
            alert("Downloader failed to initialize. Please check the browser console for errors.");
        }
    };

    buttonGroup.appendChild(downloaderButton);
    console.log(`[${EXTENSION_NAME}] Downloader button added to .comfyui-button-group.`);

    const menu = document.querySelector(".comfy-menu");
    if (!buttonGroup.contains(downloaderButton) && menu && !menu.contains(downloaderButton)) {
        console.warn(`[${EXTENSION_NAME}] Failed to append button to group, falling back to menu.`);
        const settingsButton = menu.querySelector("#comfy-settings-button");
        if (settingsButton) {
            settingsButton.insertAdjacentElement("beforebegin", downloaderButton);
        } else {
            menu.appendChild(downloaderButton);
        }
    }
}

function createAbsolutePositionButton() {
    if (document.getElementById("downloader-button")) {
        console.log(`[${EXTENSION_NAME}] Button already exists.`);
        return;
    }

    const downloaderButton = document.createElement("button");
    downloaderButton.textContent = "Downloader";
    downloaderButton.id = "downloader-button";
    downloaderButton.title = "Open Downloader";
    
    // Absolute positioning - right middle
    downloaderButton.style.position = "fixed";
    downloaderButton.style.right = "10px";
    downloaderButton.style.top = "50%";
    downloaderButton.style.transform = "translateY(-50%)";
    downloaderButton.style.zIndex = "9999";
    downloaderButton.style.padding = "10px 15px";
    downloaderButton.style.backgroundColor = "#4CAF50";
    downloaderButton.style.color = "white";
    downloaderButton.style.border = "none";
    downloaderButton.style.borderRadius = "5px";
    downloaderButton.style.cursor = "pointer";
    downloaderButton.style.boxShadow = "0 2px 5px rgba(0,0,0,0.3)";

    downloaderButton.onclick = async () => {
        if (!window.downloaderUI) {
            console.info(`[${EXTENSION_NAME}] Creating DownloaderUI instance...`);
            window.downloaderUI = new DownloaderUI();

            try {
                await window.downloaderUI.initializeUI();
                console.info(`[${EXTENSION_NAME}] UI Initialization complete.`);
            } catch (error) {
                console.error(`[${EXTENSION_NAME}] Error during UI initialization:`, error);
            }
        }

        if (window.downloaderUI) {
            window.downloaderUI.openModal();
        } else {
            console.error(`[${EXTENSION_NAME}] Cannot open modal: UI instance not available.`);
            alert("Downloader failed to initialize. Please check the browser console for errors.");
        }
    };

    document.body.appendChild(downloaderButton);
    console.log(`[${EXTENSION_NAME}] Downloader button added in absolute position (right middle).`);
}

// --- Initialization ---
app.registerExtension({
    name: "ComfyUI-Downloader.Downloader",
    async setup(appInstance) {
        console.log(`[${EXTENSION_NAME}] Setting up Downloader Extension...`);
        loadCSS();
        addMenuButton();
        console.log(`[${EXTENSION_NAME}] Extension setup complete. UI will initialize on first click.`);
    },
});
