/**
 * View Manifest for ComfyUI Viewer
 * 
 * This file lists all view modules to be loaded.
 * Extensions can add their own views by importing and calling registerView()
 * after views are loaded, or by creating their own manifest.
 * 
 * To add a new view:
 * 1. Create a view file (e.g., myview.js) that exports a class extending BaseView
 * 2. Add the filename to VIEW_FILES array below
 */

export const VIEW_FILES = [
  "canvas.js",
  "html.js",
  "svg.js", 
  "markdown.js",
  "json.js",
  "csv.js",
  "yaml.js",
  "ansi.js",
  "python.js",
  "javascript.js",
  "css.js",
  "object.js",
  "text.js",
];
