"""
ANSI Parser for WAS Content Viewer.

"""

from .base_parser import BaseParser


class AnsiParser(BaseParser):
    """ANSI parser for terminal output with ANSI escape codes."""
    
    PARSER_NAME = "ansi"
    PARSER_PRIORITY = 10
