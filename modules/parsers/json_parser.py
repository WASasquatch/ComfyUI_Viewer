"""
JSON Parser for WAS Content Viewer.

"""

from .base_parser import BaseParser


class JsonParser(BaseParser):
    """JSON parser for JSON content display."""
    
    PARSER_NAME = "json"
    PARSER_PRIORITY = 10
