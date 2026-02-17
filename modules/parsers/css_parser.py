"""
CSS Parser for WAS Content Viewer.

"""

from .base_parser import BaseParser


class CssParser(BaseParser):
    """CSS parser for CSS code display."""

    PARSER_NAME = "css"
    PARSER_PRIORITY = 10
