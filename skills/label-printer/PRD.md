# PRD: Label Printer Skill (Brother QL-820NWB)

## 1. Overview
A specialized skill to control the networked Brother QL-820NWB label printer. The goal is to allow the agent to print labels instantly from natural language requests ("Label these bins: M3, M4, M5") without user intervention.

## 2. Hardware
- **Model:** Brother QL-820NWB (Networked).
- **Media:** DK-2205 (62mm Continuous Tape) is the primary target.
- **Connection:** TCP/IP (Socket 9100) via Local Network.

## 3. Core Features

### 3.1. Rendering Presets
Consistency is the priority. The renderer (`renderer.py`) will implement strict typographic rules based on the selected mode.

#### A. `width` (Default / Bin Mode)
- **Orientation:** Rotated 90° (Text runs across the 62mm width of the tape).
- **Cut Length:** Dynamic based on line count, but minimized to save tape (e.g., ~12mm per line + padding).
- **Font Size:** **Fixed.** (e.g., 40pt). Do NOT scale up/down to fill space.
- **Wrapping:**
  - If text exceeds the printable width (approx 58mm), **wrap to a new line**.
  - **Center** all lines horizontally and vertically.
  - Do NOT auto-scale font size unless explicitly requested.
- **Use Case:** Small component bins, cable flags, high-density storage.

#### B. `length` (Signage Mode)
- **Orientation:** Landscape (Text runs along the length of the tape).
- **Cut Length:** Dynamic based on text length (min 25mm).
- **Font Size:** **Large** (e.g., 90pt). Maximize visibility.
- **Wrapping:**
  - If text is too long (e.g., > 10 chars), **scale down the font** to fit on one line (primary strategy).
  - If scaled font becomes too small (< 40pt), **wrap to a second line** and use a medium font size.
- **Use Case:** Box labels, shelf labels, mailing addresses, warning signs.

### 3.2. Core Functions
- **Function:** `print_label(text: str, preset: str = "width", count: int = 1)`
- **Behavior:**
  - Iterates through a list of strings.
  - Sends them as a continuous job to the printer (to avoid stuttering).
  - Cuts between each label.

### 3.3. Smart Formatting (Future)
- **QR Codes:** `print_qr(data: str, label_text: str)` for inventory/links.
- **Images:** Ability to print simple dithered images (monochrome).
- **Red Printing:** Support for Black/Red printing on DK-2251 tape (if loaded).

## 4. Technical Architecture

### 4.1. Dependencies
- **Language:** Python 3.x
- **Libraries:**
  - `brother_ql`: Driver logic (Raster generation).
  - `Pillow` (PIL): Image generation (rendering text to pixels).
  - `click` or `argparse`: CLI interface.

### 4.2. File Structure
```text
skills/label-printer/
├── venv/                 # Isolated Python environment
├── src/
│   ├── printer.py        # Core class (BrotherQL wrapper)
│   ├── renderer.py       # PIL logic (Text -> Image)
│   └── cli.py            # CLI entry point
├── config.json           # IP address, default tape size
└── SKILL.md              # Documentation
```

### 4.3. Configuration (`config.json`)
```json
{
  "ip": "192.168.1.xxx",
  "model": "QL-820NWB",
  "tape": "62",
  "font": "DejaVuSans-Bold.ttf"
}
```

## 5. Tool Definition (OpenClaw)
The skill should expose a high-level tool to the agent:

```json
{
  "name": "print_label",
  "description": "Print physical labels on the Brother QL-820NWB. Supports single or batch printing.",
  "parameters": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string",
        "description": "Text to print. Use \\n for newlines."
      },
      "batch": {
        "type": "array",
        "items": { "type": "string" },
        "description": "List of labels to print (if multiple)."
      },
      "count": {
        "type": "integer",
        "description": "Number of copies (default 1)."
      }
    }
  }
}
```

## 6. Implementation Plan
1.  **Refine Renderer:** Create a robust PIL script that auto-fits text size to the 62mm width (avoiding truncation).
2.  **Network Test:** Verify TCP socket connection to printer IP.
3.  **CLI Wrapper:** Build `cli.py` to handle arguments and JSON config.
4.  **Integration:** Add tool definition to `openclaw.json` (or `SKILL.md` for manual invocation).
