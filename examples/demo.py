import panopti
import trimesh
import numpy as np

from panopti.materials import MaterialPresets

viewer = panopti.connect(server_url='http://localhost:8080', viewer_id='client')
viewer.capture_prints(capture_stderr=True)

mesh = trimesh.load('./examples/demosthenes.obj')
verts, faces = mesh.vertices, mesh.faces

# Add mesh to viewer with a custom material:
material = MaterialPresets.plastic
material.color = (0.8, 0.2, 0.2)
material.roughness = 0.2

viewer.add_mesh(
    name='Statue',
    vertices=verts,
    faces=faces,
    material=material
)

# Add a color picker that adjusts the material color:
def callback_color_picker(viewer, rgba):
    mesh = viewer.get('Statue')
    mat = mesh.material
    mat.color = rgba[:3]
    mat.opacity = rgba[3]
    mat.transparency = mat.opacity < 1.0
    mesh.update(material=mat) # send update to server

viewer.color_picker(callback=callback_color_picker, name='Statue Color', initial=material.color)

# When gizmo is used, update the mesh's RGB color:
@viewer.events.gizmo()
def callback_gizmo(viewer, gizmo):
    pos = gizmo.trans.position
    mesh = viewer.get('Statue')
    mat = mesh.material

    # Map position to RGB and update material:
    col = np.abs(pos) / 2.0
    rgb = np.clip(col, 0.0, 1.0)
    mat.color = rgb
    mesh.update(material=mat)

# Add a button that adds vertex colors to the mesh:
def callback_button_vertex_colors(viewer):
    mesh = viewer.get('Statue')
    mat = mesh.material
    
    # first get the current color:
    col = mat.color

    # add vertex colors as a ramp from `col` to color_picker's color:
    y = mesh.viewer_verts[:, 1] # get y-coordinates of transformed mesh
    # normalize y to [0, 1] and map y to color picker color
    y = (y - y.min()) / (y.max() - y.min())
    vert_colors = np.array([col[0], col[1], col[2]])
    vert_colors = y[:, np.newaxis] * vert_colors

    # set material color to white, so it doesn't blend with vertex colors:
    mat.color = (1.0, 1.0, 1.0)

    mesh.update(vertex_colors=vert_colors, material=mat)

viewer.button(callback=callback_button_vertex_colors, name='Add Vertex Colors')

@viewer.events.camera(throttle=500)
def callback_camera(viewer, camera):
    print(camera)

@viewer.events.inspect()
def callback_inspect(viewer, inspect):
    print(inspect)

# New: on-hover event (throttled)
@viewer.events.hover(throttle=100)
def callback_hover(viewer, info):
    # Print hovered object name and pixel coordinates
    try:
        print(f"hover: {info.object_name} at {tuple(info.screen_coords)}")
    except Exception:
        # In case dataclass conversion isn't available, fall back to dict
        if isinstance(info, dict):
            print(f"hover: {info.get('object_name')} at {tuple(info.get('screen_coords', []))}")
        else:
            print('hover event received')

viewer.hold() # prevent the script from terminating