"""
ComfyUI_Viewer Extension Auto-Installer

This script runs at ComfyUI startup before nodes are imported.
It automatically installs View Extensions from .zip files placed in the extensions folder.

Usage:
1. Download an extension from GitHub as a .zip file
2. Place the .zip in ComfyUI_Viewer/extensions/
3. Restart ComfyUI - the extension will be automatically installed

The script will:
- Extract nodes/, web/views/, and modules/parsers/ to ComfyUI_Viewer
- Install requirements.txt using ComfyUI's Python interpreter
- Create a log file to track installation (skip if already installed)
"""

import sys
import zipfile
import shutil
import subprocess
import datetime
import json
from pathlib import Path

# Get paths
SCRIPT_DIR = Path(__file__).parent.resolve()
EXTENSIONS_DIR = SCRIPT_DIR / "extensions"
LOGS_DIR = EXTENSIONS_DIR / "logs"
EXTENSION_VIEWS_JSON = SCRIPT_DIR / "web" / "views" / "extension_views.json"

# Folders to extract from extension zips
EXTRACT_FOLDERS = {
    "nodes": SCRIPT_DIR / "nodes",
    "web/views": SCRIPT_DIR / "web" / "views",
    "modules/parsers": SCRIPT_DIR / "modules" / "parsers",
    "routes": SCRIPT_DIR / "routes",
    "apps": SCRIPT_DIR / "apps",
}


def print_progress(message: str, level: str = "INFO"):
    """Print progress message."""
    prefix = {
        "INFO": "\033[94m•\033[0m",
        "OK": "\033[92m✓\033[0m",
        "WARN": "\033[93m!\033[0m",
        "ERROR": "\033[91m✗\033[0m",
        "PROGRESS": "\033[96m→\033[0m",
        "HEADER": "\033[95m■\033[0m",
    }.get(level, "•")
    print(f"  {prefix} {message}")


def get_python_executable() -> str:
    """Get the Python executable used by ComfyUI."""
    return sys.executable


def ensure_directories():
    """Ensure extensions and logs directories exist."""
    EXTENSIONS_DIR.mkdir(exist_ok=True)
    LOGS_DIR.mkdir(exist_ok=True)

    # Create .gitkeep to preserve empty folders
    gitkeep = EXTENSIONS_DIR / ".gitkeep"
    if not gitkeep.exists():
        gitkeep.write_text("# Place extension .zip files here\n")


def get_log_path(zip_name: str) -> Path:
    """Get the log file path for an extension."""
    base_name = zip_name.rsplit(".", 1)[0]
    return LOGS_DIR / f"{base_name}_install.log"


def is_installed(zip_name: str) -> bool:
    """Check if an extension is already installed (log file exists)."""
    return get_log_path(zip_name).exists()


def find_extension_root(zip_ref: zipfile.ZipFile) -> str:
    """
    Find the root folder inside the zip (GitHub adds branch suffix).
    e.g., ComfyUI_Viewer_Image_Search-main/
    """
    names = zip_ref.namelist()
    # Find the common root folder
    roots = set()
    for name in names:
        parts = name.split("/")
        if len(parts) > 1:
            roots.add(parts[0])

    if len(roots) == 1:
        return list(roots)[0]
    return ""


def extract_extension(zip_path: Path, log_lines: list) -> bool:
    """
    Extract extension folders from zip to ComfyUI_Viewer.
    Returns True if successful.
    """
    try:
        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            root = find_extension_root(zip_ref)
            if not root:
                log_lines.append(
                    "ERROR: Could not determine extension root folder in zip"
                )
                return False

            log_lines.append(f"Extension root: {root}")
            extracted_count = 0

            for source_folder, dest_folder in EXTRACT_FOLDERS.items():
                source_prefix = f"{root}/{source_folder}/"

                # Find matching files
                matching_files = [
                    name
                    for name in zip_ref.namelist()
                    if name.startswith(source_prefix) and not name.endswith("/")
                ]

                if not matching_files:
                    log_lines.append(f"  No files found in {source_folder}/")
                    continue

                log_lines.append(
                    f"  Extracting {len(matching_files)} files from {source_folder}/"
                )

                for file_path in matching_files:
                    # Calculate relative path and destination
                    rel_path = file_path[len(source_prefix) :]
                    dest_path = dest_folder / rel_path

                    # Ensure parent directory exists
                    dest_path.parent.mkdir(parents=True, exist_ok=True)

                    # Extract file
                    with zip_ref.open(file_path) as src:
                        with open(dest_path, "wb") as dst:
                            dst.write(src.read())

                    extracted_count += 1
                    log_lines.append(f"    -> {dest_path.relative_to(SCRIPT_DIR)}")

            log_lines.append(f"Extracted {extracted_count} files total")
            return extracted_count > 0

    except zipfile.BadZipFile:
        log_lines.append("ERROR: Invalid or corrupted zip file")
        return False
    except Exception as e:
        log_lines.append(f"ERROR: Extraction failed: {e}")
        return False


