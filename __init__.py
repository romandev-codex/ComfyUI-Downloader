"""
ComfyUI-Downloader Extension
Adds a Downloader button to ComfyUI interface with modal UI
"""

import os
import logging
import asyncio
import folder_paths
from aiohttp import web
from server import PromptServer

# Track active downloads
active_downloads = {}
# Download control (for pause/resume)
download_control = {}
# Download queue management
download_queue = []
current_download_task = None  # Only one download at a time

# Configuration optimized for datacenter connections
CHUNK_SIZE = 32 * 1024 * 1024  # 32MB chunks - balanced for 500MB to 30GB+ files
NUM_CONNECTIONS = 8  # 8 parallel connections - optimal for DC bandwidth

API_PREFIX = "35b631e00fa2dbc173ee4a5f899cba8f"

# Save the original function before wrapping
original_get_filename_list = folder_paths.get_filename_list

# Wrapper for folder_paths.get_filename_list
def get_filename_list_wrapper(folder_name):
    """Wrapper for folder_paths.get_filename_list to get list of files in a folder"""
    try:
        # print("get_filename_list wrapper called for folder:", folder_name)
        result = original_get_filename_list(folder_name)
        # Prepend folder path entry for download directory
        mapped_folder = folder_paths.map_legacy(folder_name)
        if mapped_folder in folder_paths.folder_names_and_paths:
            paths, _ = folder_paths.folder_names_and_paths[mapped_folder]
            if paths and any("/models/" in path for path in paths):  # Check if paths list is not empty and contains /models/
                folder_entry = "__folder__path__" + folder_name
                if not result:
                    result = [folder_entry]
                else:
                    result = [folder_entry] + result
        return result
    except Exception as e:
        logging.error(f"[ComfyUI-Downloader] Error getting file list for {folder_name}: {e}")
        return []

folder_paths.get_filename_list = get_filename_list_wrapper


@PromptServer.instance.routes.post(f"/{API_PREFIX}/server_download/start")
async def start_download(request):
    """Start downloading a model file to the server"""
    try:
        json_data = await request.json()
        url = json_data.get("url")
        save_path = json_data.get("save_path")  # e.g., "checkpoints" or "loras"
        filename = json_data.get("filename")    # e.g., "model.safetensors" or "subfolder/model.safetensors"
        override = json_data.get("override", False)  # Allow file override if True

        if not url or not save_path or not filename:
            return web.json_response(
                {"error": "Missing required parameters: url, save_path, filename"},
                status=400
            )

        # Security: Validate filename to prevent path traversal attacks
        # Allow forward slashes for subfolders, but prevent backslashes and path traversal
        if "\\" in filename:
            return web.json_response(
                {"error": "Invalid filename: backslashes not allowed"},
                status=400
            )

        if ".." in filename or filename.startswith("/") or filename.startswith("~"):
            return web.json_response(
                {"error": "Invalid filename: path traversal patterns detected"},
                status=400
            )

        # Normalize the path - convert to forward slashes and remove any tricks
        safe_filename = os.path.normpath(filename).replace("\\", "/")
        
        # Ensure it doesn't try to escape the directory
        if safe_filename.startswith("/") or safe_filename.startswith("../") or "/../" in safe_filename:
            return web.json_response(
                {"error": "Invalid filename: path traversal detected"},
                status=400
            )

        # Get the first path for this folder type from folder_paths
        mapped_folder = folder_paths.map_legacy(save_path)
        if mapped_folder not in folder_paths.folder_names_and_paths:
            return web.json_response(
                {"error": f"Invalid save_path: {save_path} not found in folder_paths"},
                status=400
            )

        paths, _ = folder_paths.folder_names_and_paths[mapped_folder]
        if not paths:
            return web.json_response(
                {"error": f"No valid paths configured for {save_path}"},
                status=400
            )

        # Filter paths to only include those containing /models/
        model_paths = [path for path in paths if "/models/" in path]
        if not model_paths:
            return web.json_response(
                {"error": f"No valid model paths (containing /models/) configured for {save_path}"},
                status=400
            )

        # Use the first path from the configured paths
        output_dir = model_paths[0]
        output_path = os.path.join(output_dir, safe_filename)

        # Final security check: ensure the resolved path is within the configured directory
        output_path = os.path.abspath(output_path)
        output_dir = os.path.abspath(output_dir)
        if not output_path.startswith(output_dir + os.sep):
            return web.json_response(
                {"error": "Security error: attempted directory escape"},
                status=400
            )

        # Check if file already exists
        if os.path.exists(output_path):
            if not override:
                # Request confirmation from user
                return web.json_response({
                    "confirm_override": True,
                    "message": f"File already exists: {safe_filename}",
                    "path": output_path
                })
            else:
                # User confirmed override, remove existing file
                logging.info(f"[ComfyUI-Downloader] Overriding existing file: {output_path}")
                try:
                    os.remove(output_path)
                except Exception as e:
                    return web.json_response(
                        {"error": f"Failed to remove existing file: {str(e)}"},
                        status=500
                    )

        # Create directory if it doesn't exist
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        # Mark as queued
        download_id = f"{save_path}/{safe_filename}"
        active_downloads[download_id] = {
            "url": url,
            "filename": safe_filename,
            "save_path": save_path,
            "output_path": output_path,
            "progress": 0,
            "status": "queued",
            "priority": None
        }

        # Add to queue
        download_queue.append({
            "download_id": download_id,
            "url": url,
            "output_path": output_path
        })

        # Process queue (will start download if slot available)
        asyncio.create_task(process_download_queue())

        return web.json_response({
            "success": True,
            "download_id": download_id,
            "message": "Download queued"
        })

    except Exception as e:
        logging.error(f"[ComfyUI-Downloader] Error starting download: {e}")
        return web.json_response(
            {"error": str(e)},
            status=500
        )


