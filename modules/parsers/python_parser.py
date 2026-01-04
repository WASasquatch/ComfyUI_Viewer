"""
Python Parser for WAS Content Viewer.

"""

from .base_parser import BaseParser


class PythonParser(BaseParser):
    """Python parser for Python code display."""
    
    PARSER_NAME = "python"
    PARSER_PRIORITY = 10
