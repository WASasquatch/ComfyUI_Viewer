"""
HTML Parser for WAS Content Viewer.

"""

from .base_parser import BaseParser


class HtmlParser(BaseParser):
    """HTML parser for HTML content display."""
    
    PARSER_NAME = "html"
    PARSER_PRIORITY = 10
