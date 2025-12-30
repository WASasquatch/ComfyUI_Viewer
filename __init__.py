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
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("content",)
    OUTPUT_NODE = True
    INPUT_IS_LIST = True
    OUTPUT_IS_LIST = (True,)
    FUNCTION = "run"
    CATEGORY = "WAS/View"

    def run(self, content=None, manual_content=None, viewer_meta=None):
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
            except:
                excluded = []
        
        content_trimmed = [c[:256] if isinstance(c, str) else str(c)[:256] for c in content]
        manual_content_trimmed = [c[:256] if isinstance(c, str) else str(c)[:256] for c in manual_content]
        
        logger.info(f"\n[WAS Viewer] Content:\n{content_trimmed}\nManual Content:\n{manual_content_trimmed}\nExcluded: {excluded}\n")
        
        LIST_SEPARATOR = "\n---LIST_SEPARATOR---\n"
        
        if len(manual_content) > 0 and any(m for m in manual_content):
            combined = to_string(manual_content[0]) if len(manual_content) == 1 else LIST_SEPARATOR.join(to_string(m) for m in manual_content)
            values = combined.split(LIST_SEPARATOR) if LIST_SEPARATOR in combined else [combined]
            logger.info(f"[WAS Viewer] Using manual_content: {len(values)} items")
        elif len(content) > 0 and any(c for c in content):
            values = [to_string(c) for c in content]
            logger.info(f"[WAS Viewer] Using content input: {len(values)} items")
        else:
            values = [""]
            logger.info("[WAS Viewer] No content, using empty")
        
        display_text = LIST_SEPARATOR.join(values)
        
        source_content = LIST_SEPARATOR.join(to_string(c) for c in content) if content else ""
        content_hash = str(len(source_content)) + "_" + str(hash(source_content) & 0xFFFFFFFF)
        
        output_values = [v for i, v in enumerate(values) if i not in excluded]
        if not output_values:
            output_values = [""]
        
        return {"ui": {"text": (display_text,), "source_content": (source_content,), "content_hash": (content_hash,)}, "result": (output_values,)}


NODE_CLASS_MAPPINGS = {
    "WASComfyViewer": WASComfyViewer,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "WASComfyViewer": "Content Viewer",
}
