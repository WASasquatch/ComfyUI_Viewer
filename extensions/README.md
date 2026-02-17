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

### Simple Frontend Views (JavaScript + Parser)
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

### Embedded Web Applications (Full React/Vue/Svelte Apps)
- [Embedding Full Web Applications](#embedding-full-web-applications)
  - [Architecture Overview](#architecture-overview)
  - [API Route Registration](#1-api-route-registration-python)
  - [Frontend View Wrapper](#2-frontend-view-javascript)
  - [PostMessage Communication](#3-communication-pattern-postmessage)
  - [Theme Integration](#4-theme-integration)
  - [Parser Integration](#5-parser-integration)
  - [Complete Example: OpenReel](#complete-example-openreel-extension)
  - [Best Practices](#best-practices)
  - [Deployment](#deployment)

### General
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

## Embedding Full Web Applications

For complex interactive tools that require a full web framework (React, Vue, Svelte, etc.), you can serve a complete web application from your extension using the `/app` functionality. This approach allows you to embed sophisticated applications (video editors, image galleries, drawing tools, etc.) directly into ComfyUI_Viewer.

### Architecture Overview

```
Extension Package/
├── apps/
│   └── my_app/              # Built web app (HTML/JS/CSS)
│       ├── index.html
│       ├── assets/
│       │   ├── index-abc123.js
│       │   └── index-def456.css
│       └── ...
├── routes/
│   └── my_app_routes.py     # API routes to serve the app
├── nodes/
│   └── my_app_nodes.py      # ComfyUI nodes (optional)
├── modules/
│   └── parsers/
│       └── my_app_parser.py # Handles input/output data flow
└── web/
    └── views/
        └── my_app.js        # Minimal view that creates iframe
```

### Key Components

#### 1. API Route Registration (Python)

Create a routes file to register API endpoints for serving your built app:

```python
# routes/my_app_routes.py
from aiohttp import web
from server import PromptServer
import os
import mimetypes
import logging

logger = logging.getLogger("WAS.MyApp.Routes")

def _get_my_app_dir():
    """Get path to the built app static files."""
    return os.path.join(os.path.dirname(__file__), "..", "apps", "my_app")

@PromptServer.instance.routes.get('/was/my_app/app/{path:.*}')
async def serve_my_app(request):
    """Serve the built app static files."""
    path = request.match_info.get('path', 'index.html')
    if not path:
        path = 'index.html'
    
    app_dir = _get_my_app_dir()
    file_path = os.path.join(app_dir, path)
    
    # Security: Prevent path traversal
    real_app_dir = os.path.realpath(app_dir)
    real_file_path = os.path.realpath(file_path)
    if not real_file_path.startswith(real_app_dir):
        return web.json_response({'error': 'Access denied'}, status=403)
    
    if not os.path.exists(real_file_path) or not os.path.isfile(real_file_path):
        return web.json_response({'error': 'File not found'}, status=404)
    
    # Determine content type
    content_type, _ = mimetypes.guess_type(real_file_path)
    if content_type is None:
        content_type = 'application/octet-stream'
    
    # Ensure correct MIME types for web assets
    if real_file_path.endswith('.js'):
        content_type = 'application/javascript'
    elif real_file_path.endswith('.css'):
        content_type = 'text/css'
    
    with open(real_file_path, 'rb') as f:
        data = f.read()
    
    return web.Response(
        body=data,
        content_type=content_type,
        headers={'Content-Length': str(len(data))}
    )

logger.info("[My App] API routes registered")
```

**Important Notes:**
- Routes are automatically discovered and loaded from the `routes/` directory at ComfyUI startup
- The `routes/` directory is separate from `nodes/` to keep API endpoints organized
- `nodes/` is only for ComfyUI nodes that appear in the graph

If your app uses a bundler (Vite, Webpack, etc.), configure the **base path** to match your API route:

```javascript
// vite.config.ts
export default {
  base: '/was/my_app/app/',  // Must match your API route
  // ...
}
```

This ensures all asset paths (JS, CSS, images) resolve correctly when served from ComfyUI.

#### 2. Frontend View (JavaScript)

Create a minimal view that embeds your app in an iframe:

```javascript
// web/views/my_app.js
import { BaseView } from "./base_view.js";

class MyAppView extends BaseView {
  static id = "my_app";
  static displayName = "My App";
  static priority = 100;
  static isUI = true;  // Hide Edit/Clear/Download buttons
  
  static INPUT_MARKER = "$WAS_MY_APP$";
  static OUTPUT_MARKER = "$WAS_MY_APP_OUTPUT$";

  static detect(content) {
    if (typeof content === "string" && content.startsWith(this.INPUT_MARKER)) {
      return 100;
    }
    return 0;
  }

  static getContentMarker() {
    return this.INPUT_MARKER;
  }

  /**
   * Build the app URL with embedding params and theme
   */
  static _buildAppUrl(theme) {
    const origin = window.location.origin;
    const params = new URLSearchParams({ embedded: 'true' });
    
    // Pass ComfyUI theme to the app
    if (theme) {
      if (theme.bg) params.set('theme_bg', theme.bg);
      if (theme.fg) params.set('theme_fg', theme.fg);
      if (theme.accent) params.set('theme_accent', theme.accent);
      // ... add more theme tokens as needed
    }
    
    return `${origin}/was/my_app/app/index.html?${params.toString()}`;
  }

  static render(content, theme) {
    const appUrl = this._buildAppUrl(theme);
    
    return `
      <div style="width: 100%; height: 100%; position: relative;">
        <iframe
          id="my-app-iframe"
          src="${appUrl}"
          style="width: 100%; height: 100%; border: none;"
          allow="clipboard-write"
        ></iframe>
      </div>
    `;
  }

  static usesBaseStyles() {
    return false;  // App provides its own styles
  }

  /**
   * Handle messages from the embedded app
   */
  static getMessageTypes() {
    return ["my-app-output"];
  }

  static handleMessage(messageType, data, node, app, iframeSource) {
    if (messageType !== "my-app-output") return false;

    const outputString = this.OUTPUT_MARKER + JSON.stringify(data);
    
    const viewStateWidget = node.widgets?.find(w => w.name === "view_state");
    if (viewStateWidget) {
      const viewState = JSON.parse(viewStateWidget.value || "{}");
      viewState.my_app_output = outputString;
      viewStateWidget.value = JSON.stringify(viewState);
      node.setDirtyCanvas?.(true, true);
      return true;
    }
    return false;
  }
}

export default MyAppView;
```

#### 3. Communication Pattern (PostMessage)

Your embedded app communicates with ComfyUI using the PostMessage API:

**Sending data to ComfyUI:**
```javascript
// Inside your React/Vue/etc app
window.parent.postMessage({
  type: 'my-app-output',
  data: { result: 'some data' }
}, '*');
```

**Receiving data from ComfyUI:**
```javascript
// Inside your React/Vue/etc app
useEffect(() => {
  const handleMessage = (event: MessageEvent) => {
    if (event.data.type === 'comfyui-import-data') {
      // Handle data from ComfyUI workflow
      const data = event.data.data;
      // Update your app state...
    }
  };
  
  window.addEventListener('message', handleMessage);
  return () => window.removeEventListener('message', handleMessage);
}, []);

// Notify parent that app is ready
useEffect(() => {
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'my-app-ready' }, '*');
  }
}, []);
```

#### 4. Theme Integration

To match ComfyUI's theme, parse the URL parameters in your app:

```javascript
// Inside your React/Vue/etc app
const params = new URLSearchParams(window.location.search);
const isEmbedded = params.get('embedded') === 'true';

if (isEmbedded) {
  // Apply ComfyUI theme
  const themeBg = params.get('theme_bg') || '#1a1a1a';
  const themeFg = params.get('theme_fg') || '#cccccc';
  const themeAccent = params.get('theme_accent') || '#4a9eff';
  
  // Set CSS variables or update your theme store
  document.documentElement.style.setProperty('--bg-color', themeBg);
  document.documentElement.style.setProperty('--text-color', themeFg);
  document.documentElement.style.setProperty('--accent-color', themeAccent);
}
```

#### 5. Parser Integration

Your parser handles the data flow between ComfyUI nodes and your app:

```python
# modules/parsers/my_app_parser.py
import json
from .base_parser import BaseParser

class MyAppParser(BaseParser):
    PARSER_NAME = "my_app"
    PARSER_PRIORITY = 100
    INPUT_MARKER = "$WAS_MY_APP$"
    OUTPUT_MARKER = "$WAS_MY_APP_OUTPUT$"
    
    @classmethod
    def detect_input(cls, content) -> bool:
        # Detect your input data type
        return isinstance(content, str) and content.startswith("MY_APP_DATA:")
    
    @classmethod
    def handle_input(cls, content, logger=None) -> dict:
        # Prepare data for the app
        data = {"input": content}
        return {
            "display_content": cls.INPUT_MARKER + json.dumps(data),
            "output_values": [content],
            "content_hash": f"my_app_{hash(content) & 0xFFFFFFFF}",
        }
    
    @classmethod
    def detect_output(cls, content: str) -> bool:
        return isinstance(content, str) and content.startswith(cls.OUTPUT_MARKER)
    
    @classmethod
    def parse_output(cls, content: str, logger=None) -> dict:
        # Parse output from the app
        json_str = content[len(cls.OUTPUT_MARKER):]
        data = json.loads(json_str)
        result = data.get("result", "")
        
        return {
            "output_values": [result],
            "display_text": f"Result: {result}",
            "content_hash": f"my_app_out_{hash(result) & 0xFFFFFFFF}",
        }
```

### Complete Workflow: Building and Deploying Your App

#### Step 1: Develop Your Web Application

Build your application using your preferred framework (React, Vue, Svelte, etc.):

```bash
# Example with Vite + React
npm create vite@latest my-app -- --template react
cd my-app
npm install

# Configure base path in vite.config.ts
export default {
  base: '/was/my_app/app/',  // Must match your API route
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  }
}

# Build for production
npm run build
```

Your `dist/` folder will contain:
```
dist/
├── index.html
├── assets/
│   ├── index-abc123.js
│   ├── index-def456.css
│   └── ...
└── ...
```

#### Step 2: Create Your Extension Package

Create the extension folder structure:

```
ComfyUI_Viewer_MyApp_Extension/
├── apps/
│   └── my_app/              # Copy your built app here
│       ├── index.html
│       └── assets/
├── nodes/
│   └── my_app_nodes.py      # API routes + ComfyUI nodes
├── modules/
│   └── parsers/
│       └── my_app_parser.py # Input/output handling
├── web/
│   └── views/
│       └── my_app.js        # Iframe wrapper view
└── README.md
```

**Copy your built app:**
```bash
cp -r my-app/dist/* ComfyUI_Viewer_MyApp_Extension/apps/my_app/
```

#### Step 3: Create ComfyUI Nodes (Optional)

Add custom nodes to generate input data for your app:

```python
# nodes/my_app_nodes.py
from aiohttp import web
from server import PromptServer
import os
import mimetypes

# ... (API route code from section 1 above)

# Optional: Add ComfyUI nodes
class MyAppInputNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "data": ("STRING", {"default": ""}),
            }
        }
    
    RETURN_TYPES = ("STRING",)
    FUNCTION = "process"
    CATEGORY = "WAS/View"
    
    def process(self, data):
        # Prepare data for your app
        return (f"MY_APP_DATA:{data}",)

NODE_CLASS_MAPPINGS = {
    "CV My App Input": MyAppInputNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CV My App Input": "CV My App Input",
}
```

#### Step 4: Test Locally

1. **Copy extension to ComfyUI:**
   ```bash
   cp -r ComfyUI_Viewer_MyApp_Extension ComfyUI/custom_nodes/ComfyUI_Viewer/extensions/
   ```

2. **Restart ComfyUI** - The extension installer will:
   - Copy files to correct locations
   - Register your nodes
   - Make your app available at `/was/my_app/app/`

3. **Test in workflow:**
   - Add your input node (if created)
   - Connect to Content Viewer
   - Run workflow - your app should load in the viewer

#### Step 5: Package for Distribution

Create a GitHub repository with your extension:

```bash
cd ComfyUI_Viewer_MyApp_Extension
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YourUsername/ComfyUI_Viewer_MyApp_Extension
git push -u origin main
```

**Users install by:**
1. Downloading ZIP from GitHub
2. Placing in `ComfyUI/custom_nodes/ComfyUI_Viewer/extensions/`
3. Restarting ComfyUI

#### Step 6: Update Your App

When you update your app:

```bash
# Rebuild your app
cd my-app
npm run build

# Copy to extension
cp -r dist/* ../ComfyUI_Viewer_MyApp_Extension/apps/my_app/

# Commit and push
cd ../ComfyUI_Viewer_MyApp_Extension
git add apps/my_app/
git commit -m "Update app to v1.1"
git push
```

Users get updates by re-downloading the ZIP and replacing their installation.

### Best Practices

1. **Security**: Always validate and sanitize paths in API routes to prevent path traversal attacks
2. **MIME Types**: Ensure correct Content-Type headers for JS/CSS/WASM files
3. **Base Path**: Configure your bundler's base path to match your API route
4. **Theme Sync**: Pass ComfyUI theme via URL params for seamless integration
5. **Embedded Detection**: Use `?embedded=true` to conditionally show/hide UI elements
6. **PostMessage**: Use typed messages with clear naming conventions (e.g., `my-app-output`)
7. **State Persistence**: Store output in `view_state` widget for workflow persistence
8. **Error Handling**: Gracefully handle iframe load failures and communication errors

### Deployment

When distributing your extension:

1. **Build your app** using your bundler (Vite, Webpack, etc.)
2. **Copy built files** to `apps/my_app/` in your extension package
3. **Include in zip** - Users download and extract to `ComfyUI_Viewer/extensions/`
4. **Auto-install** - Extension installer copies files to correct locations

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