async def process_download_queue():
    """Process the download queue - one download at a time"""
    global download_queue, current_download_task

    # Check if already downloading
    if current_download_task is not None and not current_download_task.done():
        logging.info("[ComfyUI-Downloader] Download already in progress, waiting...")
        return  # Already downloading

    if len(download_queue) == 0:
        logging.info("[ComfyUI-Downloader] Queue is empty")
        return  # Nothing to process

    # Get next download from queue
    download_item = download_queue.pop(0)
    download_id = download_item["download_id"]
    url = download_item["url"]
    output_path = download_item["output_path"]

    # Set status to downloading
    active_downloads[download_id]["status"] = "downloading"
    active_downloads[download_id]["progress"] = 0
    active_downloads[download_id]["downloaded"] = 0

    logging.info(f"[ComfyUI-Downloader] Starting download {download_id} with {NUM_CONNECTIONS} connections")

    # Notify frontend that download is starting
    await PromptServer.instance.send("server_download_progress", {
        "download_id": download_id,
        "progress": 0,
        "downloaded": 0,
        "total": 0
    })

    # Start download task
    current_download_task = asyncio.create_task(download_file(url, output_path, download_id))

    # Add completion callback to process next in queue
    current_download_task.add_done_callback(lambda t: on_download_complete(download_id))


def on_download_complete(download_id):
    """Called when a download completes - processes next in queue"""
    global current_download_task

    current_download_task = None
    logging.info(f"[ComfyUI-Downloader] Download completed: {download_id}, processing next in queue...")

    # Process next in queue
    asyncio.create_task(process_download_queue())


async def download_chunk(session, url, start, end, output_path, chunk_index, download_id):
    """Download a specific chunk of the file"""
    headers = {'Range': f'bytes={start}-{end}'}

    try:
        async with session.get(url, headers=headers) as response:
            if response.status not in [200, 206]:
                return None

            chunk_data = await response.read()

            # Write chunk to file at specific position
            with open(output_path, 'r+b') as f:
                f.seek(start)
                f.write(chunk_data)

            return len(chunk_data)
    except Exception as e:
        logging.error(f"[ComfyUI-Downloader] Error downloading chunk {chunk_index} for {download_id}: {e}")
        return None


