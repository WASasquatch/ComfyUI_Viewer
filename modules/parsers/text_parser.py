"""
Text Parser for WAS Content Viewer.

Handles plain text content.

"""

from .base_parser import BaseParser


class TextParser(BaseParser):
    """Text parser - fallback for plain text content."""

    PARSER_NAME = "text"
    PARSER_PRIORITY = 1  # Low priority - fallback parser
