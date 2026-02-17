import importlib
import logging
import os
import pkgutil
import time
import json

logger = logging.getLogger("WAS.ContentViewer")


class AnyType(str):
    def __ne__(self, __value: object) -> bool:
        return False


any_type = AnyType("*")


WEB_DIRECTORY = "./web"


class WASComfyViewer:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "content": (any_type, {"forceInput": True}),
            },
            "hidden": {
                "manual_content": ("STRING", {"default": ""}),
                "viewer_meta": ("STRING", {"default": "{}"}),
                "view_state": ("STRING", {"default": "{}"}),
            },
        }

    RETURN_TYPES = (any_type,)
    RETURN_NAMES = ("content",)
    OUTPUT_NODE = True
    INPUT_IS_LIST = True
    OUTPUT_IS_LIST = (True,)
    FUNCTION = "run"
    CATEGORY = "WAS/View"

    def run(self, content=None, manual_content=None, viewer_meta=None, view_state=None):
        def to_string(item):
            if item is None:
                return ""
            if isinstance(item, str):
                return item
            if isinstance(item, (int, float, bool)):
                return str(item)
            try:
                return json.dumps(item)
            except Exception as e:
                logger.warning(f"[WAS Viewer] JSON serialization failed: {e}")
                try:
                    return str(item)
                except Exception as e2:
                    logger.error(f"[WAS Viewer] String conversion failed: {e2}")
                    return "Content exists but could not be serialized."

        if content is None:
            content = []
        if not isinstance(content, list):
            content = [content]

        if manual_content is None:
            manual_content = []
        if not isinstance(manual_content, list):
            manual_content = [manual_content]

        excluded = []
        if viewer_meta:
            meta_str = viewer_meta[0] if isinstance(viewer_meta, list) else viewer_meta
            try:
                parsed = json.loads(meta_str)
                if isinstance(parsed, dict) and "excluded" in parsed:
                    excluded = (
                        parsed["excluded"]
                        if isinstance(parsed["excluded"], list)
                        else []
                    )
            except (json.JSONDecodeError, TypeError, KeyError):
                excluded = []

        content_trimmed = [
            c[:256] if isinstance(c, str) else str(c)[:256] for c in content
        ]
        manual_content_trimmed = [
            c[:256] if isinstance(c, str) else str(c)[:256] for c in manual_content
        ]

        view_state_trimmed = str(view_state)[:256] if view_state else "None"
        logger.info(
            f"\n[WAS Viewer] Content:\n{content_trimmed}\nManual Content:\n{manual_content_trimmed}\nExcluded: {excluded}\nView State: {view_state_trimmed}\n"
        )

        LIST_SEPARATOR = "\n---LIST_SEPARATOR---\n"

        def has_content(items):
            """Check if list has non-None, non-empty content without evaluating tensor booleans"""
            if not items:
                return False
            for item in items:
                if item is None:
                    continue
                if isinstance(item, str) and not item:
                    continue
                return True
            return False

        # Import parser system
        from .modules.parsers import parse_output, handle_all_inputs

        # Compute a hash of the current input content to detect changes
        import hashlib

        def compute_input_hash(content_list):
            """Compute a hash of input content for change detection."""
            if not content_list:
                return ""
            combined = ""
            for item in content_list:
                if item is None:
                    continue
                item_str = to_string(item)
                combined += item_str
            if not combined:
                return ""
            return hashlib.md5(combined.encode("utf-8", errors="replace")).hexdigest()

        current_input_hash = compute_input_hash(content)

        # Check view_state for parser output FIRST
        # Views store output in view_state with keys ending in "_output" (e.g., canvas_output)
        # BUT only use cached output if input hasn't changed (prevents stale results)
        if has_content(view_state):
            state_str = (
                to_string(view_state[0]) if len(view_state) == 1 else view_state[0]
            )
            try:
                state_data = json.loads(state_str) if state_str else {}
                stored_input_hash = state_data.get("_input_hash", "")

                # Use cached _output if:
                #  - No input content (UI views like OpenReel can produce output standalone)
                #  - Input content hasn't changed since the output was stored
                use_cached = False
                if not current_input_hash:
                    use_cached = True
                elif stored_input_hash == current_input_hash:
                    use_cached = True
                elif stored_input_hash and stored_input_hash != current_input_hash:
                    logger.info(
                        "[WAS Viewer] Input content changed, ignoring cached view_state output"
                    )

                if use_cached:
                    for key, value in state_data.items():
                        if key.endswith("_output") and value:
                            parsed = parse_output(value, logger)
                            if parsed:
                                return {
                                    "ui": {
                                        "text": (parsed["display_text"],),
                                        "source_content": (parsed["display_text"],),
                                        "content_hash": (parsed["content_hash"],),
                                    },
                                    "result": (parsed["output_values"],),
                                }
            except json.JSONDecodeError:
                pass

        # Try input handlers (e.g., IMAGE tensors -> canvas view)
        # Use handle_all_inputs to support multi-view content (e.g., tensor can be canvas OR object view)
        input_handled = handle_all_inputs(content, logger)
        if input_handled:
            logger.info(
                f"[WAS Viewer] Input handled by: {input_handled.get('parser_name', 'unknown')}"
            )
            display_text = input_handled["display_content"]
            source_content = display_text
            content_hash = input_handled["content_hash"]
            output_values = input_handled["output_values"]
        elif has_content(manual_content):
            # Non-parser manual content (parsers already checked above)
            combined = (
                to_string(manual_content[0])
                if len(manual_content) == 1
                else LIST_SEPARATOR.join(to_string(m) for m in manual_content)
            )
            values = (
                combined.split(LIST_SEPARATOR)
                if LIST_SEPARATOR in combined
                else [combined]
            )
            logger.info(f"[WAS Viewer] Using manual_content: {len(values)} items")
            display_text = LIST_SEPARATOR.join(values)
            source_content = (
                LIST_SEPARATOR.join(to_string(c) for c in content) if content else ""
            )
            content_hash = (
                str(len(source_content)) + "_" + str(hash(source_content) & 0xFFFFFFFF)
            )
            output_values = [v for i, v in enumerate(values) if i not in excluded]
            if not output_values:
                output_values = [""]
        elif has_content(content):
            values = [to_string(c) for c in content]
            logger.info(f"[WAS Viewer] Using content input: {len(values)} items")
            display_text = LIST_SEPARATOR.join(values)
            source_content = (
                LIST_SEPARATOR.join(to_string(c) for c in content) if content else ""
            )
            content_hash = (
                str(len(source_content)) + "_" + str(hash(source_content) & 0xFFFFFFFF)
            )
            output_values = [v for i, v in enumerate(values) if i not in excluded]
            if not output_values:
                output_values = [""]
        else:
            values = [""]
            logger.info("[WAS Viewer] No content, using empty")
            display_text = ""
            source_content = ""
            content_hash = "empty_0"
            output_values = [""]

        return {
            "ui": {
                "text": (display_text,),
                "source_content": (source_content,),
                "content_hash": (content_hash,),
                "input_hash": (current_input_hash,),
            },
            "result": (output_values,),
        }


