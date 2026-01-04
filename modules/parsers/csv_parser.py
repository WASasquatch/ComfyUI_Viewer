"""
CSV Parser for WAS Content Viewer.

"""

from .base_parser import BaseParser


class CsvParser(BaseParser):
    """CSV parser for CSV content display."""
    
    PARSER_NAME = "csv"
    PARSER_PRIORITY = 10