def extract_and_install_requirements(zip_path: Path, log_lines: list) -> bool:
    """
    Extract requirements.txt from zip and install using pip.
    Returns True if successful (or no requirements).
    """
    try:
        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            root = find_extension_root(zip_ref)
            requirements_path = f"{root}/requirements.txt"

            # Check if requirements.txt exists in zip
            if requirements_path not in zip_ref.namelist():
                log_lines.append("No requirements.txt found - skipping pip install")
                return True

            # Extract to extensions folder with unique name
            base_name = zip_path.stem
            dest_requirements = EXTENSIONS_DIR / f"{base_name}_requirements.txt"

            with zip_ref.open(requirements_path) as src:
                content = src.read().decode("utf-8")
                dest_requirements.write_text(content)

            log_lines.append(f"Extracted requirements to: {dest_requirements.name}")
            log_lines.append(f"Requirements content:\n{content}")

            # Install using pip
            python_exe = get_python_executable()
            log_lines.append(f"Installing requirements with: {python_exe}")

            result = subprocess.run(
                [python_exe, "-m", "pip", "install", "-r", str(dest_requirements)],
                capture_output=True,
                text=True,
                timeout=300,  # 5 minute timeout
            )

            log_lines.append(f"pip stdout:\n{result.stdout}")
            if result.stderr:
                log_lines.append(f"pip stderr:\n{result.stderr}")

            if result.returncode != 0:
                log_lines.append(
                    f"ERROR: pip install failed with code {result.returncode}"
                )
                return False

            log_lines.append("Requirements installed successfully")
            return True

    except subprocess.TimeoutExpired:
        log_lines.append("ERROR: pip install timed out after 5 minutes")
        return False
    except Exception as e:
        log_lines.append(f"ERROR: Requirements installation failed: {e}")
        return False


def install_extension(zip_path: Path) -> bool:
    """
    Install a single extension from a zip file.
    Returns True if successful.
    """
    zip_name = zip_path.name
    # Extract friendly name (remove -main/-master suffix and .zip)
    friendly_name = (
        zip_name.replace("-main.zip", "").replace("-master.zip", "").replace(".zip", "")
    )

    log_lines = []
    log_lines.append("=" * 60)
    log_lines.append("ComfyUI_Viewer Extension Installation Log")
    log_lines.append(f"Extension: {zip_name}")
    log_lines.append(f"Date: {datetime.datetime.now().isoformat()}")
    log_lines.append("=" * 60)
    log_lines.append("")

    print_progress(f"Installing: {friendly_name}", "HEADER")

    # Step 1: Extract folders
    print_progress("Extracting files...", "PROGRESS")
    log_lines.append("Step 1: Extracting files")
    log_lines.append("-" * 40)

    if not extract_extension(zip_path, log_lines):
        log_lines.append("\nINSTALLATION FAILED: Extraction error")
        print_progress("Extraction failed", "ERROR")
        return False

    log_lines.append("")

    # Step 2: Install requirements
    print_progress("Installing dependencies...", "PROGRESS")
    log_lines.append("Step 2: Installing requirements")
    log_lines.append("-" * 40)

    if not extract_and_install_requirements(zip_path, log_lines):
        log_lines.append("\nINSTALLATION FAILED: Requirements error")
        print_progress("Dependency installation failed", "ERROR")
        return False

    log_lines.append("")
    log_lines.append("=" * 60)
    log_lines.append("INSTALLATION COMPLETED SUCCESSFULLY")
    log_lines.append("=" * 60)

    # Write log file (marks as installed)
    log_path = get_log_path(zip_name)
    log_path.write_text("\n".join(log_lines))

    print_progress("Installed successfully", "OK")

    return True


def sync_extension_directories():
    """
    Sync sibling ComfyUI_Viewer_* extension directories into ComfyUI_Viewer.

    Extensions can be installed either from .zip files (handled by run_extension_installer)
    or placed as sibling directories alongside ComfyUI_Viewer. This function handles the
    latter by copying all extension assets into ComfyUI_Viewer so the node loader, parser
    loader, and view loader can discover them.

    Runs every startup to keep files in sync. Uses the same folder mapping as
    EXTRACT_FOLDERS to stay consistent with zip-based installation.
    """
    workspace_dir = SCRIPT_DIR.parent
    if not workspace_dir.is_dir():
        return

    for entry in sorted(workspace_dir.iterdir()):
        if not entry.name.startswith("ComfyUI_Viewer_") or not entry.is_dir():
            continue

        for source_folder, dest_folder in EXTRACT_FOLDERS.items():
            ext_source = entry / source_folder
            if not ext_source.is_dir():
                continue

            dest_folder.mkdir(parents=True, exist_ok=True)

            # Walk the source tree and copy all files
            for src_file in ext_source.rglob("*"):
                if src_file.is_dir() or src_file.name.startswith("_"):
                    continue
                rel = src_file.relative_to(ext_source)
                dest_path = dest_folder / rel
                try:
                    dest_path.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src_file, dest_path)
                except Exception as e:
                    print_progress(
                        f"Failed to copy {rel} from {entry.name}: {e}", "WARN"
                    )


