import pypdf
import os

files = [
    "AJ Herrild 1.7.26.pdf",
    "AJ Herrild 1.14.26.pdf",
    "AJ Herrild 1.21.26.pdf",
    "AJ Herrild 1.28.26.pdf",
    "AJ Herrild 2.5.26.pdf",
    "AJ Herrild Superbills 2025.pdf",
    "AJ Herrild 2025 Statement.pdf",
    "J. Herrild 2.3.26 Superbill.pdf"
]

for file in files:
    path = os.path.join(".temp_zip_extract", file)
    print(f"--- {file} ---")
    try:
        reader = pypdf.PdfReader(path)
        text = ""
        for i in range(min(2, len(reader.pages))):
            text += reader.pages[i].extract_text()
        print(text[:1000]) # Print first 1000 chars
    except Exception as e:
        print(f"Error reading {file}: {e}")
