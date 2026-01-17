# ComfyUI-Downloader

A powerful and user-friendly extension for ComfyUI that adds a built-in model downloader with a sleek modal interface. Download models, LoRAs, VAEs, and other assets directly from URLs without leaving ComfyUI.

## Features

- 🚀 **High-Speed Downloads**: Optimized for datacenter connections with parallel downloading (8 connections, 32MB chunks)
- 📦 **Queue Management**: Download multiple files with automatic queue processing
- 🎯 **Smart Integration**: Detects missing models from your workflow and suggests downloads
- 🔄 **Real-time Progress**: Live progress tracking with download speed and ETA
- 🛡️ **Security**: Built-in path traversal protection and file validation
- 📂 **Auto-Organization**: Downloads files to the correct ComfyUI folders (checkpoints, loras, VAEs, etc.)
- ⏸️ **Download Control**: Cancel downloads in progress with queue management
- 🎨 **Clean UI**: Modal-based interface that integrates seamlessly with ComfyUI

![Quick Demo](https://github.com/user-attachments/assets/438417a2-fcb6-4b69-8fca-aafa3c4896af)

👉 [Watch Full Video](https://github.com/user-attachments/assets/4b9501cc-8017-47f9-9573-93ee6770bdb2)


## Installation

### Method 1: ComfyUI Manager (Recommended)
1. Open ComfyUI Manager
2. Search for "ComfyUI-Downloader"
3. Click Install

### Method 2: Manual Installation
1. Navigate to your ComfyUI custom nodes directory:
   ```bash
   cd ComfyUI/custom_nodes/
   ```

2. Clone this repository:
   ```bash
   git clone https://github.com/romandev-codex/ComfyUI-Downloader.git
   ```

3. Install dependencies:
   ```bash
   cd ComfyUI-Downloader
   pip install -r requirements.txt
   ```

4. Restart ComfyUI

## Requirements

- Python 3.8+
- ComfyUI
- Dependencies:
  - `aiohttp`
  - `hf_transfer`

## Usage

### Basic Usage
1. Click the **"Downloader"** button in the ComfyUI interface (next to the settings button)
2. The downloader modal will open
3. Paste a model URL in the URL field
4. Select the destination folder (checkpoints, loras, vae, etc.)
5. Enter a filename (supports subfolders like `subfolder/model.safetensors`)
6. Click **"Download"**

### Advanced Features

#### Subfolder Support
You can organize downloads into subfolders:
```
my-loras/character-lora.safetensors
sdxl/checkpoints/my-model.safetensors
```

#### File Override Protection
- If a file already exists, you'll be prompted for confirmation
- Choose to override or cancel the download

#### Missing Model Detection
- The extension scans your workflow for missing models
- Missing models are highlighted in the UI for quick downloading

#### Queue Management
- Multiple downloads are queued automatically
- One download processes at a time for optimal performance
- Cancel queued or active downloads anytime

## Configuration

The extension uses optimized settings for datacenter connections:
- **Chunk Size**: 32MB (balanced for 500MB to 30GB+ files)
- **Parallel Connections**: 8 (optimal for datacenter bandwidth)

These settings are configured in the `__init__.py` file and can be adjusted if needed.

## Supported Folders

The downloader supports all standard ComfyUI model directories:
- checkpoints
- loras
- vae
- upscale_models
- embeddings
- controlnet
- clip_vision
- And more...

## Security

ComfyUI-Downloader includes multiple security measures:
- Path traversal attack prevention
- Filename validation (no backslashes, dots, or escape sequences)
- Path resolution verification
- Only downloads to configured ComfyUI model directories

## API

The extension provides REST API endpoints for programmatic access:

### Start Download
```
POST /{API_PREFIX}/server_download/start
{
  "url": "https://example.com/model.safetensors",
  "save_path": "checkpoints",
  "filename": "model.safetensors",
  "override": false
}
```

### Cancel Download
```
POST /{API_PREFIX}/server_download/cancel
{
  "download_id": "checkpoints/model.safetensors"
}
```

### WebSocket Events
- `server_download_progress`: Real-time progress updates
- `server_download_complete`: Download completion notification
- `server_download_error`: Error notifications

## Development

### Project Structure
```
ComfyUI-Downloader/
├── __init__.py              # Main extension logic and API endpoints
├── requirements.txt         # Python dependencies
├── web/
│   ├── css/
│   │   └── downloader.css  # UI styling
│   └── js/
│       ├── downloader.js   # Extension initialization
│       └── UI.js           # Modal UI implementation
└── README.md
```

### Building and Testing
1. Make your changes
2. Restart ComfyUI to reload the extension
3. Test in the browser console for any errors

## Troubleshooting

### Button Doesn't Appear
- Ensure ComfyUI is fully loaded before looking for the button
- Check browser console for JavaScript errors
- Verify the extension is in the `custom_nodes` directory

### Downloads Fail
- Check internet connectivity
- Verify the URL is accessible
- Check browser console and ComfyUI terminal for error messages
- Ensure you have write permissions to the ComfyUI directories

### Slow Download Speeds
- The extension is optimized for datacenter connections
- Adjust `CHUNK_SIZE` and `NUM_CONNECTIONS` in `__init__.py` if needed
- Check your network bandwidth and latency

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see LICENSE file for details

## Credits

Created for the ComfyUI community to make model management easier and more efficient.

## Support

If you encounter issues or have suggestions:
- Open an issue on GitHub
- Check existing issues for solutions
- Provide error messages and browser console logs when reporting bugs
