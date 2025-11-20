# panopti/viewer.py
import threading
import atexit
import numpy as np
import time
import uuid
from typing import Dict, Any, Callable, Optional, Tuple, List, Union
import os
import sys
import eventlet
from eventlet import event
import io

from .server.app import create_app
from .comms.websocket import SocketManager, RemoteSocketIO
from .events import EventDispatcher
from .objects.mesh import Mesh
from .objects.animated_mesh import AnimatedMesh
from .objects.points import Points
from .objects.arrows import Arrows

from .ui.controls import Slider, Button, Label, Checkbox, Dropdown, DownloadButton, PlotlyPlot, ColorPicker, Group, ImageGallery
from .utils.parse import as_array, as_list

# Default camera parameters used when a new frontend client connects.
DEFAULT_CAMERA_STATE = {
    'projection_mode': 'perspective',
    'fov': 50,
    'near': 0.1,
    'far': 1000,
}

class BaseViewer:
    """Base class for both standalone and client viewers"""
    def __init__(self):
        self.objects = {}
        self.ui_controls = {}
        self.socket_manager = SocketManager(self)
        self.events = EventDispatcher(self)
        self._camera_thread = threading.Event()
        self._camera_data = None
        self._selected_object_thread = threading.Event()
        self._selected_object = None
        self._print_buffer = io.StringIO()  # Always present from the start

    def capture_prints(self, buffer=None, capture_stderr=False):
        """Mirrors prints in the viewer."""
        from .utils.print_capture import capture_prints as cap
        # Always use the persistent buffer
        buf = cap(buffer=self._print_buffer, capture_stderr=capture_stderr, callback=self._emit_console_callback())
        return buf

    def _emit_console_callback(self):
        def _callback(segments):
            self.socket_manager.emit_console_output(segments)
        return _callback

    def print_colored(self, text: str, color: str = None, end: str = '\n'):
        """Print colored text directly to the viewer console.

        Parameters:
            text (str): The text to print
            color (str): Optional color name: white, red, green, yellow, blue, magenta,
                   bright-red, bright-green, bright-yellow, bright-blue, bright-magenta
            end (str): The end character to print (default is `\\n`)
        """
        text += end
        segments = [{'text': text, 'color': color}]
        self.socket_manager.emit_console_output(segments)

    def hold(self):
        """Keep the script alive"""
        evt = event.Event()
        try:
            evt.wait()            # blocks until someone calls evt.send()
        except KeyboardInterrupt:
            print("Exiting...")

    def restart(self):
        """Restart the current Python process."""
        module = getattr(sys.modules['__main__'], '__spec__', None)
        module = module.name if module and module.name else None

        if module:
            args = [sys.executable, '-m', module] + sys.argv[1:]
        else:
            args = [sys.executable] + sys.argv

        os.execv(sys.executable, args)

    def _add_control(self, cls, group=None, **kwargs):
        """Create a UI control and register it with the server."""
        control = cls(viewer=self, **kwargs)
        self.ui_controls[control.name] = control

        # If a group is specified, add this control to it
        if group is not None:
            if isinstance(group, Group):
                group.add_control(control)
            elif isinstance(group, str):
                # Look up group by name
                grp = self.ui_controls.get(group)
                if grp and isinstance(grp, Group):
                    grp.add_control(control)

        self.socket_manager.emit_add_control(control)
        return control

    def add_mesh(self,
                vertices: np.ndarray,
                faces: np.ndarray,
                name: str,
                visible: bool = True,
                position: Union[Tuple[float, float, float], np.ndarray] = (0, 0, 0),
                rotation: Union[Tuple[float, float, float], np.ndarray] = (0, 0, 0),
                scale: Union[Tuple[float, float, float], np.ndarray] = (1.0, 1.0, 1.0),
                vertex_colors: np.ndarray = None,
                face_colors: np.ndarray = None,
                material: Optional[Any] = None) -> Mesh:
        """Adds a Mesh object to the viewer.

        Parameters:
            vertices: (V, 3) array of vertex coordinates.
            faces: (F, 3) array of face indices.
            name: Name for the mesh.
            visible: Whether the mesh is visible.
            position: Position of the mesh (XYZ).
            rotation: Rotation of the mesh (XYZ).
            scale: Scale of the mesh in (XYZ).
            vertex_colors: (V, 3) array of vertex colors.
            face_colors: (F, 3) array of face colors.
            material: Panopti material object.

        Returns:
            Mesh: The created panopti mesh object.
        """
        if name is None:
            name = f"mesh_{uuid.uuid4().hex[:8]}"

        mesh = Mesh(
            viewer=self,
            vertices=vertices,
            faces=faces,
            name=name,
            visible=visible,
            position=position,
            rotation=rotation,
            scale=scale,
            vertex_colors=vertex_colors,
            face_colors=face_colors,
            material=material
        )

        self.objects[name] = mesh
        self.socket_manager.emit_add_geometry(mesh)

        return mesh

    def add_animated_mesh(self,
                         vertices: np.ndarray,
                         faces: np.ndarray,
                         name: str, framerate: float = 24.0,
                         visible: bool = True,
                         position: Union[Tuple[float, float, float], np.ndarray] = (0, 0, 0),
                         rotation: Union[Tuple[float, float, float], np.ndarray] = (0, 0, 0),
                         scale: Union[Tuple[float, float, float], np.ndarray] = (1.0, 1.0, 1.0),
                         color: Union[Tuple[float, float, float], np.ndarray] = (1.0, 1.0, 1.0),
                         vertex_colors: np.ndarray = None,
                         face_colors: np.ndarray = None,
                         material: Optional[Any] = None) -> AnimatedMesh:
        """Adds an AnimatedMesh object to the viewer.

        Parameters:
            vertices: (T, V, 3) array of vertex coordinates for each frame.
            faces: (F, 3) array of face indices.
            name: Name for the animated mesh.
            framerate: Framerate for the animation.
            visible: Whether the mesh is visible.
            position: Position of the mesh (XYZ).
            rotation: Rotation of the mesh (XYZ).
            scale: Scale of the mesh in (XYZ).
            color: Uniform RGB color of the mesh.
            vertex_colors: (V, 3) array of vertex colors.
            face_colors: (F, 3) array of face colors.
            material: Panopti material object.

        Returns:
            AnimatedMesh: The created panopti animated mesh object.
        """

        if name is None:
            name = f"animated_mesh_{uuid.uuid4().hex[:8]}"

        animated_mesh = AnimatedMesh(
            viewer=self,
            vertices=vertices,
            faces=faces,
            name=name,
            framerate=framerate,
            visible=visible,
            position=position,
            rotation=rotation,
            scale=scale,
            color=color,
            vertex_colors=vertex_colors,
            face_colors=face_colors,
            material=material
        )

        self.objects[name] = animated_mesh
        self.socket_manager.emit_add_geometry(animated_mesh)

        return animated_mesh

    def add_points(self,
                   points: np.ndarray,
                   name: str,
                   colors: Union[Tuple[float, float, float], np.ndarray] = (0.5, 0.5, 0.5),
                   size: float = 0.01,
                   visible: bool = True,
                   opacity: float = 1.0) -> Points:
        """Adds a Point Cloud object to the viewer.

        Parameters:
            points: (N, 3) array of point coordinates.
            name: Name for the points object.
            colors: (N, 3) or (3,) array of RGB colors for the points.
            size: Size of the points.
            visible: Whether the points are visible.
            opacity: Opacity of the points.

        Returns:
            Points: The created panopti points object.
        """
        if name is None:
            name = f"points_{uuid.uuid4().hex[:8]}"

        points_obj = Points(
            viewer=self,
            points=points,
            name=name,
            colors=colors,
            size=size,
            visible=visible,
            opacity=opacity
        )

        self.objects[name] = points_obj
        self.socket_manager.emit_add_geometry(points_obj)

        return points_obj

    def add_arrows(self,
                   starts: np.ndarray,
                   ends: np.ndarray,
                   name: str,
                   color: Union[Tuple[float, float, float], np.ndarray] = (0, 0, 0),
                   width: float = 0.01,
                   visible: bool = True,
                   opacity: float = 1.0) -> Arrows:
        """Adds an Arrows object to the viewer.

        Parameters:
            starts: (N, 3) array of start points for the arrows.
            ends: (N, 3) array of end points for the arrows.
            name: Name for the arrows object.
            color: (N, 3) or (3,) array of RGB colors for the arrows.
            width: Width of the arrows.
            visible: Whether the arrows are visible.
            opacity: Opacity of the arrows.

        Returns:
            Arrows: The created panopti arrows object.
        """
        if name is None:
            name = f"arrows_{uuid.uuid4().hex[:8]}"

        arrows_obj = Arrows(
            viewer=self,
            starts=starts,
            ends=ends,
            name=name,
            color=color,
            width=width,
            visible=visible,
            opacity=opacity
        )

        self.objects[name] = arrows_obj
        self.socket_manager.emit_add_geometry(arrows_obj)

        return arrows_obj

    def slider(self, callback: Callable, name: str, min: float = 0.0, max: float = 1.0,
              step: float = 0.1, initial: float = 0.5, description: str = "", group: Union[Group, str, None] = None) -> Slider:

        return self._add_control(
            Slider,
            callback=callback,
            name=name,
            min=min,
            max=max,
            step=step,
            initial=initial,
            description=description,
            group=group,
        )

    def button(self, callback: Callable, name: str, group: Union[Group, str, None] = None) -> Button:

        return self._add_control(Button, callback=callback, name=name, group=group)

    def download_button(self, callback: Callable, name: str, filename: str = 'download.bin', group: Union[Group, str, None] = None) -> DownloadButton:

        return self._add_control(
            DownloadButton,
            callback=callback,
            name=name,
            filename=filename,
            group=group,
        )

    def label(self, callback: Callable, name: str = None, text: str = '', group: Union[Group, str, None] = None) -> Label:

        if name is None:
            name = f"label_{uuid.uuid4().hex[:8]}"

        return self._add_control(
            Label,
            callback=callback,
            name=name,
            text=text,
        )

    def checkbox(self, callback: Callable, name: str, initial: bool = False,
                 description: str = "", group: Union[Group, str, None] = None) -> Checkbox:

        return self._add_control(
            Checkbox,
            callback=callback,
            name=name,
            initial=initial,
            description=description,
            group=group,
        )

    def dropdown(self, callback: Callable, name: str, options: List[str],
                 initial: str = None, description: str = "", group: Union[Group, str, None] = None) -> Dropdown:

        return self._add_control(
            Dropdown,
            callback=callback,
            name=name,
            options=options,
            initial=initial,
            description=description,
            group=group,
        )

    def color_picker(self, callback: Callable, name: str,
                     initial: Union[Tuple[float, float, float, float], np.ndarray] = (0.5, 0.5, 0.5, 1.0),
                     group: Union[Group, str, None] = None) -> ColorPicker:

        return self._add_control(
            ColorPicker,
            callback=callback,
            name=name,
            initial=initial,
            group=group,
        )

    def group(self, name: str, collapsed: bool = False) -> Group:
        """Create a collapsible group for organizing UI controls.

        Parameters:
            name (str): The name/label of the group
            collapsed (bool): Whether the group starts collapsed (default: False)

        Returns:
            Group: The created group control

        Example:
            group = viewer.group("Settings", collapsed=True)
            viewer.slider(callback, "param1", group=group)
            viewer.slider(callback, "param2", group=group)
        """
        return self._add_control(
            Group,
            name=name,
            collapsed=collapsed,
        )

    def add_plotly(self, spec: Dict[str, Any], name: str) -> PlotlyPlot:
        from plotly.utils import PlotlyJSONEncoder
        import json

        spec = json.loads(json.dumps(spec, cls=PlotlyJSONEncoder))
        plot = PlotlyPlot(viewer=self, spec=spec, name=name)
        self.ui_controls[name] = plot
        self.socket_manager.emit_add_control(plot)
        return plot

    def add_image_gallery(self, name: str, images: Any,
                         thumbnail_size: int = 150, columns: int = 3,
                         rows_per_page: int = None,
                         callback: Callable = None,
                         group: Union[Group, str, None] = None) -> ImageGallery:
        """Add an image gallery UI control to display images as thumbnails.

        Parameters:
            name (str): The name/id of the control
            images: Single image or list of images. Can be:
                - Single numpy array (H, W, 3/4)
                - List of numpy arrays
                - Single base64 encoded string
                - List of base64 encoded strings
            thumbnail_size (int): Size of thumbnails in pixels (default: 150)
            columns (int): Number of columns in the gallery grid (default: 3)
            rows_per_page (int, optional): Number of rows per page for pagination.
                If None, shows all images without pagination (default: None)
            callback (Callable, optional): Function called when an image is clicked.
                Receives (viewer, image_index) as arguments
            group (Group or str, optional): Group to add this control to

        Returns:
            ImageGallery: The created image gallery control

        Example:
            # Display a single image
            viewer.add_image_gallery("my_image", image_array)

            # Display multiple images with callback
            def on_click(viewer, index):
                print(f"Image {index} clicked!")

            viewer.add_image_gallery(
                "gallery",
                [img1, img2, img3],
                thumbnail_size=120,
                columns=3,
                callback=on_click
            )

            # Display paginated gallery
            viewer.add_image_gallery(
                "paginated",
                image_list,
                columns=4,
                rows_per_page=2,  # Show 8 images per page (4 columns x 2 rows)
                callback=on_click
            )
        """
        return self._add_control(
            ImageGallery,
            name=name,
            images=images,
            thumbnail_size=thumbnail_size,
            columns=columns,
            rows_per_page=rows_per_page,
            callback=callback,
            group=group,
        )

    def get(self, name: str) -> Any:
        return self.objects.get(name) or self.ui_controls.get(name)

    def handle_ui_event(self, event_type: str, control_id: str, value: Any = None):
        control = self.ui_controls.get(control_id)
        if control is None:
            return
        control.handle_event(value)

