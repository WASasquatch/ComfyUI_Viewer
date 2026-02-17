"""
ComfyUI_Viewer Route Loader

Automatically discovers and registers API routes from extension route files.
Extension routes should be placed in the routes/ directory.

Route files should define route handlers using the PromptServer.instance.routes decorator:

Example route file (routes/my_extension_routes.py):
    from aiohttp import web
    from server import PromptServer
    
    @PromptServer.instance.routes.get('/was/my_extension/api/data')
    async def get_data(request):
        return web.json_response({'status': 'ok'})

Routes are automatically registered when ComfyUI starts.
"""

import os
import importlib.util
import logging

logger = logging.getLogger("WAS.ContentViewer.RouteLoader")


def load_routes():
    """
    Discover and load all route files from the routes/ directory.
    
    Route files are loaded directly without requiring package structure.
    Any .py file in routes/ (except those starting with _) will be loaded.
    """
    routes_dir = os.path.dirname(__file__)
    
    if not os.path.isdir(routes_dir):
        return
    
    loaded_count = 0
    failed_count = 0
    loaded_files = []
    failed_files = []
    
    for filename in sorted(os.listdir(routes_dir)):
        if not filename.endswith('.py') or filename.startswith('_'):
            continue
            
        filepath = os.path.join(routes_dir, filename)
        module_name = f"ComfyUI_Viewer.routes.{filename[:-3]}"
        
        try:
            spec = importlib.util.spec_from_file_location(module_name, filepath)
            if spec and spec.loader:
                module = importlib.util.module_from_spec(spec)
                import sys
                sys.modules[module_name] = module
                spec.loader.exec_module(module)
                loaded_count += 1
                loaded_files.append(filename)
        except Exception as e:
            failed_count += 1
            failed_files.append(f"{filename}: {e}")
            logger.error(f"[WAS Viewer Routes] Failed to load {filename}: {e}")
    
    if loaded_count > 0:
        logger.info(f"[WAS Viewer Routes] Loaded {loaded_count} route file(s): {', '.join(loaded_files)}")
    
    if failed_count > 0:
        logger.error(f"[WAS Viewer Routes] Failed to load {failed_count} route file(s): {', '.join(failed_files)}")


# Load routes when this module is imported
load_routes()
