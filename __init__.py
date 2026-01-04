WEB_DIRECTORY = "./web"


class AnyType(str):
    def __ne__(self, __value: object) -> bool:
        return False


any_type = AnyType("*")


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
        import json
        import logging
        
        logger = logging.getLogger("WAS.ContentViewer")
        
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
                    excluded = parsed["excluded"] if isinstance(parsed["excluded"], list) else []
            except (json.JSONDecodeError, TypeError, KeyError):
                excluded = []
        
        content_trimmed = [c[:256] if isinstance(c, str) else str(c)[:256] for c in content]
        manual_content_trimmed = [c[:256] if isinstance(c, str) else str(c)[:256] for c in manual_content]
        
        logger.info(f"\n[WAS Viewer] Content:\n{content_trimmed}\nManual Content:\n{manual_content_trimmed}\nExcluded: {excluded}\n")
        
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
        
        # Check view_state for parser output FIRST
        # Views store output in view_state with keys ending in "_output" (e.g., canvas_output)
        if has_content(view_state):
            state_str = to_string(view_state[0]) if len(view_state) == 1 else view_state[0]
            try:
                state_data = json.loads(state_str) if state_str else {}
                # Check all keys ending with _output for parsable content
                for key, value in state_data.items():
                    if key.endswith("_output") and value:
                        parsed = parse_output(value, logger)
                        if parsed:
                            logger.info(f"[WAS Viewer] View state output parsed by: {parsed.get('parser_name', 'unknown')}")
                            return {
                                "ui": {
                                    "text": (parsed["display_text"],),
                                    "source_content": (parsed["display_text"],),
                                    "content_hash": (parsed["content_hash"],)
                                },
                                "result": (parsed["output_values"],)
                            }
            except json.JSONDecodeError:
                pass
        
        # Try input handlers (e.g., IMAGE tensors -> canvas view)
        # Use handle_all_inputs to support multi-view content (e.g., tensor can be canvas OR object view)
        input_handled = handle_all_inputs(content, logger)
        if input_handled:
            logger.info(f"[WAS Viewer] Input handled by: {input_handled.get('parser_name', 'unknown')}")
            display_text = input_handled["display_content"]
            source_content = display_text
            content_hash = input_handled["content_hash"]
            output_values = input_handled["output_values"]
        elif has_content(manual_content):
            # Non-parser manual content (parsers already checked above)
            combined = to_string(manual_content[0]) if len(manual_content) == 1 else LIST_SEPARATOR.join(to_string(m) for m in manual_content)
            values = combined.split(LIST_SEPARATOR) if LIST_SEPARATOR in combined else [combined]
            logger.info(f"[WAS Viewer] Using manual_content: {len(values)} items")
            display_text = LIST_SEPARATOR.join(values)
            source_content = LIST_SEPARATOR.join(to_string(c) for c in content) if content else ""
            content_hash = str(len(source_content)) + "_" + str(hash(source_content) & 0xFFFFFFFF)
            output_values = [v for i, v in enumerate(values) if i not in excluded]
            if not output_values:
                output_values = [""]
        elif has_content(content):
            values = [to_string(c) for c in content]
            logger.info(f"[WAS Viewer] Using content input: {len(values)} items")
            display_text = LIST_SEPARATOR.join(values)
            source_content = LIST_SEPARATOR.join(to_string(c) for c in content) if content else ""
            content_hash = str(len(source_content)) + "_" + str(hash(source_content) & 0xFFFFFFFF)
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
        
        return {"ui": {"text": (display_text,), "source_content": (source_content,), "content_hash": (content_hash,)}, "result": (output_values,)}


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
            if hasattr(batch, 'shape'):
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
        
        logger.info(f"[WAS CanvasComposeBatch] Padding {len(all_images)} images to {max_w}x{max_h}")
        
        padded_images = []
        
        for img in all_images:
            h, w, c = img.shape
            padded = torch.zeros((max_h, max_w, 4), dtype=img.dtype, device=img.device)
            y_offset = (max_h - h) // 2
            x_offset = (max_w - w) // 2
            padded[y_offset:y_offset+h, x_offset:x_offset+w, :c] = img
            padded[y_offset:y_offset+h, x_offset:x_offset+w, 3] = 1.0
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