class ViewerClient(BaseViewer):
    """Client that connects to an existing panopti server"""
    def __init__(self, server_url: str = None, viewer_id: str = None, *, headless: bool = False, viewport: Optional[Tuple[int, int]] = None):
        """Initialize a viewer client that connects to an existing panopti server.

        Args:
            server_url (str, optional): URL of the panopti server to connect to. If not provided,
                defaults to "http://localhost:8080".
            viewer_id (str, optional): Unique identifier for this viewer. If not provided,
                a random id will be generated.
            headless (bool, optional): Whether to run in headless mode. Defaults to False.
            viewport (Tuple[int, int], optional): Width and height of the headless viewport. Defaults to (1280, 720) if headless=True.
        """
        super().__init__()

        if not viewer_id:
            viewer_id = f"viewer_{uuid.uuid4().hex[:8]}"

        self.viewer_id = viewer_id

        # Default to localhost:8080 if no server URL provided
        if not server_url:
            server_url = "http://localhost:8080"
        elif not server_url.startswith(("http://", "https://")):
            server_url = f"http://{server_url}"

        base_url = server_url

        # Add viewer_id as a query parameter to ensure it's available in the web client
        if viewer_id and '?' not in server_url:
            server_url = f"{server_url}?viewer_id={viewer_id}"

        self.server_url = base_url.split('?')[0]

        print(f"Creating client connecting to: {server_url}")
        self.client = RemoteSocketIO(server_url, viewer_id)
        self.client.viewer = self  # Set the viewer reference
        self.client.connect()

        self.headless_browser = None
        if headless:
            if viewport is None:
                viewport = (1280, 720)
            from .headless import launch
            self.headless_browser = launch(server_url, width=viewport[0], height=viewport[1])
            atexit.register(self.headless_browser.close)

        # Register handlers for incoming messages:
        self.client.on('ui_event_response', self.handle_ui_event_from_server)
        self.client.on('update_object', self.handle_update_object)
        self.client.on('restart_script', self.handle_restart_script)

        # State requests:
        self.client.on('request_state_from_client', self.handle_request_state)

        self._request_events = ['camera_info', 'selected_object', 'screenshot']
        self._request_threads = {k: threading.Event() for k in self._request_events}
        self._request_data = {k: None for k in self._request_events}
        for event in self._request_events:
            self.client.on(event, self.handle_state_request)

        # events:
        self.client.on('events.camera', self.handle_events_camera)
        self.client.on('events.inspect', self.handle_events_inspect)
        self.client.on('events.hover', self.handle_events_hover)
        self.client.on('events.select_object', self.handle_events_select_object)
        self.client.on('events.gizmo', self.handle_events_gizmo)
        # events.control is handled internally
        # events.update_object is handled internally

        self.client.on('viewer_heartbeat', self.handle_heartbeat)

    # --- Heartbeat (call and response): ---
    def handle_heartbeat(self, data):
        if data.get('viewer_id') != self.viewer_id:
            return
        self.socket_manager.emit('client_heartbeat', {'viewer_id': self.viewer_id})

    def handle_ui_event_from_server(self, data):
        if data.get('viewer_id') != self.viewer_id:
            return

        event_type = data.get('eventType')
        control_id = data.get('controlId')
        value = data.get('value')
        value = as_array(value)

        self.handle_ui_event(event_type, control_id, value)
        self.events.trigger('control', control_id, value)

    def handle_update_object(self, data):
        # TODO Come back to this
        if data.get('viewer_id') != self.viewer_id:
            return
        obj_id = data.get('id')
        updates = data.get('updates', {})
        obj = self.objects.get(obj_id)
        if not obj:
            return
        updates = as_array(updates)
        for key, value in updates.items():
            if hasattr(obj, key):
                # Handle material updates specially - convert dict back to material object
                if key == 'material' and isinstance(value, dict) and 'type' in value:
                    from .materials.utils import create_material_from_dict
                    try:
                        material_obj = create_material_from_dict(value)
                        setattr(obj, key, material_obj)
                    except Exception as e:
                        print(f"Warning: Could not recreate material from dict: {e}")
                        setattr(obj, key, value)
                else:
                    setattr(obj, key, value)
        self.events.trigger('update_object', obj_id, updates)

    def handle_restart_script(self, data):
        if data.get('viewer_id') != self.viewer_id:
            return
        self.restart()

    # --- Requesting state: ---
    def handle_request_state(self, data=None):
        """Send all current objects, UI controls, and print history to the client"""
        # Reset the camera to default parameters for a fresh session
        self.socket_manager.emit_with_fallback(
            'set_camera',
            {'camera': as_list(DEFAULT_CAMERA_STATE)}
        )

        # Send all objects
        for obj in self.objects.values():
            if hasattr(obj, 'to_dict'):
                self.socket_manager.emit_add_geometry(obj)

        # Send all UI controls
        for control in self.ui_controls.values():
            if hasattr(control, 'to_dict'):
                self.socket_manager.emit_add_control(control)

        # Send print history if available
        text = self._print_buffer.getvalue()
        if text:
            from .utils.print_capture import split_text_to_segments
            segments = split_text_to_segments(text)
            self.socket_manager.emit_console_output(segments)

    def camera(self, timeout: float = 1.0) -> Optional[Dict[str, Any]]:
        """Return the current camera parameters as a dictionary containing:

        | key        | meaning                                   | type  |
        |------------|-------------------------------------------|-------|
        | position   | camera world coords                       | ndarray |
        | rotation   | camera XYZ euler rotation                 | ndarray |
        | quaternion | camera rotation as quaternion             | ndarray |
        | up         | camera up-vector                          | ndarray |
        | target     | point the camera is looking at            | ndarray |
        | fov        | vertical field-of-view (degrees)          | float |
        | near       | near-plane distance                       | float |
        | far        | far-plane distance                        | float |
        | aspect     | viewport aspect ratio (w / h)             | float |
        | projection_mode | 'perspective' or 'orthographic'       | str   |
        """
        self.emit_state_request({'event': 'request_camera_info', 'viewer_id': self.viewer_id})
        if self._request_threads['camera_info'].wait(timeout):
            camera_data = as_array(self._request_data['camera_info'])
            return camera_data
        return None

    def selected_object(self, timeout: float = 1.0) -> Optional[str]:
        """Return the currently selected object name."""
        self.emit_state_request({'event': 'request_selected_object', 'viewer_id': self.viewer_id})
        if self._request_threads['selected_object'].wait(timeout):
            return self._request_data['selected_object']
        return None

    def screenshot(self, filename: str = None, bg_color: Optional[Union[Tuple[float, float, float], np.ndarray]] = None,
                resolution: Optional[Tuple[int, int]] = None, timeout: float = 2.0) -> Optional[np.ndarray]:
        """Capture a screenshot from the frontend viewer. This function is fully compatible with headless mode.

        Parameters:
            filename (str or None): If provided, the image will be saved to this path. Supported extensions are `png` (default), `jpg`, and `jpeg`.
            bg_color (tuple or None): Background color as RGB values in [0,1] range. ``None`` results in a transparent background.
            resolution (tuple or None): Resolution tuple (W, H) of the screenshot in pixels. If provided, the screenshot will be rendered at this resolution.
            timeout (float): How long to wait for the screenshot data from the frontend. Default is 2 seconds.

        Returns:
            np.ndarray or None: RGB/RGBA image array, or ``None`` if the request timed out.
        """
        data = {'viewer_id': self.viewer_id}
        if bg_color is not None:
            data['bg_color'] = list(bg_color)
        if resolution is not None:
            data['width'] = resolution[0]
            data['height'] = resolution[1]
        self.emit_state_request({'event': 'request_screenshot', 'viewer_id': self.viewer_id, 'data': data})
        if self._request_threads['screenshot'].wait(timeout):
            img_b64 = self._request_data['screenshot']
            if not img_b64:
                return None
            import base64, io
            from PIL import Image
            header, b64data = img_b64.split(',', 1) if ',' in img_b64 else ('', img_b64)
            img_bytes = base64.b64decode(b64data)
            img = Image.open(io.BytesIO(img_bytes))
            # get `filename` ext if there is one:
            if filename:
                _, ext = os.path.splitext(filename)
                if not ext:
                    ext = '.png'
                if ext.lower() not in ['.png', '.jpg', '.jpeg']:
                    raise ValueError(f"Unsupported file extension: {ext}. Supported extensions are: .png, .jpg, .jpeg")
                filename = filename if filename.endswith(ext) else filename + ext

            if ext.lower() == '.png':
                img = img.convert('RGBA')
            else:
                img = img.convert('RGB')

            arr = np.array(img)
            if filename:
                img.save(filename)
            return arr
        return None

    def set_camera(self, **kwargs) -> None:
        """Update the viewer camera.

        Accepts the same keyword arguments that `camera` returns.
        Any provided values will overwrite the current camera state.
        """
        payload = {k: v for k, v in kwargs.items() if v is not None}
        payload = as_list(payload)
        self.socket_manager.emit_with_fallback('set_camera', {'camera': payload})

    def look_at(self, position: Union[Tuple[float, float, float], np.ndarray],
                target: Union[Tuple[float, float, float], np.ndarray]) -> None:
        """Position the camera and look at ``target``.

        Parameters:
            position (list, ndarray): Camera position in world coordinates.
            target (list, ndarray): World coordinate the camera should look at.
        """
        position = np.asarray(position)
        target = np.asarray(target)
        self.set_camera(position=position, target=target)

    def emit_state_request(self, data):
        """Emit a state request to the server."""
        if data.get('viewer_id') != self.viewer_id:
            return

        event = data.get('event') # e.g. : 'request_camera_info'
        event_basename = event.replace('request_', '') # 'camera_info'
        event_data = data.get('data', {})
        if event_basename not in self._request_events:
            raise ValueError(f"Unknown state request event: {event}")

        self._request_threads[event_basename].clear()
        self._request_data[event_basename] = None
        event_data = as_list(event_data)
        self.socket_manager.emit('relay_state_request', {'event': event, 'viewer_id': self.viewer_id, 'data': event_data})

    def handle_state_request(self, data):
        """Handle incoming state from the frontend."""
        if data.get('viewer_id') != self.viewer_id:
            return

        event = data.get('event') # e.g. : 'request_camera_info'
        event_basename = event.replace('request_', '') # 'camera_info'
        if event_basename not in self._request_events:
            raise ValueError(f"Unknown state request event: {event}")

        self._request_data[event_basename] = data.get('data')
        self._request_threads[event_basename].set()

    #  --- Panopti events: ---
    def handle_events_camera(self, data):
        if data.get('viewer_id') != self.viewer_id:
            return
        camera_data = data.get('camera')
        camera_data = as_array(camera_data)
        self.events.trigger('camera', camera_data)

    def handle_events_inspect(self, data):
        if data.get('viewer_id') != self.viewer_id:
            return
        inspection_data = data.get('inspection')
        inspection_data = as_array(inspection_data)
        self.events.trigger('inspect', inspection_data)

    def handle_events_hover(self, data):
        if data.get('viewer_id') != self.viewer_id:
            return
        hover_data = data.get('inspection')
        hover_data = as_array(hover_data)
        self.events.trigger('hover', hover_data)

    def handle_events_select_object(self, data):
        if data.get('viewer_id') != self.viewer_id:
            return
        selected_object = data.get('selected_object')
        self.events.trigger('select_object', selected_object)

    def handle_events_gizmo(self, data):
        if data.get('viewer_id') != self.viewer_id:
            return
        gizmo_data = data.get('gizmo')
        gizmo_data = as_array(gizmo_data)
        self.events.trigger('gizmo', gizmo_data)

    def close(self) -> None:
        """Close network connections and any headless browser."""
        if self.client:
            self.client.disconnect()
        if getattr(self, 'headless_browser', None):
            try:
                self.headless_browser.close()
            finally:
                self.headless_browser = None

