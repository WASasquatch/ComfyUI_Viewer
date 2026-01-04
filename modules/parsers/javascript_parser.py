"""
JavaScript Parser for WAS Content Viewer.

"""

from .base_parser import BaseParser


class JavaScriptParser(BaseParser):
    """JavaScript parser for JavaScript code display."""
    
    PARSER_NAME = "javascript"
    PARSER_PRIORITY = 10