async def download_file(url, output_path, download_id):
    """Download file with multi-connection support and progress tracking"""
    import aiohttp

    logging.info(f"[ComfyUI-Downloader] Download {download_id} using {NUM_CONNECTIONS} connections")

    try:
        # Initialize control for this download
        download_control[download_id] = {
            "paused": False,
            "cancelled": False,
            "total_downloaded": 0,
            "lock": asyncio.Lock()
        }

        timeout = aiohttp.ClientTimeout(total=None)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            # Get file size - try HEAD first, then fall back to GET with Range
            total_size = 0
            supports_range = False

            try:
                # Try HEAD request first
                async with session.head(url, allow_redirects=True) as response:
                    if response.status == 200:
                        total_size = int(response.headers.get('content-length', 0))
                        supports_range = response.headers.get('accept-ranges') == 'bytes'
            except Exception as e:
                logging.warning(f"[ComfyUI-Downloader] HEAD request failed for {download_id}: {e}")

            # If HEAD didn't give us the size, try GET with Range header
            if total_size == 0:
                logging.info(f"[ComfyUI-Downloader] HEAD request didn't return size, trying GET with Range for {download_id}")
                try:
                    headers = {'Range': 'bytes=0-0'}
                    async with session.get(url, headers=headers, allow_redirects=True) as response:
                        if response.status in [200, 206]:
                            # Try to get size from Content-Range header first
                            content_range = response.headers.get('content-range', '')
                            if content_range:
                                parts = content_range.split('/')
                                if len(parts) == 2:
                                    total_size = int(parts[1])
                                    supports_range = True

                            # Fallback to Content-Length
                            if total_size == 0:
                                total_size = int(response.headers.get('content-length', 0))
                except Exception as e:
                    logging.warning(f"[ComfyUI-Downloader] GET with Range failed for {download_id}: {e}")

            if total_size == 0:
                raise Exception("Could not determine file size from server")

            logging.info(f"[ComfyUI-Downloader] File size for {download_id}: {total_size} bytes, supports range: {supports_range}")

            # Create file with full size
            with open(output_path, 'wb') as f:
                f.seek(total_size - 1)
                f.write(b'\0')

            active_downloads[download_id]["total"] = total_size
            active_downloads[download_id]["downloaded"] = 0

            # Use multi-connection download if server supports range requests
            if supports_range and total_size > CHUNK_SIZE:
                logging.info(f"[ComfyUI-Downloader] Using {NUM_CONNECTIONS} connections for {download_id}")

                # Calculate chunk ranges
                chunk_size = total_size // NUM_CONNECTIONS
                tasks = []

                for i in range(NUM_CONNECTIONS):
                    start = i * chunk_size
                    end = start + chunk_size - 1 if i < NUM_CONNECTIONS - 1 else total_size - 1

                    tasks.append(download_chunk_with_progress(
                        session, url, start, end, output_path, i, download_id, total_size
                    ))

                # Download all chunks in parallel
                results = await asyncio.gather(*tasks, return_exceptions=True)

                # Check for errors
                for result in results:
                    if isinstance(result, Exception):
                        raise result

            else:
                # Fallback to single connection download
                logging.info(f"[ComfyUI-Downloader] Using single connection for {download_id}")
                await download_single_connection(session, url, output_path, download_id, total_size)

            # Check if cancelled
            if download_control[download_id]["cancelled"]:
                os.remove(output_path)
                return

            # Mark as complete
            active_downloads[download_id]["status"] = "completed"
            active_downloads[download_id]["progress"] = 100

            # Send completion message
            await PromptServer.instance.send("server_download_complete", {
                "download_id": download_id,
                "path": output_path,
                "size": total_size
            })

            logging.info(f"[ComfyUI-Downloader] Successfully downloaded {download_id} to {output_path}")

            # Cleanup
            del download_control[download_id]

    except Exception as e:
        logging.error(f"[ComfyUI-Downloader] Error downloading {download_id}: {e}")
        active_downloads[download_id]["status"] = "error"
        active_downloads[download_id]["error"] = str(e)

        await PromptServer.instance.send("server_download_error", {
            "download_id": download_id,
            "error": str(e)
        })

        # Cleanup
        if download_id in download_control:
            del download_control[download_id]


async def download_chunk_with_progress(session, url, start, end, output_path, chunk_index, download_id, total_size):
    """Download chunk with progress tracking"""
    headers = {'Range': f'bytes={start}-{end}'}
    chunk_size = end - start + 1
    downloaded = 0
    last_report_time = 0

    try:
        async with session.get(url, headers=headers) as response:
            if response.status not in [200, 206]:
                raise Exception(f"HTTP {response.status} for chunk {chunk_index}")

            with open(output_path, 'r+b') as f:
                f.seek(start)

                async for chunk in response.content.iter_chunked(CHUNK_SIZE):
                    # Check if paused
                    while download_control.get(download_id, {}).get("paused", False):
                        await asyncio.sleep(0.5)

                    # Check if cancelled
                    if download_control.get(download_id, {}).get("cancelled", False):
                        return

                    f.write(chunk)
                    chunk_len = len(chunk)
                    downloaded += chunk_len

                    # Update shared progress counter with lock
                    async with download_control[download_id]["lock"]:
                        download_control[download_id]["total_downloaded"] += chunk_len
                        total_downloaded = download_control[download_id]["total_downloaded"]

                    # Send progress updates every 100ms to avoid spam (only from chunk 0)
                    import time
                    current_time = time.time()
                    if chunk_index == 0 and (current_time - last_report_time) >= 0.1:
                        progress = round((total_downloaded / total_size) * 100, 2)
                        active_downloads[download_id]["progress"] = progress
                        active_downloads[download_id]["downloaded"] = total_downloaded

                        await PromptServer.instance.send("server_download_progress", {
                            "download_id": download_id,
                            "progress": progress,
                            "downloaded": total_downloaded,
                            "total": total_size
                        })

                        last_report_time = current_time

    except Exception as e:
        logging.error(f"[ComfyUI-Downloader] Error in chunk {chunk_index} for {download_id}: {e}")
        raise


