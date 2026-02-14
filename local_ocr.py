import base64
import json
import urllib.request

image_path = "/home/jherrild/.openclaw/media/inbound/file_36---6beabfd8-8937-4f12-b2a6-b7db3d98d309.jpg"
with open(image_path, "rb") as image_file:
    encoded_string = base64.b64encode(image_file.read()).decode('utf-8')

payload = {
    "model": "richardyoung/olmocr2:7b-q8",
    "prompt": "Extract all text from this image precisely, including tables and headers.",
    "images": [encoded_string],
    "stream": False
}

data = json.dumps(payload).encode('utf-8')
req = urllib.request.Request("http://localhost:11434/api/generate", data=data)
req.add_header('Content-Type', 'application/json')

try:
    with urllib.request.urlopen(req) as response:
        result = json.loads(response.read().decode('utf-8'))
        print(result.get('response', 'Error: No response'))
except Exception as e:
    print(f"Error: {e}")
