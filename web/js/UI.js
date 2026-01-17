import { api } from "../../../scripts/api.js";

const API_PREFIX = "35b631e00fa2dbc173ee4a5f899cba8f";

export class DownloaderUI {
    constructor() {
        this.modal = null; // Modal will be created when opened
        this.isInitialized = false;
        this.modelsInWorkflow = [];
        this.modelListCache = null; // Cache for model-list.json
        this.modelExtensionsCache = null; // Cache for supported extensions
        this.folderNamesCache = null; // Cache for folder names
        this.objectInfoCache = null; // Cache for object_info
        this.availableFilesCache = null; // Cache for parsed available files
        this.downloadStates = new Map(); // Track download states
        this.setupDownloadListeners();
    }

    /**
     * Setup listeners for download progress events
     */
    setupDownloadListeners() {
        api.addEventListener("server_download_progress", ({ detail }) => {
            const { download_id, progress, downloaded, total } = detail;
            this.downloadStates.set(download_id, {
                status: 'downloading',
                progress,
                downloaded,
                total
            });
            this.updateDownloadButton(download_id);
        });

        api.addEventListener("server_download_complete", ({ detail }) => {
            const { download_id, path } = detail;
            this.downloadStates.set(download_id, {
                status: 'completed',
                progress: 100,
                path
            });
            this.updateDownloadButton(download_id);
            console.log(`[DownloaderUI] Download completed: ${download_id}`);
        });

        api.addEventListener("server_download_error", ({ detail }) => {
            const { download_id, error } = detail;
            this.downloadStates.set(download_id, {
                status: 'error',
                error
            });
            this.updateDownloadButton(download_id);
            console.error(`[DownloaderUI] Download error: ${download_id} - ${error}`);
        });
    }

    /**
     * Update download button based on current state
     */
    updateDownloadButton(downloadId) {
        const button = this.modal.querySelector(`[data-download-id="${downloadId}"]`);
        if (!button) return;

        const state = this.downloadStates.get(downloadId);
        if (!state) return;

        switch (state.status) {
            case 'queued':
                button.textContent = 'Cancel';
                button.disabled = false;
                button.style.backgroundColor = '#ffa500';
                button.dataset.action = 'cancel';
                break;
            case 'downloading':
                button.textContent = `Cancel (${state.progress}%)`;
                button.disabled = false;
                button.style.backgroundColor = '#2196F3';
                button.dataset.action = 'cancel';
                break;
            case 'completed':
                button.textContent = '✓ Downloaded';
                button.disabled = false;
                button.style.backgroundColor = '#4CAF50';
                button.dataset.action = 'none';
                break;
            case 'error':
                button.textContent = '✗ Error';
                button.disabled = false;
                button.style.backgroundColor = '#f44336';
                button.title = state.error;
                button.dataset.action = 'download';
                break;
        }
    }