class WASCanvasComposeBatch:
    """Combines two image batches, padding all images with transparency to the largest size."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "images_a": ("IMAGE",),
                "images_b": ("IMAGE",),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("images",)
    FUNCTION = "run"
    CATEGORY = "WAS/View"

    def run(self, images_a=None, images_b=None):
        import torch
        import logging

        logger = logging.getLogger("WAS.CanvasComposeBatch")

        all_images = []

        def add_batch(batch):
            if batch is None:
                return
            if hasattr(batch, "shape"):
                if len(batch.shape) == 4:
                    for i in range(batch.shape[0]):
                        all_images.append(batch[i])
                elif len(batch.shape) == 3:
                    all_images.append(batch)

        add_batch(images_a)
        add_batch(images_b)

        if len(all_images) == 0:
            return (torch.zeros((1, 64, 64, 4)),)

        max_h = max(img.shape[0] for img in all_images)
        max_w = max(img.shape[1] for img in all_images)

        logger.info(
            f"[WAS CanvasComposeBatch] Padding {len(all_images)} images to {max_w}x{max_h}"
        )

        padded_images = []

        for img in all_images:
            h, w, c = img.shape
            padded = torch.zeros((max_h, max_w, 4), dtype=img.dtype, device=img.device)
            y_offset = (max_h - h) // 2
            x_offset = (max_w - w) // 2
            padded[y_offset : y_offset + h, x_offset : x_offset + w, :c] = img
            padded[y_offset : y_offset + h, x_offset : x_offset + w, 3] = 1.0
            padded_images.append(padded)

        result = torch.stack(padded_images, dim=0)

        return (result,)


NODE_CLASS_MAPPINGS = {
    "WASComfyViewer": WASComfyViewer,
    "WASCanvasComposeBatch": WASCanvasComposeBatch,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "WASComfyViewer": "Content Viewer",
    "WASCanvasComposeBatch": "CV Canvas Compose Batch",
}


class NodeLoader:
    """Dynamically loads extension nodes from the ./nodes package."""

    def __init__(self, package_name: str, prefix: str = "[WAS Viewer] "):
        self.package_name = package_name
        self.prefix = prefix
        self.logger = logging.getLogger("WAS.ContentViewer.NodeLoader")
        self.timings: dict[str, tuple[float, bool, Exception | None]] = {}

    def module_path(self, module) -> str:
        spec = getattr(module, "__spec__", None)
        if spec and getattr(spec, "origin", None):
            return os.path.basename(spec.origin)
        return getattr(module, "__file__", repr(module))

    def record(self, module, elapsed: float, ok: bool, err: Exception | None) -> None:
        self.timings[self.module_path(module)] = (elapsed, ok, err)
        if ok:
            NODE_CLASS_MAPPINGS.update(getattr(module, "NODE_CLASS_MAPPINGS", {}))
            NODE_DISPLAY_NAME_MAPPINGS.update(
                getattr(module, "NODE_DISPLAY_NAME_MAPPINGS", {})
            )

    def import_module(
        self, fullname: str, package: str | None = None
    ) -> tuple[object | None, bool]:
        t0 = time.time()
        ok = True
        err = None
        mod = None
        try:
            mod = importlib.import_module(fullname, package=package)
        except Exception as e:
            ok = False
            err = e
            self.logger.error(f"{self.prefix}Failed to import {fullname}: {e}")
        elapsed = time.time() - t0
        if mod is not None:
            self.record(mod, elapsed, ok, err)
        return mod, ok

    def import_file(
        self, filepath: str, module_name: str
    ) -> tuple[object | None, bool]:
        """Load a .py file directly by path without requiring package structure."""
        import importlib.util

        t0 = time.time()
        ok = True
        err = None
        mod = None
        try:
            spec = importlib.util.spec_from_file_location(module_name, filepath)
            if spec and spec.loader:
                mod = importlib.util.module_from_spec(spec)
                import sys

                sys.modules[module_name] = mod
                spec.loader.exec_module(mod)
        except Exception as e:
            ok = False
            err = e
            self.logger.error(f"{self.prefix}Failed to import {filepath}: {e}")
        elapsed = time.time() - t0
        if mod is not None:
            self.record(mod, elapsed, ok, err)
        return mod, ok

    def load_all(self) -> None:
        package_path = os.path.dirname(__file__)
        nodes_path = os.path.join(package_path, "nodes")

        if not os.path.isdir(nodes_path):
            return

        # Load .py files directly from nodes folder (no __init__.py required)
        for filename in os.listdir(nodes_path):
            if filename.endswith(".py") and not filename.startswith("_"):
                filepath = os.path.join(nodes_path, filename)
                module_name = f"{self.package_name}.nodes.{filename[:-3]}"
                self.import_file(filepath, module_name)

        # Walk subpackages if they exist (folders with __init__.py)
        for item in os.listdir(nodes_path):
            item_path = os.path.join(nodes_path, item)
            if os.path.isdir(item_path) and os.path.isfile(
                os.path.join(item_path, "__init__.py")
            ):
                subpkg, ok = self.import_module(
                    f".nodes.{item}", package=self.package_name
                )
                if ok and subpkg is not None:
                    for _, name, _ in pkgutil.walk_packages(
                        subpkg.__path__, prefix=subpkg.__name__ + "."
                    ):
                        self.import_module(name)

        # Log summary
        if self.timings:
            total = len(self.timings)
            ok_count = sum(1 for _, (_, success, _) in self.timings.items() if success)
            fail_count = total - ok_count
            ok_modules = ", ".join(p for p, (_, s, _) in self.timings.items() if s)
            failed_modules = ", ".join(
                f"{p}: {e}" for p, (_, s, e) in self.timings.items() if not s
            )
            if ok_count > 0:
                self.logger.info(
                    f"{self.prefix}Loaded {ok_count}/{total} nodes: [{ok_modules}]"
                )
            if fail_count > 0:
                self.logger.error(
                    f"{self.prefix}Failed {fail_count}/{total} nodes: [{failed_modules}]"
                )


_loader = NodeLoader(package_name=__name__, prefix="[WAS Viewer] ")
_loader.load_all()

# Load API routes from extensions
try:
    from . import routes
except ImportError:
    logger.info("[WAS Viewer] No routes directory found, skipping route loading")

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
