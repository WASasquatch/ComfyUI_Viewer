# ComfyUI Content Viewer

![Content Viewer](https://img.shields.io/badge/ComfyUI-Custom_Node-blue)
![License](https://img.shields.io/badge/License-MIT-green)

A versatile ComfyUI custom node that renders HTML, SVG, Markdown, and code content in a secure embedded iframe viewer with full editing, download, and list support.

## Features

### Content Rendering
- **Auto-detection** of content type: HTML, SVG, Markdown, Python, JavaScript, CSS, or plain text
- **SVG support** - Renders SVG graphics centered in the viewport
- **Markdown parsing** - Full support for headers, lists, links, images, code blocks, tables, and emphasis
- **Code formatting** - Code content displayed with monospace font in styled blocks
- **ComfyUI theme integration** - Automatically matches ComfyUI's theme colors

### List Support
- **Multiple items** - Displays list inputs as individual indexed containers
- **Per-item copy buttons** - Copy individual list items to clipboard
- **Per-item editing** - Edit each list item in its own textarea
- **List separator** - Items joined/split using `---LIST_SEPARATOR---`

### Controls
- **Edit** - Modify content directly in the node (supports both single and list content)
- **Clear** - Reset all content
- **Fullscreen** - Expand viewer to full screen (press Escape to exit)
- **Download** - Save content with auto-detected file extension
  - Single content → Downloads as `.html`, `.svg`, `.md`, `.py`, `.js`, `.css`, or `.txt`
  - List content → Downloads as `.zip` containing individually named files (`item_001.txt`, `item_002.txt`, etc.)

### Data Flow
- **STRING output** - Passes content downstream for further processing
- **Flexible input** - Accepts any type via `content` input (STRING, lists, objects)
- **Content priority** - User edits > Backend execution > Dynamic connected content
- **Workflow persistence** - Manual edits saved with the workflow

### Security
- **Sandboxed iframe** - Content runs in isolated sandbox without access to parent page
- **No same-origin** - Iframe cannot access ComfyUI's JavaScript context or localStorage


## Installation

- **Option A (git clone)**
  - Clone this repo into:
    - `ComfyUI/custom_nodes/ComfyUI_Viewer`

- **Option B (Manager)**
  - Open Manager and install **ComfyUI_Viewer**

- **Option C (zip)**
  - Download the repo as a zip.
  - Extract it to:
    - `ComfyUI/custom_nodes/ComfyUI_Viewer`

## Usage

### Basic Usage
1. Add the **Content Viewer** node (found in `WAS/View` category)
2. Connect any STRING output to the `content` input
3. Content will be auto-detected and rendered

### As a Notes/Documentation Node
1. Add the **Content Viewer** node
2. Click **Edit** in the controls bar
3. Enter your HTML, Markdown, or text content
4. Click **Save** to render

### Working with Lists
When connecting a node that outputs multiple strings:
1. Each string displays in its own container with an index label
2. Click the copy button on any item to copy just that content
3. Click **Edit** to modify individual items
4. Click **Download** to get a `.zip` file with each item as a separate file

## Supported Content Types

| Type | Detection | File Extension |
|------|-----------|----------------|
| **HTML** | `<!DOCTYPE`, `<html`, or common HTML tags | `.html` |
| **SVG** | `<svg` tag with optional XML declaration and valid xmlns attribute | `.svg` |
| **Markdown** | Headers (`#`), lists, links, images (`![]()`), code blocks, tables | `.md` |
| **Python** | `import`, `def`, `class`, `self.` | `.py` |
| **JavaScript** | `function`, `const`, `let`, `var`, arrow functions | `.js` |
| **CSS** | Selectors with `{}`, properties with `:` and `;` | `.css` |
| **Text** | Default fallback | `.txt` |

## Troubleshooting

### Content not updating
- Ensure the connected node is executing (queue the workflow)
- Try disconnecting and reconnecting the input

### Errors
Check the browser console (F12) for `[WAS Viewer]` prefixed messages. Error logs include context for debugging and can be reported via GitHub issues.

### SVG not rendering
- Ensure the SVG includes proper `xmlns` attribute: `xmlns="http://www.w3.org/2000/svg"`
- Verify the SVG is valid XML

## API

### Inputs
| Name | Type | Description |
|------|------|-------------|
| `content` | ANY | Content to display (optional, supports lists) |

### Outputs
| Name | Type | Description |
|------|------|-------------|
| `content` | STRING[] | Current content as list of strings |

### Hidden Widgets
| Name | Description |
|------|-------------|
| `manual_content` | Stores user-edited content (persisted with workflow) |
