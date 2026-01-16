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
function addMenuButton() {
    const buttonGroup = document.querySelector(".comfyui-button-group");

    if (!buttonGroup) {
        console.warn(`[${EXTENSION_NAME}] ComfyUI button group not found. Retrying...`);
        setTimeout(addMenuButton, 500);
        return;
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
            document.body.appendChild(window.downloaderUI.modal);

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
