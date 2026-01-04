"""
Base Parser for WAS Content Viewer.

All view parsers must extend BaseParser. The parser loader discovers and
registers subclasses automatically from *_parser.py files.

Parser Interface:
- PARSER_NAME: str - Unique identifier matching frontend view id
- PARSER_PRIORITY: int - Higher priority parsers are checked first
- detect_input(content) -> bool - Returns True if this parser handles this input
- handle_input(content, logger) -> dict - Process input for display
- detect_output(content: str) -> bool - Returns True if content has output marker
- parse_output(content: str, logger) -> dict - Convert output to backend types
"""

from abc import ABC


class BaseParser(ABC):
    """
    Abstract base class for all view parsers.
    
    Subclasses must define PARSER_NAME. Override methods as needed.
    Default implementations return False/None for passthrough behavior.
    """
    
    PARSER_NAME: str = "base"
    PARSER_PRIORITY: int = 0
    OUTPUT_MARKER: str = None
    
    @classmethod
    def detect_input(cls, content) -> bool:
        """
        Check if this parser should handle the input content.
        
        Override to detect specific content types (e.g., IMAGE tensors).
        Return False for passthrough parsers.
        """
        return False
    
    @classmethod
    def handle_input(cls, content, logger=None) -> dict:
        """
        Process input content for display.
        
        Returns:
            dict with keys:
                - display_content: str - Content for frontend
                - output_values: list - Values to pass through
                - content_hash: str - Hash for caching
            or None if not handling
        """
        return None
    
    @classmethod
    def detect_output(cls, content: str) -> bool:
        """
        Check if content contains this parser's output marker.
        
        Override if parser converts frontend output to backend types.
        """
        if cls.OUTPUT_MARKER and isinstance(content, str):
            return content.startswith(cls.OUTPUT_MARKER)
        return False
    
    @classmethod
    def parse_output(cls, content: str, logger=None) -> dict:
        """
        Parse output content and convert to backend types.
        
        Returns:
            dict with keys:
                - output_values: list - Converted values
                - display_text: str - Text to show in UI
                - content_hash: str - Hash for caching
            or None if not handling
        """
        return None
    
    @classmethod
    def detect_state(cls, state_data: dict) -> bool:
        """
        Check if this parser should handle the given state data.
        
        Override to detect specific state formats (e.g., canvas state with dataUrl).
        Return False for parsers that don't handle state.
        """
        return False
    
    @classmethod
    def parse_state(cls, state_data: dict, logger=None) -> dict:
        """
        Parse state data from frontend and convert to backend types.
        
        Returns:
            dict with parser-specific keys (e.g., image, mask for canvas)
            or None if not handling
        """
        return None
    
    @classmethod
    def detect_display_content(cls, content) -> bool:
        """
        Check if this parser should prepare display content for the given input.
        
        Override to detect specific content types for display preparation.
        Return False for parsers that don't handle display preparation.
        """
        return False
    
    @classmethod
    def prepare_display(cls, content, logger=None) -> dict:
        """
        Prepare content for frontend display.
        
        Returns:
            dict with keys:
                - display_content: str - JSON or content for frontend
                - content_hash: str - Hash for caching
                - count: int - Number of items (optional)
            or None if not handling
        """
        return None
    
    @classmethod
    def get_default_outputs(cls, content, output_types: list, logger=None) -> tuple:
        """
        Get default output values based on input content and expected output types.
        
        Args:
            content: Input content
            output_types: List of expected output type names (e.g., ["IMAGE", "MASK"])
            logger: Optional logger
        
        Returns:
            tuple of default values matching output_types, or None if not handling
        """
        return None