class ViewerServer:
    """Standalone server without viewer functionality"""
    def __init__(self, host: str = 'localhost', port: int = 8080, debug: bool = False, config_path: str = None):
        self.host = host
        self.port = port
        self.debug = debug
        self.config_path = config_path

        from .server.app import run_standalone_server
        run_standalone_server(host=host, port=port, debug=debug, config_path=config_path)

def connect(server_url: str = None, viewer_id: str = None, *, headless: bool = False, viewport: Optional[Tuple[int, int]] = None) -> ViewerClient:
    """Connect to an existing panopti server.

    Args:
        server_url (str, optional): URL of the panopti server to connect to. If not provided, defaults to "http://localhost:8080".
        viewer_id (str, optional): Unique identifier for this viewer. If not provided, a random id will be generated.
        headless (bool, optional): Whether to run in headless mode. Defaults to False.
        viewport (Tuple[int, int], optional): Width and height of the headless viewport. Defaults to (1280, 720) if headless=True.
    """
    return ViewerClient(server_url, viewer_id, headless=headless, viewport=viewport)


def start_server(host: str = 'localhost', port: int = 8080, debug: bool = False, config_path: str = None):
    """Start a standalone server without viewer functionality

    Args:
        host: Server host address
        port: Server port
        debug: Enable debug mode
        config_path: Path to configuration file (optional)
    """
    ViewerServer(host, port, debug, config_path)
