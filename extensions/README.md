# Creating View Extensions for ComfyUI_Viewer

This guide covers how to create view extensions for ComfyUI_Viewer. Extensions can add new content types, interactive UIs, and custom visualizations.

## Table of Contents

- [Extension System Overview](#extension-system-overview)
- [Creating a View Extension Package](#creating-a-view-extension-package)
  - [Project Structure](#project-structure)
  - [Naming Convention](#naming-convention)
  - [Installation Process](#installation-process)
  - [GitHub Distribution](#github-distribution)
  - [Complete Extension Example](#complete-extension-example)
  - [View Manifest Registration](#view-manifest-registration)
  - [Extension Architecture Overview](#extension-architecture-overview)
- [Adding a Frontend View](#adding-a-frontend-view)
  - [Quick Start](#quick-start)
  - [BaseView Interface](#baseview-interface)
  - [Theme Tokens](#theme-tokens)
  - [UI Views](#ui-views)
- [Adding a Backend Parser](#adding-a-backend-parser)
  - [Parser Discovery](#parser-discovery)
  - [Minimal Example: Dictionary Parser](#minimal-example-dictionary-parser)
  - [BaseParser Interface Reference](#baseparser-interface-reference)
  - [Parser + View Integration](#parser--view-integration)
  - [Multi-View Detection](#multi-view-detection)
- [Troubleshooting](#troubleshooting)

---

## Extension System Overview

The Content Viewer has a dual extension system:
- **Frontend Views** - JavaScript modules that render content in the browser iframe
- **Backend Parsers** - Python modules that process objects (tensors, custom types) into displayable data

Extensions can be added in two ways:
1. **Directly** - Add files to the `web/views/` and `modules/parsers/` directories
2. **As a Package** - Create a standalone GitHub repository that users can download and install automatically

---

## Creating a View Extension Package

View Extension packages are standalone GitHub repositories that can be distributed independently. Users download the repository as a `.zip` file, place it in `ComfyUI_Viewer/extensions/`, and the extension is automatically installed on ComfyUI startup.

### Project Structure

Your extension repository should follow this structure:

```
ComfyUI_Viewer_MyAwesomeView/
├── modules/
│   └── parsers/
│       └── my_awesome_view_parser.py    # Backend parser (Python)
├── nodes/
│   └── my_awesome_view_nodes.py         # Custom ComfyUI nodes (optional)
├── web/
│   └── views/
│       ├── my_awesome_view.js           # Frontend view (JavaScript)
│       └── my_awesome_view_scripts/     # Additional scripts/assets (optional)
│           ├── library.min.js
│           └── styles.css
├── requirements.txt                      # Python dependencies (optional)
└── README.md                            # Documentation
```

### Naming Convention

- **Repository name**: `ComfyUI_Viewer_<ExtensionName>_Extension` (e.g., `ComfyUI_Viewer_ImageSearch_Extension`, `ComfyUI_Viewer_AudioPlayer_Extension`)
- **Parser file**: `<extension_name>_parser.py` (must end in `_parser.py` for auto-discovery to separate from other module files you may have)
- **View file**: `<extension_name>.js` (any `.js` file in `web/views/`)
- **Nodes file**: `<extension_name>_nodes.py` (exports `NODE_CLASS_MAPPINGS` and `NODE_DISPLAY_NAME_MAPPINGS`)

### Installation Process

When users place your `.zip` file in `ComfyUI_Viewer/extensions/` and restart ComfyUI, the auto-installer:

1. **Extracts** files from your package to the correct locations:
   - `modules/parsers/*.py` → `ComfyUI_Viewer/modules/parsers/`
   - `web/views/*` → `ComfyUI_Viewer/web/views/`
   - `nodes/*.py` → `ComfyUI_Viewer/nodes/`

2. **Installs dependencies** from `requirements.txt` using ComfyUI's Python interpreter.

3. **Creates a log file** in `extensions/logs/` to track successful installation. **If this file is removed, the extension will be reinstalled on next startup.**

### GitHub Distribution

To enable easy installation via zip download:

1. **Host your extension** as a public GitHub repository
2. **Users download** by clicking `Code → Download ZIP` on GitHub
3. **GitHub automatically** names the zip `<RepoName>-main.zip` or `<RepoName>-master.zip`
4. **The installer handles** the GitHub folder structure.

**Example workflow for users:**
```
1. Go to https://github.com/YourUsername/ComfyUI_Viewer_MyAwesomeView
2. Click "Code" → "Download ZIP"
3. Place the downloaded .zip in ComfyUI/custom_nodes/ComfyUI_Viewer/extensions/
4. Restart ComfyUI
5. Extension is installed (hopefully)!
```

### Extension Example

Here's a minimal "Hello World" extension that demonstrates the core concepts:

- **Input**: Receives a message string from the workflow
- **Display**: Shows the message with a text input for a reply
- **Output**: Sends the user's reply back to the workflow

#### 1. Parser (`modules/parsers/hello_parser.py`)

```python
"""
Hello Parser - Minimal example of a ComfyUI_Viewer extension parser.
"""

import json
from .base_parser import BaseParser


class HelloParser(BaseParser):
    """Parser for hello/reply messages."""
    
    PARSER_NAME = "hello"
    PARSER_PRIORITY = 50
    INPUT_MARKER = "$WAS_HELLO$"
    OUTPUT_MARKER = "$WAS_HELLO_OUTPUT$"
    
    @classmethod
    def detect_input(cls, content) -> bool:
        """Detect strings starting with 'Hello'."""
        return isinstance(content, str) and content.lower().startswith("hello")
    
    @classmethod
    def handle_input(cls, content, logger=None) -> dict:
        """Wrap the hello message for the frontend view."""
        data = {"message": content}
        
        return {
            "display_content": cls.INPUT_MARKER + json.dumps(data),
            "output_values": [content],
            "content_hash": f"hello_{hash(content) & 0xFFFFFFFF}",
        }
    
    @classmethod
    def detect_output(cls, content: str) -> bool:
        """Check for our output marker."""
        return isinstance(content, str) and content.startswith(cls.OUTPUT_MARKER)
    
    @classmethod
    def parse_output(cls, content: str, logger=None) -> dict:
        """Parse the reply from the frontend."""
        json_str = content[len(cls.OUTPUT_MARKER):]
        data = json.loads(json_str)
        reply = data.get("reply", "")
        
        return {
            "output_values": [reply],
            "display_text": f"Reply: {reply}",
            "content_hash": f"hello_out_{hash(reply) & 0xFFFFFFFF}",
        }
```

#### 2. View (`web/views/hello.js`)

```javascript
// Hello View - Minimal example of a ComfyUI_Viewer extension view.
import { BaseView, escapeHtml } from "./base_view.js";

class HelloView extends BaseView {
  static id = "hello";
  static displayName = "Hello";
  static isUI = false;
  static priority = 50;
  
  static INPUT_MARKER = "$WAS_HELLO$";
  static OUTPUT_MARKER = "$WAS_HELLO_OUTPUT$";

  static detect(content) {
    if (typeof content === "string" && content.startsWith(this.INPUT_MARKER)) {
      return 100;
    }
    return 0;
  }

  static getContentMarker() {
    return this.INPUT_MARKER;
  }

  static render(content, theme) {
    const jsonStr = content.slice(this.INPUT_MARKER.length);
    const data = JSON.parse(jsonStr);
    
    return `
      <div style="padding: 24px; font-family: sans-serif;">
        <h2 style="color: ${theme.fg};">Message Received:</h2>
        <p style="color: ${theme.fg}; font-size: 18px;">${escapeHtml(data.message)}</p>
        
        <h3 style="color: ${theme.fg}; margin-top: 24px;">Your Reply:</h3>
        <input type="text" id="reply-input" placeholder="Type your reply..." 
               style="width: 100%; padding: 8px; font-size: 16px;">
        <button id="send-btn" style="margin-top: 12px; padding: 8px 16px; 
                background: ${theme.accent}; color: white; border: none; cursor: pointer;">
          Send Reply
        </button>
      </div>
      <script>
        document.getElementById('send-btn').addEventListener('click', () => {
          const reply = document.getElementById('reply-input').value;
          window.parent.postMessage({
            type: 'hello-output',
            data: { reply: reply },
            nodeId: window.WAS_NODE_ID
          }, '*');
        });
      </script>
    `;
  }

  static getMessageTypes() {
    return ["hello-output"];
  }

  static handleMessage(messageType, data, node, app, iframeSource) {
    if (messageType !== "hello-output") return false;

    const outputString = this.OUTPUT_MARKER + JSON.stringify(data.data);
    
    const viewStateWidget = node.widgets?.find(w => w.name === "view_state");
    if (viewStateWidget) {
      const viewState = JSON.parse(viewStateWidget.value || "{}");
      viewState.hello_output = outputString;
      viewStateWidget.value = JSON.stringify(viewState);
      node.setDirtyCanvas?.(true, true);
      return true;
    }
    return false;
  }
}

export default HelloView;
```

#### 3. README (`README.md`)

```markdown
# ComfyUI_Viewer_Hello

A minimal "Hello World" extension for ComfyUI_Viewer demonstrating the extension system.

## Installation

1. Download this repository as a ZIP file
2. Place the ZIP in `ComfyUI/custom_nodes/ComfyUI_Viewer/extensions/`
3. Restart ComfyUI
4. Add `"hello.js"` to `web/views/view_manifest.js`

## Usage

1. Connect any string starting with "Hello" to the Content Viewer
2. Type a reply in the text field
3. Click "Send Reply" to output your reply from the node
```

#### How It Works

1. **Parser detects input**: `detect_input()` returns `True` for strings starting with "Hello"
2. **Parser wraps content**: `handle_input()` adds the `$WAS_HELLO$` marker so the view can detect it
3. **View renders UI**: `render()` displays the message and a reply input field
4. **User sends reply**: Button click sends `postMessage` to parent with type `hello-output`
5. **View handles message**: `handleMessage()` stores the reply in `view_state.hello_output`
6. **Parser parses output**: On next execution, `parse_output()` extracts the reply as the node's output

### Automatic View Registration

Extension views are **automatically discovered** by the view loader. When the installer extracts your view file to `web/views/`, it updates `extension_views.json` which the view loader reads at runtime. **No manual manifest registration is required.**

### Extension Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        ComfyUI                              │
├─────────────────────────────────────────────────────────────┤
│  Input Data          Backend Parser         Frontend View   │
│  (tensors, objects)  (Python)               (JavaScript)    │
│                                                             │
│       ──────────────►──────────────────────►                │
│                      │                      │               │
│                      ▼                      ▼               │
│               display_content          render()             │
└─────────────────────────────────────────────────────────────┘
```

- **Backend Parsers** (`modules/parsers/*_parser.py`) - Process Python objects (tensors, images, custom types) into JSON/strings for the frontend
- **Frontend Views** (`web/views/*.js`) - Detect content patterns and render HTML in the sandboxed iframe

---

## Adding a Frontend View

Frontend views handle content rendering in the browser. They detect content patterns and produce HTML.

### Quick Start

1. **Create your view file** in `web/views/`:

```javascript
// web/views/myview.js
import { BaseView, escapeHtml } from "./base_view.js";

class MyView extends BaseView {
  static id = "myview";           // Unique identifier
  static displayName = "My View"; // Shown in UI
  static priority = 50;           // Higher = checked first

  // Return score > 0 if this view should handle the content
  static detect(content) {
    if (content.includes("MY_SPECIAL_MARKER")) {
      return 100; // High confidence
    }
    return 0; // Cannot handle
  }

  // Render content to HTML for the iframe
  static render(content, theme) {
    return `<div style="color: ${theme.fg}; background: ${theme.bg};">
      <h1>My Custom View</h1>
      <pre>${escapeHtml(content)}</pre>
    </div>`;
  }

  // Optional: Add custom CSS
  static getStyles(theme) {
    return `
      body { padding: 16px; }
      h1 { color: ${theme.accent}; }
    `;
  }
}

export default MyView;
```

2. **Register in the manifest** - Add your file to `web/views/view_manifest.js`:

```javascript
export const VIEW_FILES = [
  "canvas.js",
  "html.js",
  // ... existing views ...
  "myview.js",  // Add your view here
];
```

3. **Restart ComfyUI** - Your view will be automatically loaded

### BaseView Interface

All views extend `BaseView` and can override these static properties and methods:

| Property/Method | Required | Description |
|-----------------|----------|-------------|
| `static id` | ✓ | Unique string identifier |
| `static displayName` | ✓ | Human-readable name for UI |
| `static priority` | ✓ | Detection priority (higher = checked first) |
| `static isUI` |  | Set to `true` for interactive UI views (hides Edit/Clear/Download buttons) |
| `static detect(content)` | ✓ | Return score (0-100+) for content matching |
| `static render(content, theme)` | ✓ | Return HTML string for iframe body |
| `static getStyles(theme)` |  | Return CSS string for iframe |
| `static getScripts()` |  | Return `<script>` tags for iframe |
| `static loadScripts(basePath)` |  | Async load external scripts |
| `static isReady()` |  | Return false if scripts still loading |
| `static getContentMarker()` |  | Return marker prefix (e.g., `$MY_VIEW$`) |
| `static getMessageTypes()` |  | Return array of postMessage types to handle |
| `static handleMessage(type, data, node, app, source)` |  | Handle iframe messages |
| `static getStateFromWidget(node)` |  | Extract saved state from node |
| `static injectState(content, state)` |  | Inject state into content before render |
| `static usesBaseStyles()` |  | Return false to skip base iframe CSS |

### Theme Tokens

The `theme` object passed to `render()` and `getStyles()` contains:

```javascript
{
  bg: "#1a1a1a",        // Background color
  fg: "#cccccc",        // Foreground text color
  border: "#333333",    // Border color
  accent: "#4a9eff",    // Accent/link color
  // ... additional tokens
}
```

### UI Views

Views that are interactive applications (rather than content displays) should set `static isUI = true`. This tells the Content Viewer to hide the **Edit**, **Clear**, and **Download** buttons in the controls bar, leaving only the **Fullscreen** button.

```javascript
class MyInteractiveApp extends BaseView {
  static id = "my_app";
  static displayName = "My App";
  static priority = 100;
  static isUI = true;  // Hides Edit/Clear/Download buttons
  
  // ... rest of implementation
}
```

**When to use `isUI = true`:**
- Interactive galleries or browsers (e.g., Image Search)
- Drawing/compositing tools (e.g., Canvas)
- Games or simulations
- Any view where editing the raw content doesn't make sense

**Built-in UI views:**
- `Canvas` - Infinite canvas image compositor
- `Image Search` (extension) - Interactive image gallery

---

## Adding a Backend Parser

Backend parsers process Python objects (tensors, custom types) into content the frontend can display. They are required when:

- Input data is **not a string** (e.g., IMAGE tensors, model objects)
- You need to **convert Python objects** to JSON/strings for the frontend view
- Your view needs to **output data back to the workflow** (e.g., Canvas outputs IMAGE tensors)

### Parser Discovery

Parsers are **auto-discovered** from `*_parser.py` files in `modules/parsers/`. Simply create a file ending in `_parser.py` and define a class extending `BaseParser`.

### Minimal Example: Dictionary Parser

This example shows a simple parser that handles Python dictionaries:

```python
# modules/parsers/dict_parser.py
"""Minimal parser example - handles Python dictionaries."""

import json
import hashlib
from .base_parser import BaseParser


class DictParser(BaseParser):
    """Parser for dictionary input."""
    
    PARSER_NAME = "dict"
    PARSER_PRIORITY = 50
    OUTPUT_MARKER = "$WAS_DICT$"
    
    @classmethod
    def detect_input(cls, content) -> bool:
        """Return True if content is a dictionary."""
        return isinstance(content, dict)
    
    @classmethod
    def handle_input(cls, content, logger=None) -> dict:
        """Convert dictionary to JSON for frontend display."""
        json_str = json.dumps(content, indent=2, default=str)
        content_hash = hashlib.md5(json_str.encode()).hexdigest()[:8]
        
        return {
            "display_content": cls.OUTPUT_MARKER + json_str,
            "output_values": [content],
            "content_hash": f"dict_{content_hash}",
        }
    
    @classmethod
    def detect_output(cls, content: str) -> bool:
        """Check if content has our marker."""
        return isinstance(content, str) and content.startswith(cls.OUTPUT_MARKER)
    
    @classmethod
    def parse_output(cls, content: str, logger=None) -> dict:
        """Parse JSON back to dictionary."""
        json_str = content[len(cls.OUTPUT_MARKER):]
        data = json.loads(json_str)
        
        return {
            "output_values": [data],
            "display_text": f"Dict with {len(data)} keys",
            "content_hash": f"dict_out_{hash(json_str[:50]) & 0xFFFFFFFF}",
        }
```

### BaseParser Interface Reference

| Method | Required | Description |
|--------|----------|-------------|
| `PARSER_NAME` | ✓ | Unique string identifier (should match frontend view id) |
| `PARSER_PRIORITY` | ✓ | Detection priority (higher = checked first) |
| `OUTPUT_MARKER` |  | String prefix for output content detection |
| `detect_input(content)` |  | Return `True` if parser handles this input type |
| `handle_input(content, logger)` |  | Process input, return `{display_content, output_values, content_hash}` |
| `detect_output(content)` |  | Return `True` if content has this parser's output marker |
| `parse_output(content, logger)` |  | Convert frontend output to backend types |
| `detect_state(state_data)` |  | Return `True` if parser handles this state data |
| `parse_state(state_data, logger)` |  | Parse view state from frontend |
| `detect_display_content(content)` |  | Return `True` if parser should prepare display content |
| `prepare_display(content, logger)` |  | Prepare content for display |
| `get_default_outputs(content, output_types, logger)` |  | Return default output values |

### Parser + View Integration

For a complete extension, you need both a backend parser and frontend view:

1. **Parser** (`modules/parsers/myext_parser.py`):
   - `detect_input()` → Returns `True` for your data type
   - `handle_input()` → Converts Python objects to JSON with marker prefix
   - `parse_output()` → Converts frontend data back to Python types (if needed)

2. **View** (`web/views/myext.js`):
   - `detect()` → Checks for marker prefix or content pattern
   - `render()` → Generates HTML from the JSON data
   - `handleMessage()` → Sends data back to backend (if needed)

**Marker Convention**: Use `$WAS_VIEWNAME$` prefix (e.g., `$WAS_AUDIO$`) so the frontend view can reliably detect content meant for it.

### Multi-View Detection

When multiple parsers return `True` from `detect_input()` for the same content, the system creates a **multi-view payload**:

```python
# Example: IMAGE tensor detected by both CanvasParser and ObjectParser
# Result: User sees a view switcher to toggle between Canvas and Object views
```

This allows users to choose how they want to visualize the data:
- **Canvas view** for compositing and editing
- **Object view** for inspecting tensor metrics and statistics

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
- Ensure images are in ComfyUI's input directory
- Search for a folder that looks like `was_viewer_032bb95c` where the last part is a unique hash for that node's canvas content
- Check for CORS errors in browser console

### Custom view not appearing
- Verify the file is listed in `view_manifest.js`
- Check for JavaScript errors in browser console
- Ensure `export default YourViewClass` is present

### Extension not installing
- Check `extensions/logs/` for installation logs
- Ensure zip file structure matches expected layout
- Verify file names follow naming conventions
