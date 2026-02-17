"""
Markdown Parser for WAS Content Viewer.

"""

from .base_parser import BaseParser


class MarkdownParser(BaseParser):
    """Markdown parser for markdown content display."""

    PARSER_NAME = "markdown"
    PARSER_PRIORITY = 10