    /**
     * Cancel a server download
     */
    async cancelServerDownload(downloadId) {
        try {
            const response = await api.fetchApi(`/${API_PREFIX}/server_download/cancel`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    download_id: downloadId
                })
            });

            const result = await response.json();

            if (response.ok && result.success) {
                console.log(`[DownloaderUI] Download cancelled: ${downloadId}`);
                // Reset button state
                this.downloadStates.delete(downloadId);
                const button = this.modal.querySelector(`[data-download-id="${downloadId}"]`);
                if (button) {
                    button.textContent = 'Download';
                    button.disabled = false;
                    button.style.backgroundColor = '#4CAF50';
                    button.dataset.action = 'download';
                }
                return { success: true };
            } else {
                alert(`Failed to cancel download: ${result.error || 'Unknown error'}`);
                return { success: false, error: result.error };
            }
        } catch (error) {
            console.error("[DownloaderUI] Failed to cancel download:", error);
            alert(`Failed to cancel download: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * Start a server download
     */
    async startServerDownload(url, savePath, filename, override = false) {
        if (!url || !savePath || !filename) {
            alert('Missing download information. Please provide URL and directory.');
            return;
        }

        try {
            const download_id = `${savePath}/${filename}`;

            // Mark as queued immediately
            this.downloadStates.set(download_id, {
                status: 'queued',
                progress: 0
            });
            this.updateDownloadButton(download_id);

            const response = await api.fetchApi(`/${API_PREFIX}/server_download/start`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    url,
                    save_path: savePath,
                    filename,
                    override
                })
            });

            const result = await response.json();

            // Handle file override confirmation
            if (result.confirm_override) {
                // Reset button state
                this.downloadStates.delete(download_id);
                this.updateDownloadButton(download_id);
                
                // Show simple confirmation dialog
                const confirmed = confirm(`${result.message}\n\nDo you want to overwrite it?`);
                
                if (confirmed) {
                    // Retry with override=true
                    return await this.startServerDownload(url, savePath, filename, true);
                } else {
                    // User cancelled
                    this.downloadStates.delete(download_id);
                    const button = this.modal.querySelector(`[data-download-id="${download_id}"]`);
                    if (button) {
                        button.textContent = 'Download';
                        button.disabled = false;
                        button.style.backgroundColor = '#4CAF50';
                    }
                    return { success: false, cancelled: true };
                }
            }

            if (response.ok) {
                console.log(`[DownloaderUI] Download started: ${download_id}`);
                return { success: true, download_id };
            } else {
                this.downloadStates.set(download_id, {
                    status: 'error',
                    error: result.error || 'Unknown error'
                });
                this.updateDownloadButton(download_id);
                alert(`Download failed: ${result.error}`);
                return { success: false, error: result.error };
            }
        } catch (error) {
            console.error("[DownloaderUI] Failed to start download:", error);
            alert(`Failed to start download: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * Load model-list.json and cache it
     */
    async loadModelList() {
        if (this.modelListCache) {
            return this.modelListCache;
        }

        try {
            const response = await fetch('https://raw.githubusercontent.com/Comfy-Org/ComfyUI-Manager/main/model-list.json');
            if (!response.ok) {
                console.warn("[DownloaderUI] Failed to load model-list.json");
                return null;
            }
            this.modelListCache = await response.json();
            return this.modelListCache;
        } catch (error) {
            console.warn("[DownloaderUI] Error loading model-list.json:", error);
            return null;
        }
    }

    /**
     * Load supported model extensions from API and cache them
     */
    async loadModelExtensions() {
        if (this.modelExtensionsCache) {
            return this.modelExtensionsCache;
        }

        try {
            const response = await api.fetchApi(`/${API_PREFIX}/supported_extensions`);
            if (!response.ok) {
                console.warn("[DownloaderUI] Failed to load supported extensions, using defaults");
                return ['.ckpt', '.pt', '.pt2', '.bin', '.pth', '.safetensors', '.pkl', '.sft'];
            }
            const data = await response.json();
            if (data.success && Array.isArray(data.extensions)) {
                this.modelExtensionsCache = data.extensions;
                return this.modelExtensionsCache;
            }
            return ['.ckpt', '.pt', '.pt2', '.bin', '.pth', '.safetensors', '.pkl', '.sft'];
        } catch (error) {
            console.warn("[DownloaderUI] Error loading supported extensions:", error);
            return ['.ckpt', '.pt', '.pt2', '.bin', '.pth', '.safetensors', '.pkl', '.sft'];
        }
    }

    /**
     * Load available folder names from API and cache them
     */
    async loadFolderNames() {
        if (this.folderNamesCache) {
            return this.folderNamesCache;
        }

        try {
            const response = await api.fetchApi(`/${API_PREFIX}/folder_names`);
            if (!response.ok) {
                console.warn("[DownloaderUI] Failed to load folder names, using defaults");
                return ['checkpoints', 'loras', 'vae', 'controlnet', 'upscale_models'];
            }
            const data = await response.json();
            if (data.success && Array.isArray(data.folders)) {
                this.folderNamesCache = data.folders;
                return this.folderNamesCache;
            }
            return ['checkpoints', 'loras', 'vae', 'controlnet', 'upscale_models'];
        } catch (error) {
            console.warn("[DownloaderUI] Error loading folder names:", error);
            return ['checkpoints', 'loras', 'vae', 'controlnet', 'upscale_models'];
        }
    }

    /**
     * Load object_info from ComfyUI API to get available files
     */
    async loadObjectInfo() {
        if (this.objectInfoCache) {
            return this.objectInfoCache;
        }

        try {
            const response = await api.fetchApi('/object_info');
            if (!response.ok) {
                console.warn("[DownloaderUI] Failed to load object_info");
                return null;
            }
            this.objectInfoCache = await response.json();
            return this.objectInfoCache;
        } catch (error) {
            console.warn("[DownloaderUI] Error loading object_info:", error);
            return null;
        }
    }

    /**
     * Parse object_info to extract available files by folder
     * Returns a Map: folder -> Set of filenames
     */
    async getAvailableFiles() {
        if (this.availableFilesCache) {
            return this.availableFilesCache;
        }

        const objectInfo = await this.loadObjectInfo();
        if (!objectInfo) {
            return new Map();
        }

        const availableFiles = new Map();

        // Iterate through all node types
        for (const [nodeType, nodeData] of Object.entries(objectInfo)) {
            if (!nodeData.input || !nodeData.input.required) {
                continue;
            }

            // Check each input parameter
            for (const [paramName, paramData] of Object.entries(nodeData.input.required)) {
                if (!Array.isArray(paramData) || paramData.length === 0) {
                    continue;
                }

                const options = paramData[0];
                if (!Array.isArray(options)) {
                    continue;
                }

                // Look for __folder__path__ prefix
                const folderPathItem = options.find(item => 
                    typeof item === 'string' && item.startsWith('__folder__path__')
                );

                if (folderPathItem) {
                    const folder = folderPathItem.replace('__folder__path__', '');
                    
                    if (!availableFiles.has(folder)) {
                        availableFiles.set(folder, new Set());
                    }

                    // Add all other items (filenames) to this folder
                    options.forEach(item => {
                        if (typeof item === 'string' && !item.startsWith('__folder__path__')) {
                            availableFiles.get(folder).add(item);
                        }
                    });
                }
            }
        }

        this.availableFilesCache = availableFiles;
        return availableFiles;
    }

    /**
     * Check if a file exists in the available files
     * @param {string} folder - The folder name
     * @param {string} filename - The filename (can include subdirectories)
     * @returns {boolean} - True if file exists
     */
    async isFileDownloaded(folder, filename) {
        const availableFiles = await this.getAvailableFiles();
        
        if (!availableFiles.has(folder)) {
            return false;
        }

        const filesInFolder = availableFiles.get(folder);
        
        // Check exact match
        if (filesInFolder.has(filename)) {
            return true;
        }

        // Check if any file ends with this filename (for subdirectory cases)
        for (const file of filesInFolder) {
            if (file.endsWith(filename) || file.endsWith('/' + filename)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Look up model info from model-list.json by filename
     */
    async getModelInfo(filename) {
        const modelList = await this.loadModelList();
        if (!modelList || !Array.isArray(modelList.models)) {
            return { url: null, directory: null };
        }

        const model = modelList.models.find(m => m.filename === filename);
        if (!model) {
            return { url: null, directory: null };
        }

        return {
            url: model.url || null,
            // directory: model.save_path || null
        };
    }

    createModal() {
        const modal = document.createElement("div");
        modal.id = "downloader-modal";
        modal.className = "downloader-modal";
        modal.style.display = "none";

        modal.innerHTML = `
            <div class="downloader-modal-content">
                <div class="downloader-modal-header">
                    <h2>Downloader - Models in Workflow</h2>
                    <button class="downloader-close-btn" id="downloader-close-btn">&times;</button>
                </div>
                <div class="downloader-modal-body">
                    <div class="downloader-free-download-section" style="padding: 15px; background: #2a2a2a; border-radius: 5px; margin-bottom: 15px;">
                        <div style="margin: 0 0 10px 0;">Manual Download</div>
                        <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                            <select 
                                id="downloader-free-folder" 
                                class="downloader-free-input"
                                style="flex: 1; min-width: 150px; padding: 5px;"
                            >
                                <option value="">Select folder...</option>
                            </select>
                            <input 
                                type="text" 
                                id="downloader-free-url" 
                                class="downloader-free-input"
                                placeholder="Download URL..." 
                                style="flex: 2; min-width: 300px; padding: 5px;"
                            />
                            <input 
                                type="text" 
                                id="downloader-free-filename" 
                                class="downloader-free-input"
                                placeholder="Filename (auto-detected)" 
                                style="flex: 1; min-width: 200px; padding: 5px;"
                            />
                            <button 
                                id="downloader-free-download-btn"
                                style="padding: 6px 20px; cursor: pointer; background-color: #4CAF50; color: white; border: none; border-radius: 3px; font-weight: bold;"
                            >
                                Download
                            </button>
                        </div>
                    </div>
                    <div class="downloader-refresh-section">
                        <button class="downloader-refresh-btn" id="downloader-refresh-btn">
                            Refresh Models
                        </button>
                        <span class="downloader-model-count" id="downloader-model-count">0 models found</span>
                    </div>
                    <div class="downloader-models-list" id="downloader-models-list">
                        <p class="downloader-loading">Click "Refresh Models" to scan the current workflow...</p>
                    </div>
                </div>
            </div>
        `;

        // Close button handler
        modal.querySelector("#downloader-close-btn").addEventListener("click", () => {
            this.closeModal();
        });

        // Refresh button handler
        modal.querySelector("#downloader-refresh-btn").addEventListener("click", () => {
            this.scanWorkflowForModels();
        });

        // Auto-extract filename from URL
        const urlInput = modal.querySelector("#downloader-free-url");
        const filenameInput = modal.querySelector("#downloader-free-filename");
        
        urlInput.addEventListener("input", () => {
            const url = urlInput.value.trim();
            if (url) {
                try {
                    // Extract filename from URL
                    const urlPath = new URL(url).pathname;
                    const filename = urlPath.split('/').pop();
                    if (filename && filename.includes('.')) {
                        filenameInput.value = decodeURIComponent(filename);
                    }
                } catch (e) {
                    // If URL parsing fails, try simple extraction
                    const parts = url.split('/');
                    const lastPart = parts[parts.length - 1];
                    if (lastPart && lastPart.includes('.')) {
                        filenameInput.value = decodeURIComponent(lastPart.split('?')[0]);
                    }
                }
            }
        });

        // Free download button handler
        modal.querySelector("#downloader-free-download-btn").addEventListener("click", async () => {
            const folderInput = modal.querySelector("#downloader-free-folder");
            const urlInputBtn = modal.querySelector("#downloader-free-url");
            const filenameInputBtn = modal.querySelector("#downloader-free-filename");
            
            const folder = folderInput?.value.trim();
            let filename = filenameInputBtn?.value.trim();
            const url = urlInputBtn?.value.trim();
            
            if (!url) {
                alert('Please enter a download URL');
                return;
            }
            
            if (!folder) {
                alert('Please select a folder');
                return;
            }
            
            // Auto-extract filename if not provided
            if (!filename) {
                try {
                    const urlPath = new URL(url).pathname;
                    filename = urlPath.split('/').pop();
                    if (filename) {
                        filename = decodeURIComponent(filename);
                    }
                } catch (e) {
                    const parts = url.split('/');
                    filename = parts[parts.length - 1].split('?')[0];
                    if (filename) {
                        filename = decodeURIComponent(filename);
                    }
                }
            }
            
            if (!filename) {
                alert('Could not extract filename from URL. Please enter a filename manually.');
                return;
            }
            
            // Create a new model entry for manual download
            const extension = '.' + filename.split('.').pop().toLowerCase();
            const newModel = {
                filename: filename,
                filenamePath: filename,
                fullPath: `${folder}/${filename}`,
                extension: extension,
                url: url,
                directory: folder,
                nodeType: 'Manual Download',
                nodeTitle: 'Manual Download'
            };
            
            // Prepend to models array
            this.modelsInWorkflow.unshift(newModel);
            
            // Refresh the UI to show the new model
            await this.displayModels(this.modelsInWorkflow);
            
            // Start the download
            const result = await this.startServerDownload(url, folder, filename);
            
            // Clear inputs on successful download
            if (result && result.success) {
                filenameInputBtn.value = '';
                urlInputBtn.value = '';
                folderInput.value = '';
            }
        });

        // Close modal when clicking outside
        modal.addEventListener("click", (e) => {
            if (e.target === modal) {
                this.closeModal();
            }
        });

        return modal;
    }

    /**
     * Scan the current workflow for model files
     */
    async scanWorkflowForModels() {
        console.log("[DownloaderUI] Scanning workflow for models...");
        
        // Model file extensions to look for - fetch from API
        const modelExtensions = await this.loadModelExtensions();
        const modelsFound = new Map(); // Use Map to avoid duplicates
        
        // Access the ComfyUI app graph
        if (!window.app || !window.app.graph || !Array.isArray(window.app.graph._nodes)) {
            console.warn("[DownloaderUI] No workflow graph found");
            this.displayModels([]);
            return;
        }

        // console.log(window.app.graph);

        // Helper function to scan nodes
        const scanNodes = (nodes) => {
            nodes.forEach((node) => {
                // Priority 1: Check if node has rich model metadata in properties.models
                if (node.properties && Array.isArray(node.properties.models) && node.properties.models.length > 0) {
                    node.properties.models.forEach((model) => {
                        const filename = model.name || model.filename;
                        if (filename) {
                            if (modelsFound.has(filename)) {
                                // Only update URL if present
                                const existing = modelsFound.get(filename);
                                if (model.url) {
                                    existing.url = model.url;
                                }
                                if (model.directory && !existing.directory) {
                                    existing.directory = model.directory;
                                }
                            } else {
                                // Add new model entry
                                modelsFound.set(filename, {
                                    filename: filename,
                                    filenamePath: filename,
                                    fullPath: model.directory ? `${model.directory}/${filename}` : filename,
                                    extension: '.' + filename.split('.').pop().toLowerCase(),
                                    url: model.url || null,
                                    directory: model.directory || null,
                                    nodeType: node.type || 'Unknown',
                                    nodeTitle: node.title || node.type || 'Unknown'
                                });
                            }
                        }
                    });
                    return; // Skip widgets_values if models property is present
                }

                // Priority 2: Fall back to widgets if models property not present
                if (!Array.isArray(node.widgets)) {
                    return;
                }

                // Check each widget for model files
                node.widgets.forEach((widget) => {
                    if (!widget || !widget.value) {
                        return;
                    }

                    const valueStr = widget.value.toString();
                    const extension = '.' + valueStr.split('.').pop().toLowerCase();
                    
                    // Check if this is a model file
                    if (modelExtensions.includes(extension)) {
                        // Extract filename
                        const filename = valueStr.split('/').pop();
                        const filenamePath = valueStr;
                        
                        // Extract directory from widget options
                        let directory = null;
                        if (widget.options && Array.isArray(widget.options.values)) {
                            // Look for __folder__path__ prefix in options
                            const folderPath = widget.options.values.find(v => 
                                typeof v === 'string' && v.startsWith('__folder__path__')
                            );
                            if (folderPath) {
                                // Remove the __folder__path__ prefix to get directory
                                directory = folderPath.replace('__folder__path__', '');
                            }
                        }
                        
                        const fullPath = directory ? `${directory}/${filenamePath}` : filenamePath;
                        
                        // Store model info (using filename as key to avoid duplicates)
                        if (!modelsFound.has(filename)) {
                            modelsFound.set(filename, {
                                filename: filename,
                                filenamePath: filenamePath,
                                fullPath: fullPath,
                                extension: extension,
                                url: null, // Will be looked up from model-list.json
                                directory: directory || "diffusion_models", // Will be looked up from model-list.json
                                nodeType: node.type || 'Unknown',
                                nodeTitle: node.title || node.type || 'Unknown'
                            });
                        }
                    }
                });
            });
        };

        // Iterate through all nodes in the main workflow
        if (Array.isArray(window.app.graph._nodes)) {
            scanNodes(window.app.graph._nodes);
        }

        // const seen = new WeakSet();
        // const logData = JSON.stringify(window.app.graph._nodes, (key, value) => {
        //     if (typeof value === "object" && value !== null) {
        //     if (seen.has(value)) {
        //         return "[Circular]";
        //     }
        //     seen.add(value);
        //     }
        //     return value;
        // }, 2);

        // console.log(logData);        

        // Iterate through all subgraph nodes
        if (window.app.graph._subgraphs instanceof Map) {
            window.app.graph._subgraphs.forEach((subgraph) => {
                if (subgraph && Array.isArray(subgraph._nodes)) {
                    scanNodes(subgraph._nodes);
                }
            });
        }

        // Convert Map to array and look up URLs and directories for models from Priority 2 (widgets_values)
        const modelsArray = Array.from(modelsFound.values());
        
        // Look up URLs and directories from model-list.json for models without URL
        for (let model of modelsArray) {
            if (!model.url) {
                const modelInfo = await this.getModelInfo(model.filename);
                model.url = modelInfo.url;
                if (modelInfo.directory) {
                    model.directory = modelInfo.directory;
                }
            }
        }
        
        // console.log(modelsArray);

        this.modelsInWorkflow = modelsArray;
        
        console.log(`[DownloaderUI] Found ${this.modelsInWorkflow.length} models in workflow`);
        this.displayModels(this.modelsInWorkflow);
    }

    /**
     * Display the list of models in the UI
     */
    async displayModels(models) {
        const listContainer = this.modal.querySelector("#downloader-models-list");
        const countElement = this.modal.querySelector("#downloader-model-count");
        
        if (!listContainer || !countElement) {
            console.error("[DownloaderUI] UI elements not found");
            return;
        }

        // Update count
        countElement.textContent = `${models.length} model${models.length !== 1 ? 's' : ''} found`;

        // Clear previous content
        listContainer.innerHTML = '';

        if (models.length === 0) {
            listContainer.innerHTML = '<p class="downloader-no-models">No models found in the current workflow.</p>';
            return;
        }

        // Load folder names for dropdown
        const folderNames = await this.loadFolderNames();

        // Create model list
        const modelList = document.createElement('div');
        modelList.className = 'downloader-model-items';

        models.forEach((model, index) => {
            const modelItem = document.createElement('div');
            modelItem.className = 'downloader-model-item';
            
            modelItem.innerHTML = `
                <div class="downloader-model-header">
                    <span class="downloader-model-index">${index + 1}.</span>
                    <span class="downloader-model-filename">
                        ${this.escapeHtml(model.filename)}
                        <a href="https://huggingface.co/models?search=${encodeURIComponent(this.escapeHtml(model.filename))}" target="_blank" title="Search on Huggingface" style="cursor: pointer; margin-left: 2px; font-size: 1.2em; text-decoration: none;">🔍</a>
                        <a href="https://www.google.com/search?q=${encodeURIComponent(this.escapeHtml(model.filename))}" target="_blank" title="Search on Google" style="cursor: pointer; margin-left: 2px; font-size: 1.2em; text-decoration: none;">🔍</a>
                    </span>
                    <span class="downloader-model-extension">${model.extension}</span>
                </div>
                <div class="downloader-model-details">
                    <div class="downloader-model-path" title="${this.escapeHtml(model.fullPath)}">
                        ${this.escapeHtml(model.fullPath)}
                    </div>
                    <div class="downloader-model-node">
                        Used in: ${this.escapeHtml(model.nodeTitle)}
                    </div>
                    <div class="downloader-model-url" style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                        <select 
                            class="downloader-directory-input" 
                            data-model-index="${index}"
                            style="flex: 1; min-width: 150px; padding: 5px;"
                        >
                            <option value="">Select folder...</option>
                            ${folderNames.map(folder => `
                                <option value="${this.escapeHtml(folder)}" ${folder === model.directory ? 'selected' : ''}>
                                    ${this.escapeHtml(folder)}
                                </option>
                            `).join('')}
                        </select>
                        <input 
                            type="text" 
                            class="downloader-url-input" 
                            placeholder="Download URL..." 
                            value="${this.escapeHtml(model.url || '')}"
                            data-model-index="${index}"
                            style="flex: 2; min-width: 300px; padding: 5px;"
                        />
                        <button 
                            class="downloader-download-btn" 
                            data-model-index="${index}"
                            data-download-id="${this.escapeHtml(model.directory || '')}/${this.escapeHtml(model.filenamePath)}"
                            style="padding: 6px 20px; cursor: pointer; background-color: #4CAF50; color: white; border: none; border-radius: 3px;"
                        >
                            Download
                        </button>
                    </div>
                </div>
            `;

            modelList.appendChild(modelItem);
        });

        listContainer.appendChild(modelList);

        // Pre-load available files to populate cache (prevents multiple API calls)
        await this.getAvailableFiles();

        // Add event listeners to download buttons
        const downloadButtons = listContainer.querySelectorAll('.downloader-download-btn');
        downloadButtons.forEach(async (button) => {
            const modelIndex = parseInt(button.dataset.modelIndex);
            const model = this.modelsInWorkflow[modelIndex];
            
            // Set the download ID before checking state
            const downloadId = `${model.directory || ''}/${model.filenamePath}`;
            button.dataset.downloadId = downloadId;
            
            // Check if there's an existing download state for this model
            const existingState = this.downloadStates.get(downloadId);
            if (existingState) {
                // Restore button state based on existing download
                this.updateDownloadButton(downloadId);
            } else {
                // Check if file already exists in ComfyUI
                const fileExists = await this.isFileDownloaded(model.directory || '', model.filenamePath);
                if (fileExists) {
                    // Mark as downloaded
                    this.downloadStates.set(downloadId, {
                        status: 'completed',
                        progress: 100
                    });
                    this.updateDownloadButton(downloadId);
                } else {
                    // Set initial action state for new downloads
                    button.dataset.action = 'download';
                }
            }
            
            button.addEventListener('click', async (e) => {
                const action = button.dataset.action || 'download';
                
                // Handle cancel action
                if (action === 'cancel') {
                    const downloadId = button.dataset.downloadId;
                    await this.cancelServerDownload(downloadId);
                    return;
                }
                
                // Handle download action
                // Get current values from inputs
                const directoryInput = listContainer.querySelector(`.downloader-directory-input[data-model-index="${modelIndex}"]`);
                const urlInput = listContainer.querySelector(`.downloader-url-input[data-model-index="${modelIndex}"]`);
                
                const directory = directoryInput?.value.trim();
                const url = urlInput?.value.trim();
                
                if (!url) {
                    alert('Please enter a download URL');
                    return;
                }
                
                if (!directory) {
                    alert('Please enter a folder/directory path');
                    return;
                }
                
                // Update data-download-id to match the current directory selection
                const newDownloadId = `${directory}/${model.filenamePath}`;
                button.dataset.downloadId = newDownloadId;
                
                await this.startServerDownload(url, directory, model.filenamePath);
            });
        });
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async initializeUI() {
        if (this.isInitialized) {
            console.log("[DownloaderUI] UI already initialized.");
            return;
        }

        console.log("[DownloaderUI] Initializing UI...");
        
        // Add any initialization logic here
        
        this.isInitialized = true;
        console.log("[DownloaderUI] UI initialization complete.");
    }

    async openModal() {
        // Create and append modal to DOM
        this.modal = this.createModal();
        document.body.appendChild(this.modal);
        this.modal.style.display = "flex";
        console.log("[DownloaderUI] Modal opened.");
        
        // Populate folder dropdown in free download section
        const folderSelect = this.modal.querySelector("#downloader-free-folder");
        if (folderSelect) {
            const folderNames = await this.loadFolderNames();
            folderNames.forEach(folder => {
                const option = document.createElement('option');
                option.value = folder;
                option.textContent = folder;
                folderSelect.appendChild(option);
            });
        }
        
        // Automatically scan for models when opening
        this.scanWorkflowForModels();
    }

    closeModal() {
        if (this.modal) {
            // Remove modal from DOM
            this.modal.remove();
            this.modal = null;
            console.log("[DownloaderUI] Modal destroyed.");
        }
    }
}
