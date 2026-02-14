---
name: label-printer
description: Print text labels on Brother QL-820NWB via network.
---

# Label Printer Skill

Control the Brother QL-820NWB label printer to print text labels.

## Requirements
- `brother_ql` (Python package)
- Networked Brother QL-820NWB printer

## Configuration
- **Printer IP:** TO_BE_CONFIGURED (User will provide once installed)
- **Model:** QL-820NWB
- **Label Size:** DK-2205 (62mm continuous) is the standard default.

## Usage

```bash
# Print a simple text label
skills/label-printer/venv/bin/python3 skills/label-printer/printer.py --text "Bits box: M3 Screws" --ip 192.168.1.50
```

## Setup
1.  Install dependencies: `skills/label-printer/venv/bin/pip install brother_ql`
2.  Connect printer to network (Ethernet/Wi-Fi).
3.  Update `config.json` with Printer IP.
