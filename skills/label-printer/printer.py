import argparse
import sys
from brother_ql.conversion import convert
from brother_ql.backends.helpers import send
from brother_ql.raster import BrotherQLRaster

def print_label(text, ip_address, model='QL-820NWB', red=False, label_size='62'):
    """
    Print a label on the Brother QL-820NWB printer.
    """
    try:
        qlr = BrotherQLRaster(model)
        qlr.exception_on_warning = True

        # Generate label image (simplified for now)
        # In a real implementation, we'd use PIL or similar to create an image with text/QR
        # For now, just print a simple text line using brother_ql's built-in conversion if possible,
        # or error out saying image generation is needed.
        
        # brother_ql.conversion.convert requires an image input.
        # So we need PIL (Pillow) to generate an image from text first.
        from PIL import Image, ImageDraw, ImageFont

        # Create a simple image with text
        img = Image.new('RGB', (696, 200), color='white') # Example size
        d = ImageDraw.Draw(img)
        
        # Use a default font if possible, or try to load one
        try:
            font = ImageFont.truetype("DejaVuSans-Bold.ttf", 40)
        except IOError:
             font = ImageFont.load_default()

        d.text((10, 10), text, fill='black', font=font)
        
        # Convert image to printer instructions
        instructions = convert(
            qlr=qlr, 
            images=[img], 
            label=label_size, 
            rotate='0', 
            threshold=70.0, 
            dither=False, 
            compress=False, 
            red=red
        )

        # Send instructions to printer
        send(instructions=instructions, printer_identifier=f'tcp://{ip_address}')
        print(f"Successfully sent label '{text}' to {ip_address}")

    except Exception as e:
        print(f"Error printing label: {e}")
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Print a label on Brother QL-820NWB')
    parser.add_argument('--text', type=str, required=True, help='Text to print on label')
    parser.add_argument('--ip', type=str, required=True, help='Printer IP address (e.g., 192.168.1.50)')
    parser.add_argument('--model', type=str, default='QL-820NWB', help='Printer model')
    parser.add_argument('--red', action='store_true', help='Print in red (if supported media)')
    parser.add_argument('--size', type=str, default='62', help='Label size (e.g., 62 for DK-2205)')
    
    args = parser.parse_args()
    print_label(args.text, args.ip, args.model, args.red, args.size)