def update_extension_views_json():
    """
    Update extension_views.json with list of installed extension view files.
    This allows the view_loader to dynamically discover extension views.

    Scans two locations:
    1. Installed views in ComfyUI_Viewer/web/views/ (from zip installs)
    2. Sibling ComfyUI_Viewer_* directories for dev/unzipped extensions
    """
    views_dir = SCRIPT_DIR / "web" / "views"

    # Core views from view_manifest.js (these are not extension views)
    core_views = {
        "canvas.js",
        "html.js",
        "svg.js",
        "markdown.js",
        "json.js",
        "csv.js",
        "yaml.js",
        "ansi.js",
        "python.js",
        "javascript.js",
        "css.js",
        "object.js",
        "text.js",
    }

    skip_files = {
        "view_manifest.js",
        "view_loader.js",
        "base_view.js",
        "code_scripts.js",
    }

    # Find all .js files in views folder that aren't core views or utility files
    extension_views = []
    seen = set()
    if views_dir.exists():
        for js_file in views_dir.glob("*.js"):
            filename = js_file.name
            if filename in core_views or filename in skip_files:
                continue
            extension_views.append(filename)
            seen.add(filename)

    # Scan sibling ComfyUI_Viewer_* extension directories for additional views
    workspace_dir = SCRIPT_DIR.parent
    if workspace_dir.is_dir():
        for entry in sorted(workspace_dir.iterdir()):
            if not entry.name.startswith("ComfyUI_Viewer_") or not entry.is_dir():
                continue
            ext_views_dir = entry / "web" / "views"
            if not ext_views_dir.is_dir():
                continue
            for js_file in ext_views_dir.glob("*.js"):
                filename = js_file.name
                if filename in core_views or filename in skip_files or filename in seen:
                    continue
                # Copy the view file into our views directory so the frontend can load it
                dest = views_dir / filename
                try:
                    shutil.copy2(js_file, dest)
                    extension_views.append(filename)
                    seen.add(filename)
                except Exception as e:
                    print_progress(
                        f"Failed to copy extension view {filename} from {entry.name}: {e}",
                        "WARN",
                    )

    # Write to JSON file
    try:
        EXTENSION_VIEWS_JSON.write_text(json.dumps(sorted(extension_views), indent=2))
    except Exception as e:
        print_progress(f"Failed to update extension_views.json: {e}", "WARN")


def run_extension_installer():
    """Main entry point - scan and install extensions."""
    ensure_directories()

    # Find all .zip files in extensions folder
    zip_files = list(EXTENSIONS_DIR.glob("*.zip"))

    if not zip_files:
        return  # No extensions to install, silent exit

    # Filter to only uninstalled extensions
    to_install = [z for z in zip_files if not is_installed(z.name)]

    if not to_install:
        return  # All installed, silent exit

    print("")
    print("\033[95m  ╔══════════════════════════════════════════════════╗\033[0m")
    print(
        "\033[95m  ║\033[0m     \033[1mComfyUI_Viewer Extension Installer\033[0m          \033[95m║\033[0m"
    )
    print("\033[95m  ╚══════════════════════════════════════════════════╝\033[0m")
    print("")
    print_progress(f"Found {len(to_install)} new extension(s) to install", "INFO")
    print("")

    success_count = 0
    fail_count = 0

    for i, zip_path in enumerate(to_install, 1):
        if install_extension(zip_path):
            success_count += 1
        else:
            fail_count += 1

    print("")
    if fail_count == 0:
        print_progress(f"Done! {success_count} extension(s) installed", "OK")
    else:
        print_progress(f"Installed: {success_count}, Failed: {fail_count}", "WARN")
    print("")

    # Update extension views manifest for view_loader auto-discovery
    if success_count > 0:
        update_extension_views_json()


# Run when imported by ComfyUI
run_extension_installer()

# Sync sibling extension directories (nodes, parsers, web assets) into ComfyUI_Viewer
sync_extension_directories()

# Update extension views manifest for view_loader auto-discovery
update_extension_views_json()
