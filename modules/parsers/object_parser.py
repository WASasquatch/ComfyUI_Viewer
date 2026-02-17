"""
Object Parser for WAS Content Viewer.

Handles unrecognized Python objects including:
- Tensors (PyTorch, NumPy)
- PIL Images
- SafeTensors models
- Generic class objects

Generates metrics, spectral data for image types, and trimmed serializations.
"""

import json
import inspect
import sys
from typing import Dict, Optional

from .base_parser import BaseParser


class ObjectParser(BaseParser):
    """Parser for generic Python objects with introspection and metrics."""

    PARSER_NAME = "object"
    PARSER_PRIORITY = 5  # Low priority - fallback for unrecognized objects
    OUTPUT_MARKER = "$WAS_OBJECT$"

    # Size limits for serialization
    MAX_TENSOR_ELEMENTS_PREVIEW = 100
    MAX_STRING_LENGTH = 500
    MAX_LIST_ITEMS = 50
    MAX_DICT_KEYS = 100
    MAX_ATTR_VALUE_LENGTH = 200

    @classmethod
    def detect_input(cls, content) -> bool:
        """Detect any non-None object that isn't handled by other parsers."""
        if content is None:
            return False

        # Check if it's a list/tuple of items
        items = content if isinstance(content, (list, tuple)) else [content]

        for item in items:
            if item is None:
                continue
            # Accept any object type - this is our fallback parser
            if cls._is_introspectable(item):
                return True

        return False

    @classmethod
    def _is_introspectable(cls, obj) -> bool:
        """Check if object is worth introspecting (not a basic string/number)."""
        if obj is None:
            return False
        # Skip basic types that text view handles better
        if isinstance(obj, (str, int, float, bool)):
            return False
        # Accept everything else
        return True

    @classmethod
    def handle_input(cls, content, logger=None) -> dict:
        """Process objects and generate metrics/serialization for display."""
        items = content if isinstance(content, (list, tuple)) else [content]

        object_data = {
            "type": "object_viewer",
            "objects": [],
            "count": 0,
        }

        for idx, item in enumerate(items):
            if item is None:
                continue

            obj_info = cls._introspect_object(item, logger)
            if obj_info:
                obj_info["index"] = idx
                object_data["objects"].append(obj_info)

        object_data["count"] = len(object_data["objects"])

        if object_data["count"] == 0:
            return None

        display_content = cls.OUTPUT_MARKER + json.dumps(object_data, default=str)
        content_hash = f"object_{len(object_data['objects'])}_{hash(str(content)[:100]) & 0xFFFFFFFF}"

        if logger:
            logger.info(f"[Object Parser] Processed {object_data['count']} objects")

        return {
            "display_content": display_content,
            "output_values": list(items),
            "content_hash": content_hash,
        }

    @classmethod
    def _introspect_object(cls, obj, logger=None) -> Optional[Dict]:
        """Generate full introspection data for an object."""
        obj_type = type(obj).__name__
        module = type(obj).__module__

        result = {
            "type_name": obj_type,
            "module": module,
            "full_type": f"{module}.{obj_type}" if module != "builtins" else obj_type,
            "category": cls._categorize_object(obj),
            "metrics": {},
            "spectral": None,
            "attributes": {},
            "serialized": None,
            "source_info": None,
        }

        # Get category-specific data
        category = result["category"]

        if category == "tensor":
            result["metrics"] = cls._get_tensor_metrics(obj)
            result["spectral"] = cls._get_tensor_spectral(obj)
            result["serialized"] = cls._serialize_tensor(obj)

        elif category == "pil_image":
            result["metrics"] = cls._get_pil_metrics(obj)
            result["spectral"] = cls._get_pil_spectral(obj)
            result["serialized"] = cls._serialize_pil(obj)

        elif category == "numpy":
            result["metrics"] = cls._get_numpy_metrics(obj)
            result["spectral"] = cls._get_numpy_spectral(obj)
            result["serialized"] = cls._serialize_numpy(obj)

        elif category == "safetensors":
            result["metrics"] = cls._get_safetensors_metrics(obj)
            result["serialized"] = cls._serialize_safetensors(obj)

        elif category == "dict":
            result["metrics"] = cls._get_dict_metrics(obj)
            result["serialized"] = cls._serialize_dict(obj)

        elif category == "list":
            result["metrics"] = cls._get_list_metrics(obj)
            result["serialized"] = cls._serialize_list(obj)

        else:
            # Generic object
            result["attributes"] = cls._get_object_attributes(obj)
            result["metrics"] = cls._get_object_metrics(obj)
            result["source_info"] = cls._get_source_info(obj)
            result["serialized"] = cls._serialize_object(obj)

        return result

    @classmethod
    def _categorize_object(cls, obj) -> str:
        """Determine the category of an object."""
        obj_type = type(obj).__name__
        module = type(obj).__module__

        # Check for tensor types
        if hasattr(obj, "shape") and hasattr(obj, "dtype"):
            if "torch" in module:
                return "tensor"
            if "numpy" in module or obj_type == "ndarray":
                return "numpy"

        # Check for PIL Image
        if "PIL" in module or obj_type == "Image":
            return "pil_image"

        # Check for safetensors
        if (
            "safetensors" in module
            or hasattr(obj, "keys")
            and hasattr(obj, "get_tensor")
        ):
            return "safetensors"

        # Basic collections
        if isinstance(obj, dict):
            return "dict"
        if isinstance(obj, (list, tuple)):
            return "list"

        return "object"

    # ========== TENSOR METHODS ==========

    @classmethod
    def _get_tensor_metrics(cls, tensor) -> Dict:
        """Get metrics for PyTorch tensor."""
        try:

            metrics = {
                "shape": list(tensor.shape),
                "dtype": str(tensor.dtype),
                "device": str(tensor.device),
                "numel": int(tensor.numel()),
                "ndim": int(tensor.ndim),
                "requires_grad": bool(tensor.requires_grad),
                "is_contiguous": bool(tensor.is_contiguous()),
            }

            # Memory info
            metrics["memory_bytes"] = tensor.element_size() * tensor.numel()
            metrics["memory_human"] = cls._format_bytes(metrics["memory_bytes"])

            # Statistical metrics (on CPU for safety)
            try:
                t = tensor.detach().float()
                if t.device.type != "cpu":
                    t = t.cpu()

                metrics["stats"] = {
                    "min": float(t.min()),
                    "max": float(t.max()),
                    "mean": float(t.mean()),
                    "std": float(t.std()),
                }

                # Check for image-like tensor
                if len(tensor.shape) >= 3:
                    if tensor.shape[-1] in (1, 3, 4):  # HWC format
                        metrics["image_format"] = "HWC"
                        metrics["resolution"] = f"{tensor.shape[-3]}x{tensor.shape[-2]}"
                        metrics["channels"] = int(tensor.shape[-1])
                    elif tensor.shape[-3] in (1, 3, 4):  # CHW format
                        metrics["image_format"] = "CHW"
                        metrics["resolution"] = f"{tensor.shape[-2]}x{tensor.shape[-1]}"
                        metrics["channels"] = int(tensor.shape[-3])
            except Exception:
                pass

            return metrics
        except Exception as e:
            return {"error": str(e)}

    @classmethod
    def _get_tensor_spectral(cls, tensor) -> Optional[Dict]:
        """Generate spectral/histogram data for tensor."""
        try:
            import torch

            t = tensor.detach().float()
            if t.device.type != "cpu":
                t = t.cpu()

            # Check if it looks like an image tensor
            shape = tensor.shape
            is_image = False
            channels = 0

            if len(shape) >= 3:
                if shape[-1] in (1, 3, 4):  # HWC
                    is_image = True
                    channels = shape[-1]
                    # Flatten batch dimensions if present
                    if len(shape) == 4:
                        t = t[0]  # Take first in batch
                elif shape[-3] in (1, 3, 4):  # CHW
                    is_image = True
                    channels = shape[-3]
                    if len(shape) == 4:
                        t = t[0]
                    t = t.permute(1, 2, 0)  # Convert to HWC

            if not is_image:
                # Generate simple histogram for non-image tensor
                flat = t.flatten()
                hist, bin_edges = torch.histogram(flat, bins=64)
                return {
                    "type": "histogram",
                    "data": hist.tolist(),
                    "bins": bin_edges.tolist(),
                }

            # Generate channel histograms for image
            spectral = {
                "type": "spectral",
                "channels": [],
            }

            channel_names = (
                ["R", "G", "B", "A"][:channels]
                if channels <= 4
                else [f"C{i}" for i in range(channels)]
            )

            for i in range(channels):
                channel = t[..., i].flatten()
                hist, bin_edges = torch.histogram(channel, bins=64, range=(0.0, 1.0))
                spectral["channels"].append(
                    {
                        "name": channel_names[i],
                        "histogram": hist.tolist(),
                        "bins": bin_edges.tolist(),
                    }
                )

            return spectral
        except Exception:
            return None

    @classmethod
    def _serialize_tensor(cls, tensor) -> str:
        """Create trimmed serialization of tensor."""
        try:
            t = tensor.detach()
            if t.device.type != "cpu":
                t = t.cpu()

            flat = t.flatten()
            total = len(flat)

            if total <= cls.MAX_TENSOR_ELEMENTS_PREVIEW:
                data = flat.tolist()
                truncated = False
            else:
                # Show first and last elements
                half = cls.MAX_TENSOR_ELEMENTS_PREVIEW // 2
                first = flat[:half].tolist()
                last = flat[-half:].tolist()
                data = first + ["..."] + last
                truncated = True

            return json.dumps(
                {
                    "preview": data,
                    "truncated": truncated,
                    "total_elements": total,
                }
            )
        except Exception as e:
            return json.dumps({"error": str(e)})

    # ========== PIL IMAGE METHODS ==========

    @classmethod
    def _get_pil_metrics(cls, img) -> Dict:
        """Get metrics for PIL Image."""
        try:
            metrics = {
                "size": list(img.size),
                "resolution": f"{img.width}x{img.height}",
                "mode": img.mode,
                "format": img.format,
                "channels": len(img.getbands()),
                "bands": img.getbands(),
            }

            # Color profile info
            if hasattr(img, "info"):
                if "icc_profile" in img.info:
                    metrics["has_icc_profile"] = True
                if "dpi" in img.info:
                    metrics["dpi"] = img.info["dpi"]
                if "exif" in img.info:
                    metrics["has_exif"] = True

            # Memory estimate
            pixels = img.width * img.height
            bytes_per_pixel = len(img.getbands())
            metrics["memory_bytes"] = pixels * bytes_per_pixel
            metrics["memory_human"] = cls._format_bytes(metrics["memory_bytes"])

            # Statistical info
            try:
                import numpy as np

                arr = np.array(img)
                metrics["stats"] = {
                    "min": int(arr.min()),
                    "max": int(arr.max()),
                    "mean": float(arr.mean()),
                    "std": float(arr.std()),
                }
            except Exception:
                pass

            return metrics
        except Exception as e:
            return {"error": str(e)}

    @classmethod
    def _get_pil_spectral(cls, img) -> Optional[Dict]:
        """Generate spectral/histogram data for PIL Image."""
        try:
            import numpy as np

            arr = np.array(img)
            channels = arr.shape[-1] if len(arr.shape) == 3 else 1

            spectral = {
                "type": "spectral",
                "channels": [],
            }

            bands = img.getbands()

            if len(arr.shape) == 2:
                # Grayscale
                hist, bin_edges = np.histogram(arr.flatten(), bins=64, range=(0, 255))
                spectral["channels"].append(
                    {
                        "name": "L",
                        "histogram": hist.tolist(),
                        "bins": bin_edges.tolist(),
                    }
                )
            else:
                for i in range(min(channels, 4)):
                    channel = arr[..., i].flatten()
                    hist, bin_edges = np.histogram(channel, bins=64, range=(0, 255))
                    spectral["channels"].append(
                        {
                            "name": bands[i] if i < len(bands) else f"C{i}",
                            "histogram": hist.tolist(),
                            "bins": bin_edges.tolist(),
                        }
                    )

            return spectral
        except Exception:
            return None

    @classmethod
    def _serialize_pil(cls, img) -> str:
        """Create trimmed serialization of PIL Image."""
        try:
            info = {
                "format": img.format,
                "mode": img.mode,
                "size": img.size,
                "info_keys": list(img.info.keys()) if hasattr(img, "info") else [],
            }
            return json.dumps(info)
        except Exception as e:
            return json.dumps({"error": str(e)})

    # ========== NUMPY METHODS ==========

    @classmethod
    def _get_numpy_metrics(cls, arr) -> Dict:
        """Get metrics for NumPy array."""
        try:

            metrics = {
                "shape": list(arr.shape),
                "dtype": str(arr.dtype),
                "ndim": int(arr.ndim),
                "size": int(arr.size),
                "itemsize": int(arr.itemsize),
                "memory_bytes": int(arr.nbytes),
                "memory_human": cls._format_bytes(arr.nbytes),
                "is_contiguous": bool(arr.flags["C_CONTIGUOUS"]),
            }

            # Statistics
            try:
                metrics["stats"] = {
                    "min": float(arr.min()),
                    "max": float(arr.max()),
                    "mean": float(arr.mean()),
                    "std": float(arr.std()),
                }
            except Exception:
                pass

            # Check for image-like array
            if len(arr.shape) >= 2:
                if len(arr.shape) == 2:
                    metrics["image_format"] = "Grayscale"
                    metrics["resolution"] = f"{arr.shape[1]}x{arr.shape[0]}"
                elif arr.shape[-1] in (1, 3, 4):
                    metrics["image_format"] = "HWC"
                    metrics["resolution"] = f"{arr.shape[1]}x{arr.shape[0]}"
                    metrics["channels"] = int(arr.shape[-1])

            return metrics
        except Exception as e:
            return {"error": str(e)}

    @classmethod
    def _get_numpy_spectral(cls, arr) -> Optional[Dict]:
        """Generate spectral/histogram data for NumPy array."""
        try:
            import numpy as np

            # Check if image-like
            is_image = False
            if len(arr.shape) >= 2 and len(arr.shape) <= 3:
                if len(arr.shape) == 2 or arr.shape[-1] in (1, 3, 4):
                    is_image = True

            if not is_image:
                flat = arr.flatten()
                hist, bin_edges = np.histogram(flat, bins=64)
                return {
                    "type": "histogram",
                    "data": hist.tolist(),
                    "bins": bin_edges.tolist(),
                }

            spectral = {
                "type": "spectral",
                "channels": [],
            }

            # Normalize range based on dtype
            if arr.dtype == np.uint8:
                range_val = (0, 255)
            elif arr.dtype in (np.float32, np.float64):
                range_val = (0.0, 1.0)
            else:
                range_val = (float(arr.min()), float(arr.max()))

            channel_names = ["R", "G", "B", "A"]

            if len(arr.shape) == 2:
                hist, bin_edges = np.histogram(arr.flatten(), bins=64, range=range_val)
                spectral["channels"].append(
                    {
                        "name": "L",
                        "histogram": hist.tolist(),
                        "bins": bin_edges.tolist(),
                    }
                )
            else:
                channels = arr.shape[-1]
                for i in range(min(channels, 4)):
                    channel = arr[..., i].flatten()
                    hist, bin_edges = np.histogram(channel, bins=64, range=range_val)
                    spectral["channels"].append(
                        {
                            "name": (
                                channel_names[i] if i < len(channel_names) else f"C{i}"
                            ),
                            "histogram": hist.tolist(),
                            "bins": bin_edges.tolist(),
                        }
                    )

            return spectral
        except Exception:
            return None

    @classmethod
    def _serialize_numpy(cls, arr) -> str:
        """Create trimmed serialization of NumPy array."""
        try:

            flat = arr.flatten()
            total = len(flat)

            if total <= cls.MAX_TENSOR_ELEMENTS_PREVIEW:
                data = flat.tolist()
                truncated = False
            else:
                half = cls.MAX_TENSOR_ELEMENTS_PREVIEW // 2
                first = flat[:half].tolist()
                last = flat[-half:].tolist()
                data = first + ["..."] + last
                truncated = True

            return json.dumps(
                {
                    "preview": data,
                    "truncated": truncated,
                    "total_elements": total,
                }
            )
        except Exception as e:
            return json.dumps({"error": str(e)})

    # ========== SAFETENSORS METHODS ==========

    @classmethod
    def _get_safetensors_metrics(cls, obj) -> Dict:
        """Get metrics for SafeTensors object/dict."""
        try:
            metrics = {
                "tensor_count": 0,
                "total_parameters": 0,
                "total_bytes": 0,
                "tensor_info": [],
            }

            # Handle different safetensors representations
            if hasattr(obj, "keys"):
                keys = list(obj.keys())
                metrics["tensor_count"] = len(keys)

                for key in keys[:50]:  # Limit to first 50 for display
                    try:
                        if hasattr(obj, "get_tensor"):
                            tensor = obj.get_tensor(key)
                        else:
                            tensor = obj[key]

                        if hasattr(tensor, "shape"):
                            shape = list(tensor.shape)
                            numel = 1
                            for s in shape:
                                numel *= s
                            metrics["total_parameters"] += numel

                            dtype = (
                                str(tensor.dtype)
                                if hasattr(tensor, "dtype")
                                else "unknown"
                            )
                            metrics["tensor_info"].append(
                                {
                                    "name": key,
                                    "shape": shape,
                                    "dtype": dtype,
                                    "params": numel,
                                }
                            )
                    except Exception:
                        metrics["tensor_info"].append(
                            {
                                "name": key,
                                "error": "Could not read tensor",
                            }
                        )

                if len(keys) > 50:
                    metrics["tensor_info"].append(
                        {
                            "name": f"... and {len(keys) - 50} more tensors",
                            "truncated": True,
                        }
                    )

            metrics["total_params_human"] = cls._format_number(
                metrics["total_parameters"]
            )

            return metrics
        except Exception as e:
            return {"error": str(e)}

    @classmethod
    def _serialize_safetensors(cls, obj) -> str:
        """Create trimmed serialization of SafeTensors."""
        try:
            if hasattr(obj, "keys"):
                keys = list(obj.keys())
                return json.dumps(
                    {
                        "tensor_names": keys[:100],
                        "truncated": len(keys) > 100,
                        "total_tensors": len(keys),
                    }
                )
            return json.dumps({"type": "safetensors", "readable": False})
        except Exception as e:
            return json.dumps({"error": str(e)})

    # ========== DICT/LIST METHODS ==========

    @classmethod
    def _get_dict_metrics(cls, obj: dict) -> Dict:
        """Get metrics for dictionary."""
        return {
            "key_count": len(obj),
            "keys": list(obj.keys())[: cls.MAX_DICT_KEYS],
            "truncated_keys": len(obj) > cls.MAX_DICT_KEYS,
            "memory_estimate": cls._estimate_size(obj),
        }

    @classmethod
    def _serialize_dict(cls, obj: dict) -> str:
        """Create trimmed serialization of dict."""
        try:
            trimmed = {}
            for i, (k, v) in enumerate(obj.items()):
                if i >= cls.MAX_DICT_KEYS:
                    trimmed["__truncated__"] = (
                        f"{len(obj) - cls.MAX_DICT_KEYS} more keys..."
                    )
                    break
                trimmed[str(k)] = cls._serialize_value(v)
            return json.dumps(trimmed, default=str, indent=2)
        except Exception as e:
            return json.dumps({"error": str(e)})

    @classmethod
    def _get_list_metrics(cls, obj) -> Dict:
        """Get metrics for list/tuple."""
        return {
            "length": len(obj),
            "type": type(obj).__name__,
            "item_types": list(set(type(x).__name__ for x in obj[:100])),
            "memory_estimate": cls._estimate_size(obj),
        }

    @classmethod
    def _serialize_list(cls, obj) -> str:
        """Create trimmed serialization of list."""
        try:
            if len(obj) <= cls.MAX_LIST_ITEMS:
                items = [cls._serialize_value(v) for v in obj]
            else:
                half = cls.MAX_LIST_ITEMS // 2
                items = [cls._serialize_value(v) for v in obj[:half]]
                items.append(f"... ({len(obj) - cls.MAX_LIST_ITEMS} more items) ...")
                items.extend([cls._serialize_value(v) for v in obj[-half:]])
            return json.dumps(items, default=str, indent=2)
        except Exception as e:
            return json.dumps({"error": str(e)})

    # ========== GENERIC OBJECT METHODS ==========

    @classmethod
    def _get_object_attributes(cls, obj) -> Dict:
        """Get attributes of a generic object."""
        attrs = {}

        try:
            # Get all attributes
            for name in dir(obj):
                if name.startswith("__"):
                    continue
                try:
                    value = getattr(obj, name)
                    if callable(value):
                        continue  # Skip methods

                    attrs[name] = {
                        "type": type(value).__name__,
                        "value": cls._serialize_value(
                            value, max_len=cls.MAX_ATTR_VALUE_LENGTH
                        ),
                    }

                    if len(attrs) >= cls.MAX_DICT_KEYS:
                        break
                except Exception:
                    pass
        except Exception:
            pass

        return attrs

    @classmethod
    def _get_object_metrics(cls, obj) -> Dict:
        """Get metrics for a generic object."""
        metrics = {
            "type": type(obj).__name__,
            "module": type(obj).__module__,
            "id": id(obj),
        }

        # Try to get size
        try:
            metrics["size_bytes"] = sys.getsizeof(obj)
            metrics["size_human"] = cls._format_bytes(metrics["size_bytes"])
        except Exception:
            pass

        # Count attributes
        try:
            attrs = [
                a
                for a in dir(obj)
                if not a.startswith("__") and not callable(getattr(obj, a, None))
            ]
            methods = [
                m
                for m in dir(obj)
                if not m.startswith("__") and callable(getattr(obj, m, None))
            ]
            metrics["attribute_count"] = len(attrs)
            metrics["method_count"] = len(methods)
        except Exception:
            pass

        # Check for common interfaces
        metrics["interfaces"] = []
        if hasattr(obj, "__iter__"):
            metrics["interfaces"].append("iterable")
        if hasattr(obj, "__len__"):
            metrics["interfaces"].append("sized")
            try:
                metrics["length"] = len(obj)
            except Exception:
                pass
        if hasattr(obj, "__call__"):
            metrics["interfaces"].append("callable")
        if hasattr(obj, "__getitem__"):
            metrics["interfaces"].append("subscriptable")

        return metrics

    @classmethod
    def _get_source_info(cls, obj) -> Optional[Dict]:
        """Try to get source file info for the object's class."""
        try:
            cls_type = type(obj)
            source_info = {}

            try:
                source_info["file"] = inspect.getfile(cls_type)
            except Exception:
                pass

            try:
                source_info["source_lines"] = len(inspect.getsourcelines(cls_type)[0])
            except Exception:
                pass

            # Get class hierarchy
            try:
                mro = [
                    c.__name__ for c in cls_type.__mro__[1:-1]
                ]  # Skip self and object
                if mro:
                    source_info["bases"] = mro
            except Exception:
                pass

            return source_info if source_info else None
        except Exception:
            return None

    @classmethod
    def _serialize_object(cls, obj) -> str:
        """Create trimmed serialization of generic object."""
        try:
            # Try repr first
            repr_str = repr(obj)
            if len(repr_str) > cls.MAX_STRING_LENGTH:
                repr_str = repr_str[: cls.MAX_STRING_LENGTH] + "..."

            return json.dumps(
                {
                    "repr": repr_str,
                    "type": type(obj).__name__,
                }
            )
        except Exception as e:
            return json.dumps({"error": str(e)})

    # ========== UTILITY METHODS ==========

    @classmethod
    def _serialize_value(cls, value, max_len: int = None) -> str:
        """Serialize a single value with truncation."""
        max_len = max_len or cls.MAX_ATTR_VALUE_LENGTH

        try:
            if value is None:
                return "null"
            if isinstance(value, (bool,)):
                return str(value).lower()
            if isinstance(value, (int, float)):
                return str(value)
            if isinstance(value, str):
                if len(value) > max_len:
                    return f'"{value[:max_len]}..."'
                return f'"{value}"'
            if isinstance(value, (list, tuple)):
                if len(value) > 10:
                    return f"[{type(value).__name__} of {len(value)} items]"
                return str(value)[:max_len]
            if isinstance(value, dict):
                return f"{{dict of {len(value)} keys}}"
            if hasattr(value, "shape"):
                return f"<{type(value).__name__} shape={list(value.shape)}>"

            s = repr(value)
            if len(s) > max_len:
                return s[:max_len] + "..."
            return s
        except Exception:
            return "<unserializable>"

    @classmethod
    def _estimate_size(cls, obj) -> str:
        """Estimate memory size of object."""
        try:
            size = sys.getsizeof(obj)
            return cls._format_bytes(size)
        except Exception:
            return "unknown"

    @staticmethod
    def _format_bytes(size: int) -> str:
        """Format bytes to human readable."""
        for unit in ["B", "KB", "MB", "GB", "TB"]:
            if abs(size) < 1024:
                return f"{size:.1f} {unit}"
            size /= 1024
        return f"{size:.1f} PB"

    @staticmethod
    def _format_number(num: int) -> str:
        """Format large number to human readable."""
        if num < 1000:
            return str(num)
        for unit in ["", "K", "M", "B", "T"]:
            if abs(num) < 1000:
                return f"{num:.1f}{unit}"
            num /= 1000
        return f"{num:.1f}P"

    @classmethod
    def detect_output(cls, content: str) -> bool:
        """Check if content has object output marker."""
        if not isinstance(content, str):
            return False
        return content.startswith(cls.OUTPUT_MARKER)

    @classmethod
    def parse_output(cls, content: str, logger=None) -> dict:
        """Parse object output - typically just pass through."""
        # Object view is display-only, no conversion needed
        return None