async def download_single_connection(session, url, output_path, download_id, total_size):
    """Fallback single connection download"""
    downloaded_size = 0

    async with session.get(url) as response:
        if response.status != 200:
            raise Exception(f"HTTP {response.status}")

        with open(output_path, 'wb') as f:
            async for chunk in response.content.iter_chunked(CHUNK_SIZE):
                # Check if paused
                while download_control.get(download_id, {}).get("paused", False):
                    await asyncio.sleep(0.5)

                # Check if cancelled
                if download_control.get(download_id, {}).get("cancelled", False):
                    return

                f.write(chunk)
                downloaded_size += len(chunk)

                # Update progress
                progress = round((downloaded_size / total_size) * 100, 2)
                active_downloads[download_id]["progress"] = progress
                active_downloads[download_id]["downloaded"] = downloaded_size

                await PromptServer.instance.send("server_download_progress", {
                    "download_id": download_id,
                    "progress": progress,
                    "downloaded": downloaded_size,
                    "total": total_size
                })


@PromptServer.instance.routes.get(f"/{API_PREFIX}/server_download/status")
async def get_download_status(request):
    """Get status of all downloads"""
    return web.json_response(active_downloads)


@PromptServer.instance.routes.get(f"/{API_PREFIX}/server_download/status/{{download_id:.*}}")
async def get_single_download_status(request):
    """Get status of a specific download"""
    download_id = request.match_info.get("download_id", "")

    if download_id in active_downloads:
        return web.json_response(active_downloads[download_id])
    else:
        return web.json_response(
            {"error": "Download not found"},
            status=404
        )


@PromptServer.instance.routes.post(f"/{API_PREFIX}/server_download/cancel")
async def cancel_download(request):
    """Cancel an active download"""
    global download_queue, current_download_task

    try:
        json_data = await request.json()
        download_id = json_data.get("download_id")

        if not download_id:
            return web.json_response(
                {"error": "Missing download_id"},
                status=400
            )

        # Check if download is queued (not started yet)
        download_queue[:] = [d for d in download_queue if d["download_id"] != download_id]

        # Check if download is active
        if download_id in download_control:
            download_control[download_id]["cancelled"] = True

        # Update status
        if download_id in active_downloads:
            active_downloads[download_id]["status"] = "cancelled"

        await PromptServer.instance.send("server_download_cancelled", {
            "download_id": download_id
        })

        return web.json_response({"success": True, "message": "Download cancelled"})

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@PromptServer.instance.routes.get(f"/{API_PREFIX}/supported_extensions")
async def get_supported_extensions(request):
    """Get supported model file extensions from folder_paths"""
    try:
        extensions = list(folder_paths.supported_pt_extensions)
        return web.json_response({
            "success": True,
            "extensions": extensions
        })
    except Exception as e:
        logging.error(f"[ComfyUI-Downloader] Error getting supported extensions: {e}")
        return web.json_response(
            {"error": str(e)},
            status=500
        )


@PromptServer.instance.routes.get(f"/{API_PREFIX}/folder_names")
async def get_folder_names(request):
    """Get available folder names from folder_paths"""
    try:
        # Only return folders that have valid paths (non-empty paths list)
        folder_names = []
        for folder_name, (paths, _) in folder_paths.folder_names_and_paths.items():
            if paths and any("/models/" in path for path in paths):  # Check if paths list is not empty and contains /models/
                folder_names.append(folder_name)
        
        return web.json_response({
            "success": True,
            "folders": sorted(folder_names)
        })
    except Exception as e:
        logging.error(f"[ComfyUI-Downloader] Error getting folder names: {e}")
        return web.json_response(
            {"error": str(e)},
            status=500
        )


# Add route to serve CSS
@PromptServer.instance.routes.get(f"/{API_PREFIX}/extensions/ComfyUI-Downloader/css/downloader.css")
async def get_css(request):
    css_path = os.path.join(os.path.dirname(__file__), "web", "css", "downloader.css")
    with open(css_path, "r", encoding="utf-8") as f:
        css_content = f.read()
    return web.Response(text=css_content, content_type="text/css")


# Set the web directory for frontend files
WEB_DIRECTORY = "./web"

# Required by ComfyUI - this extension provides server API routes and web UI, not custom nodes
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

__all__ = ["WEB_DIRECTORY"]

print("\033[92m[ComfyUI-Downloader]\033[0m Extension loaded successfully with download API")
