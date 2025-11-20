import panopti
import numpy as np

viewer = panopti.connect(server_url='http://localhost:8080', viewer_id='client')

# Create a simple mesh
vertices = np.array([
    [0, 0, 0],
    [1, 0, 0],
    [0.5, 1, 0],
], dtype=np.float32)

faces = np.array([
    [0, 1, 2]
], dtype=np.int32)

mesh = viewer.add_mesh(vertices, faces, name="Triangle")

# Create groups
basic_group = viewer.group("Basic Settings", collapsed=False)
advanced_group = viewer.group("Advanced Settings", collapsed=True)

# Add controls to basic group
viewer.slider(
    callback=lambda v, val: print(f"Scale: {val}"),
    name="Scale",
    min=0.1,
    max=5.0,
    initial=1.0,
    group=basic_group
)

viewer.checkbox(
    callback=lambda v, val: print(f"Visible: {val}"),
    name="Visible",
    initial=True,
    group=basic_group
)

# Add controls to advanced group
viewer.slider(
    callback=lambda v, val: print(f"Opacity: {val}"),
    name="Opacity",
    min=0.0,
    max=1.0,
    initial=1.0,
    group=advanced_group
)

viewer.dropdown(
    callback=lambda v, val: print(f"Mode: {val}"),
    name="Render Mode",
    options=["Solid", "Wireframe", "Points"],
    initial="Solid",
    group=advanced_group
)

# Add a control not in any group
viewer.button(
    callback=lambda v: print("Reset clicked!"),
    name="Reset All"
)

viewer.hold()
