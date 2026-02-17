"""
SVG Parser for WAS Content Viewer.

"""

from .base_parser import BaseParser


class SvgParser(BaseParser):
    """SVG parser for SVG content display."""

    PARSER_NAME = "svg"
    PARSER_PRIORITY = 10
