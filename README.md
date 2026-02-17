# ComfyUI Content Viewer

![ComfyUI](https://img.shields.io/badge/ComfyUI-Custom_Node-blue) 
![Frontend Extension](https://img.shields.io/badge/ComfyUI_Frontend-Extension-purple)
![License](https://img.shields.io/badge/License-MIT-green)

A powerful, extensible ComfyUI custom node with a modular **Views Extension System** that renders content in a secure embedded iframe viewer. Views are dynamically loaded and can be added, removed, or modified without touching core code.

![Screenshot 9](screenshots/screenshot_14.jpg)

## Table of Contents

- [Screenshots](#screenshots)
- [Features](#features)
- [Third-Party Views](#third-party-views)
- [Built-in Views](#built-in-views)
- [Installation](#installation)
- [Usage](#usage)
- [Creating Extensions](#creating-extensions)
- [Troubleshooting](#troubleshooting)
- [Third-Party Licenses](#third-party-licenses)
- [License](#license)

# Screenshots

<details>
<summary><strong>Screenshots</strong></summary>

![Screenshot 1](screenshots/screenshot_1.jpg)
![Screenshot 2](screenshots/screenshot_2.gif)
![Screenshot 3](screenshots/screenshot_3.jpg)
![Screenshot 4](screenshots/screenshot_4.jpg)
![Screenshot 5](screenshots/screenshot_5.jpg)
![Screenshot 6](screenshots/screenshot_6.jpg)
![Screenshot 7](screenshots/screenshot_7.jpg)
![Screenshot 8](screenshots/screenshot_8.jpg)
![Screenshot 9](screenshots/screenshot_9.jpg)
![Screenshot 6](screenshots/screenshot_10.jpg)
![Screenshot 7](screenshots/screenshot_11.jpg)
![Screenshot 8](screenshots/screenshot_12.jpg)
![Screenshot 9](screenshots/screenshot_13.jpg)
![Screenshot 9](screenshots/screenshot_14.jpg)

</details>

## Features

### Views Extension System
- **Modular architecture** - Each content type is handled by its own view extension
- **Dynamic loading** - Views are auto-discovered from `web/views/view_manifest.js`
- **Priority-based detection** - Higher priority views are checked first for content matching
- **Extensible** - Add custom views without modifying core viewer code
- **Theme integration** - All views receive ComfyUI theme tokens for consistent styling

### Multi-View Support
- **Automatic detection** - When multiple views can handle the same content, a view selector appears
- **View switching** - Toggle between different visualizations of the same data (e.g., tensor as Canvas vs Object inspector)
- **Priority-based default** - The highest priority matching view is shown by default
- **Common use case** - IMAGE tensors are detected by both Canvas (for compositing) and Object (for metrics/inspection) views

### Controls
- **Edit** - Modify content directly in the node (supports both single and list content)
- **Clear** - Reset all content
- **Fullscreen** - Expand viewer to full screen (press Escape to exit)
- **Download** - Save content with auto-detected file extension
  - Single content → Downloads with appropriate extension (`.html`, `.svg`, `.md`, `.py`, etc.)
  - List content → Downloads as `.zip` containing individually named files

### String List Support
- **Multiple items** - Displays list  inputs as individual indexed containers
- **Per-item checkboxes** - Filter which items to include in output
- **Per-item copy buttons** - Copy individual list items to clipboard
- **Per-item editing** - Edit each list item in its own textarea

### Data Flow
- **Flexible input** - Accepts any type via `content` input (STRING, lists, objects, IMAGE tensors)
- **Content priority** - User edits > Backend execution > Connected content
- **Workflow persistence** - Manual edits saved with the workflow

### Security
- **Sandboxed iframe** - Content runs in isolated sandbox without access to parent page
- **No same-origin** - Iframe cannot access ComfyUI's JavaScript context or localStorage

---

## Third-Party Views

| View Name | View Description | View Link |
|-----------|------------------|-----------|
| **Image Search** | Search input/output/temp directories for images by input image | [Image Search](https://github.com/WASasquatch/ComfyUI_Viewer_Image_Search_Extension) |
| **OpenReel Video** | Edit videos generated within ComfyUI (e.g., from AnimateDiff, SVD, frame interpolation, etc.) | [OpenReel Video](https://github.com/WASasquatch/ComfyUI_Viewer_OpenReel_Extension) |

## Built-in Views

The Content Viewer includes 12 built-in views, listed by detection priority:

| View | Priority | Detection | Description |
|------|----------|-----------|-------------|
| **SVG** | 110 | `<svg` tag with xmlns | Renders SVG graphics centered in viewport |
| **HTML** | 100 | `<!DOCTYPE`, `<html`, common HTML tags | Full HTML rendering with scripts |
| **Canvas** (alpha wip) | 95 | JSON with `type: "canvas_composer"` | Beta implementation of a infinite canvas image compositor with layers |
| **JSON** | 90 | Valid JSON starting with `{` or `[` | Collapsible tree view with syntax highlighting |
| **Terminal** | 80 | ANSI escape codes (`\x1b[`, `\033[`) | Colored terminal output parser |
| **Markdown** | 70 | Headers, lists, links, code blocks | Full MD with Mermaid diagrams & KaTeX math |
| **Python** | 60 | `import`, `def`, `class`, `self.` | Prism.js syntax highlighting |
| **JavaScript** | 55 | `function`, `const`, `let`, arrow functions | Prism.js syntax highlighting |
| **CSV** | 50 | Comma-separated values across lines | Styled table rendering |
| **CSS** | 45 | Selectors with `{}`, properties | Prism.js syntax highlighting |
| **YAML** | 40 | Key-value pairs, `---` markers | Syntax highlighted display |
| **Text** | 0 | Default fallback | Monospace plain text |

### View Details

<details>
<summary><strong>Canvas View</strong> - Infinite canvas image compositor</summary>

The Canvas view provides a full-featured image compositing workspace:

- **Layer management** - Add, reorder, hide/show, delete layers
- **Transform tools** - Move, scale, rotate layers with handles
- **Brush tools** - Paint, erase, clone stamp with adjustable size/hardness/opacity
- **Layer effects** - Opacity, blend modes (16 modes), stroke, shadow
- **Layer masks** - Non-destructive masking with brush tools
- **Export** - Download PNG or send composite to node output as IMAGE tensor
- **Navigator** - Mini-map for large canvas navigation
- **Keyboard shortcuts** - V (select), H (pan), B (brush), Delete, Ctrl+Z/Y

The Canvas view outputs `IMAGE` and `MASK` tensors that can be connected to other ComfyUI nodes.

</details>

<details>
<summary><strong>Markdown View</strong> - Rich text with diagrams and math</summary>

Supports full Markdown syntax plus:

- **Mermaid diagrams** - Flowcharts, sequence diagrams, etc. in ` ```mermaid ` blocks
- **KaTeX math** - LaTeX formulas via `$$...$$` (block) or `$...$` (inline)
- **Tables** - Styled with zebra striping
- **Code blocks** - Syntax highlighted with Prism.js
- **Task lists** - Checkbox items `- [x]` and `- [ ]`

</details>

<details>
<summary><strong>JSON View</strong> - Interactive tree viewer</summary>

- **Collapsible nodes** - Click to expand/collapse objects and arrays
- **Syntax highlighting** - Keys, strings, numbers, booleans, null
- **Copy on click** - Click any value to copy it
- **Nested formatting** - Proper indentation for deep structures

</details>

<details>
<summary><strong>Terminal View</strong> - ANSI escape code parser</summary>

Renders terminal output with full ANSI support:

- **16 colors** - Standard terminal colors
- **256 colors** - Extended color palette
- **24-bit colors** - True color RGB
- **Styles** - Bold, italic, underline, strikethrough
- **Reset codes** - Proper handling of reset sequences

</details>

---

## Installation

**Option A (git clone)**
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/WASasquatch/ComfyUI_Viewer.git
```

**Option B (ComfyUI Manager)**
- Open Manager and search for **ComfyUI_Viewer**

**Option C (zip)**
- Download and extract to `ComfyUI/custom_nodes/ComfyUI_Viewer`

---

## Usage

### Basic Usage
1. Add the **Content Viewer** node (found in `WAS/View` category)
2. Connect any STRING output to the `content` input
3. Content type is auto-detected and rendered with the appropriate view

### As a Notes/Documentation Node
1. Add the **Content Viewer** node
2. Click **Edit** in the controls bar
3. Enter your HTML, Markdown, or text content
4. Click **Save** to render

### Using the Canvas Compositor
1. Connect IMAGE outputs to the Canvas Composer node
2. Images appear in the source panel - drag them onto the canvas
3. Use transform handles to position and scale
4. Use brush tools to paint or mask
5. Click **Send to Output** to pass the composite downstream

---

## Creating Extensions

The Content Viewer supports custom view extensions for adding new content types, interactive UIs, and visualizations.

**📖 See the [Extension Development Guide](extensions/README.md) for complete documentation on:**

- Creating extension packages for distribution
- Adding frontend views (JavaScript)
- Adding backend parsers (Python)
- Parser + View integration
- Troubleshooting

**Quick install for users:**
1. Download an extension `.zip` file
2. Place it in `ComfyUI_Viewer/extensions/`
3. Restart ComfyUI

---

## Troubleshooting

### Content not updating
- Ensure the connected node is executing (queue the workflow)
- Try disconnecting and reconnecting the input

### View not detecting content
- Check the browser console (F12) for `[WAS Viewer]` messages
- Verify your view's `detect()` returns a score > 0 for your content
- Check priority - higher priority views are tested first

### Canvas images not loading
- Ensure images are in ComfyUI's input directory.
  - Search for a folder that looks like `was_viewer_032bb95c` where the last part is a unique hash for that nodes canvas content. 
- Check for CORS errors in browser console

### Custom view not appearing
- Verify the file is listed in `view_manifest.js`
- Check for JavaScript errors in browser console
- Ensure `export default YourViewClass` is present

---

## Third-Party Licenses

This project includes the following third-party libraries:

| Library | License | Description | Location |
|---------|---------|-------------|----------|
| [Prism.js](https://prismjs.com/) | MIT | Syntax highlighting for code blocks | `web/views/code_scripts/` |
| [KaTeX](https://katex.org/) | MIT | LaTeX math rendering | `web/views/markdown_scripts/` |
| [Mermaid](https://mermaid.js.org/) | MIT | Diagram and flowchart rendering | `web/views/markdown_scripts/` |
| [KaTeX Fonts](https://katex.org/) | SIL OFL 1.1 | Math fonts for KaTeX | `fonts/` |

Full license texts are included with each library in their respective directories.

---

## License

MIT License - See [LICENSE](LICENSE) for details
