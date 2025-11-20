"""
Simple example to test the ImageGallery UI control.
"""

import numpy as np
import panopti as pn
from PIL import Image
import requests
from io import BytesIO

# Create a viewer
viewer = pn.connect(server_url='http://localhost:8080', viewer_id='client')

# Download some example images from the web
print("Downloading example images...")
image_urls = [
    "https://picsum.photos/200/200?random=1",
    "https://picsum.photos/200/200?random=2",
    "https://picsum.photos/200/200?random=3",
    "https://picsum.photos/200/200?random=4",
    "https://picsum.photos/200/200?random=5",
    "https://picsum.photos/200/200?random=6",
    "https://picsum.photos/200/200?random=7",
    "https://picsum.photos/200/200?random=8",
    "https://picsum.photos/200/200?random=9",
    "https://picsum.photos/200/200?random=10",
    "https://picsum.photos/200/200?random=11",
    "https://picsum.photos/200/200?random=12",
]

images = []
for i, url in enumerate(image_urls):
    try:
        response = requests.get(url, timeout=5)
        img = Image.open(BytesIO(response.content))
        # Convert to numpy array
        img_array = np.array(img)
        images.append(img_array)
        print(f"Downloaded image {i+1}/{len(image_urls)}")
    except Exception as e:
        print(f"Failed to download image {i+1}: {e}")
        # Create a fallback colored image
        fallback = np.zeros((200, 200, 3), dtype=np.uint8)
        fallback[:, :] = [(i * 20) % 255, (i * 40) % 255, (i * 60) % 255]
        images.append(fallback)

print(f"Total images loaded: {len(images)}")

# Add gallery with callback and pagination
def on_image_click(viewer, index):
    print(f"Clicked image {index}")

print("Adding paginated image gallery...")
gallery = viewer.add_image_gallery(
    "test_gallery",
    images,
    thumbnail_size=120,
    columns=2,
    rows_per_page=2,  # Show 4 images per page (2 columns x 2 rows)
    callback=on_image_click
)
print(f"Gallery added: {gallery}")
print(f"Gallery has {len(gallery.images)} images")
print(f"Showing {gallery.columns * gallery.rows_per_page} images per page")

viewer.hold()
