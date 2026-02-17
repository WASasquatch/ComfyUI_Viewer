"""
YAML Parser for WAS Content Viewer.

"""

from .base_parser import BaseParser


class YamlParser(BaseParser):
    """YAML parser for YAML content display."""

    PARSER_NAME = "yaml"
    PARSER_PRIORITY = 10
