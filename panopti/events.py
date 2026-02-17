from typing import Callable, Dict, List, Any, Optional, Union
import time
from functools import wraps
from dataclasses import dataclass
import numpy as np

# Event data structures using dataclasses for dot-access notation

@dataclass
class TransformData:
    """Transformation data for position, rotation, and scale."""
    position: np.ndarray
    rotation: np.ndarray
    scale: np.ndarray

@dataclass
class CameraInfo:
    """Camera information returned by camera events."""
    position: np.ndarray
    rotation: np.ndarray
    quaternion: np.ndarray
    up: np.ndarray
    target: np.ndarray
    fov: float
    near: float
    far: float
    aspect: float
    projection_mode: str

@dataclass
class MeshInspectResult:
    """Inspection result data for mesh objects."""
    face_index: int
    vertex_indices: np.ndarray

@dataclass
class PointCloudInspectResult:
    """Inspection result data for point cloud objects."""
    point_index: int

@dataclass
class InspectInfo:
    """Inspection information returned by inspect events."""
    object_name: str
    object_type: str
    world_coords: np.ndarray
    screen_coords: np.ndarray
    inspect_result: Union[MeshInspectResult, PointCloudInspectResult]

@dataclass
class MeshSelectionResult:
    """Selection result data for mesh objects."""
    face_indices: np.ndarray
    vertex_indices: np.ndarray

@dataclass
class PointCloudSelectionResult:
    """Selection result data for point cloud objects."""
    point_indices: np.ndarray

@dataclass
class SelectionInfo:
    """Selection information returned by selection events."""
    object_name: str
    object_type: str
    selection_result: Union[MeshSelectionResult, PointCloudSelectionResult]

@dataclass
class GizmoInfo:
    """Gizmo transformation information."""
    object_name: str
    object_type: str
    trans: TransformData
    prev_trans: TransformData

# Helper functions to convert dict data to dataclass instances
def _dict_to_camera_info(data: dict) -> CameraInfo:
    """Convert dictionary to CameraInfo dataclass."""
    return CameraInfo(
        position=np.asarray(data['position'], dtype=np.float32),
        rotation=np.asarray(data['rotation'], dtype=np.float32),
        quaternion=np.asarray(data['quaternion'], dtype=np.float32),
        up=np.asarray(data['up'], dtype=np.float32),
        target=np.asarray(data['target'], dtype=np.float32),
        fov=data['fov'],
        near=data['near'],
        far=data['far'],
        aspect=data['aspect'],
        projection_mode=data['projection_mode']
    )

def _dict_to_inspect_info(data: dict) -> InspectInfo:
    """Convert dictionary to InspectInfo dataclass."""
    inspect_result = None
    if 'inspect_result' in data:
        result_data = data['inspect_result']
        object_type = data['object_type']
        
        if object_type in ['mesh', 'animated_mesh']:
            inspect_result = MeshInspectResult(
                face_index=result_data['face_index'],
                vertex_indices=np.asarray(result_data['vertex_indices'], dtype=np.int32)
            )
        elif object_type == 'points':
            inspect_result = PointCloudInspectResult(
                point_index=np.asarray(result_data['point_index'], dtype=np.int32)
            )
    
    return InspectInfo(
        object_name=data['object_name'],
        object_type=data['object_type'],
        world_coords=np.asarray(data['world_coords'], dtype=np.float32),
        screen_coords=np.asarray(data['screen_coords'], dtype=np.int32),
        inspect_result=inspect_result
    )

def _dict_to_gizmo_info(data: dict) -> GizmoInfo:
    """Convert dictionary to GizmoInfo dataclass."""
    trans_data = data['trans']
    prev_trans_data = data['prev_trans']
    
    trans = TransformData(
        position=np.asarray(trans_data['position'], dtype=np.float32),
        rotation=np.asarray(trans_data['rotation'], dtype=np.float32),
        scale=np.asarray(trans_data['scale'], dtype=np.float32)
    )
    
    prev_trans = TransformData(
        position=np.asarray(prev_trans_data['position'], dtype=np.float32),
        rotation=np.asarray(prev_trans_data['rotation'], dtype=np.float32),
        scale=np.asarray(prev_trans_data['scale'], dtype=np.float32)
    )
    
    return GizmoInfo(
        object_name=data['object_name'],
        object_type=data['object_type'],
        trans=trans,
        prev_trans=prev_trans
    )

def _dict_to_selection_info(data: dict) -> SelectionInfo:
    """Convert dictionary to SelectionInfo dataclass."""
    result_data = data.get('selection_result', {})
    object_type = data.get('object_type')
    if object_type in ['mesh', 'animated_mesh']:
        selection_result = MeshSelectionResult(
            face_indices=np.asarray(result_data.get('face_indices', []), dtype=np.int32),
            vertex_indices=np.asarray(result_data.get('vertex_indices', []), dtype=np.int32)
        )
    else:
        selection_result = PointCloudSelectionResult(
            point_indices=np.asarray(result_data.get('point_indices', []), dtype=np.int32)
        )
    return SelectionInfo(
        object_name=data.get('object_name'),
        object_type=object_type,
        selection_result=selection_result
    )

class EventDispatcher:
    """Event dispatcher used for viewer callbacks."""

    def __init__(self, viewer):
        self.viewer = viewer
        self._callbacks: Dict[str, List[Callable]] = {
            'camera': [],
            'inspect': [],
            'selection': []
        }
        self._throttle_timestamps: Dict[str, float] = {}

    def _create_throttled_decorator(self, event_name: str, throttle: int = None):
        """Helper method to create a throttled decorator for any event."""
        def decorator(func: Callable[[Any], Any]) -> Callable[[Any], Any]:
            if throttle is not None and throttle > 0:
                # Create a throttled version of the function
                @wraps(func)
                def throttled_func(viewer, *args, **kwargs):
                    current_time = time.time() * 1000  # Convert to milliseconds
                    func_id = f"{event_name}_{func.__name__}_{id(func)}"
                    
                    last_call = self._throttle_timestamps.get(func_id, 0)
                    if current_time - last_call >= throttle:
                        self._throttle_timestamps[func_id] = current_time
                        return func(viewer, *args, **kwargs)
                    # If throttled, silently ignore the call
                    return None
                
                self._callbacks.setdefault(event_name, []).append(throttled_func)
                return func
            else:
                # No throttling, use the original function
                self._callbacks.setdefault(event_name, []).append(func)
                return func
        return decorator

    def camera(self, throttle: int = None) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """The `camera` event is triggered when the user manipulates the viewer 
        camera (e.g. orbit, pan, zoom). This event provides a `CameraInfo` object 
        containing information about the camera's current state.
        
        Args:
            throttle (int, optional): Throttle interval in milliseconds. If provided, 
                the callback will only be called at most once per throttle interval.
        
         Example usage:
        ```python
        @viewer.events.camera()
        def camera_event(viewer, camera_info):
            print('Camera was updated!')
            # swivel scene mesh to always face the camera (in Y-axis):
            mesh = viewer.get('myMesh')
            mx, my, mz = mesh.position
            cx, cy, cz = camera_info.position  # dot-access notation
            yaw = math.atan2(cx - mx, cz - mz)
            mesh.rotation = [0, yaw, 0]
            mesh.update(rotation=[0, yaw, 0])
        
        # Or with throttling (100ms interval)
        @viewer.events.camera(throttle=100)
        def throttled_camera_event(viewer, camera_info):
            print('Throttled camera update!')
        ```
        `camera_info` is a `CameraInfo` object with the following attributes:

        | attribute        | meaning                                   | type  |
        |------------------|-------------------------------------------|-------|
        | position         | camera world coords                       | ndarray  |
        | rotation         | camera XYZ euler rotation                 | ndarray  |
        | quaternion       | camera rotation as quaternion             | ndarray  |
        | up               | camera up-vector                          | ndarray  |
        | target           | point the camera is looking at            | ndarray  |
        | fov              | vertical field-of-view (degrees)          | float |
        | near             | near-plane distance                       | float |
        | far              | far-plane distance                        | float |
        | aspect           | viewport aspect ratio (w / h)             | float |
        | projection_mode  | 'perspective' or 'orthographic'           | str   |
        """
        return self._create_throttled_decorator('camera', throttle)

    def inspect(self) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """The `inspect` event is triggered when the inspection tool is used in the viewer (e.g. when clicking on a mesh to inspect its local vertex indices).
        Example usage:
        ```python
        @viewer.events.inspect()
        def inspect_event(viewer, inspect_info):
            print(f"User clicked on a {inspect_info.object_type} object.")
            if inspect_info.object_type == 'mesh':
                print('Selected face index: ', inspect_info.inspect_result.face_index)
        ```
        `inspect_info` is an `InspectInfo` object with the following attributes:

        | attribute        | meaning                                                                                                                         | type   |
        |------------------|---------------------------------------------------------------------------------------------------------------------------------|--------|
        | object_name      | `name` attribute of selected object                                                                                             | str    |
        | object_type      | type of Panopti object selected (e.g., `'mesh'`, `'points'`)                                                               | str    |
        | world_coords     | XYZ world coordinates of the pick point                                                                                         | ndarray   |
        | screen_coords    | integer pixel coordinates of the pick point                                                                                     | ndarray   |
        | inspect_result   | geometry-specific data at the pick point:<br><br>**Mesh / AnimatedMesh**: `MeshInspectResult` holding `face_index` and `vertex_indices`<br><br>**PointCloud**: `PointCloudInspectResult` holding `point_index` | Union[MeshInspectResult, PointCloudInspectResult]   |
        """
        def decorator(func: Callable[[Any], Any]) -> Callable[[Any], Any]:
            self._callbacks.setdefault('inspect', []).append(func)
            return func
        return decorator

    def selection(self) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """The `selection` event is triggered when a selection tool interaction completes.
        Example usage:
        ```python
        @viewer.events.selection()
        def selection_event(viewer, selection_info):
            print(f"User selected a {selection_info.object_type} object.")
            if selection_info.object_type == 'mesh':
                print('Selected face indices: ', selection_info.selection_result.face_indices)
        ```
        `selection_info` is an `SelectionInfo` object with the following attributes:

        | attribute        | meaning                                                          | type   |
        |------------------|------------------------------------------------------------------|--------|
        | object_name      | `name` attribute of selected object                              | str    |
        | object_type      | type of Panopti object selected (e.g., `'mesh'`, `'points'`)     | str    |
        | selection_result | geometry-specific data at the pick point:<br><br>**Mesh**: `MeshSelectionResult` holding `face_indices` and `vertex_indices`<br><br>**PointCloud**: `PointCloudSelectionResult` holding `point_indices` | Union[MeshSelectionResult, PointCloudSelectionResult]   |
        """
        def decorator(func: Callable[[Any], Any]) -> Callable[[Any], Any]:
            self._callbacks.setdefault('selection', []).append(func)
            return func
        return decorator
    
    def select_object(self) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """The `select_object` event is triggered when a geometric structure is selected in the viewer -- either by clicking on the object directly or selecting it in the layers panel.
        Example usage:
        ```python
        @viewer.events.object_selection()
        def object_selection_event(viewer, object_name):
            print(f"User selected {object_name}")
        ```
        `object_name: str` is the selected object's name.
        """
        def decorator(func: Callable[[Any], Any]) -> Callable[[Any], Any]:
            self._callbacks.setdefault('select_object', []).append(func)
            return func
        return decorator
    
    def control(self, throttle: int = None) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """The `control` event is triggered when any control element is interacted with,
        e.g. when a slider is moved or a checkbox is toggled.
        
        Args:
            throttle (int, optional): Throttle interval in milliseconds. If provided, 
                the callback will only be called at most once per throttle interval.
        
        Example usage:
        ```python
        @viewer.events.control()
        def control_event(viewer, control_name, value):
            print(f"User updated {control_name} to {value}")
        
        # Or with throttling (50ms interval)
        @viewer.events.control(throttle=50)
        def throttled_control_event(viewer, control_name, value):
            print(f"Throttled control update: {control_name} = {value}")
        ```
        `control_name: str` is the name of the control element
        
        `value` is the control element's new value
        """
        return self._create_throttled_decorator('control', throttle)
    
    def update_object(self, throttle: int = None) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """The `update_object` event is triggered when any geometric object has 
        an attribute updated, e.g. through `.update(...)` or when the transformation
        panel is used.
        
        Args:
            throttle (int, optional): Throttle interval in milliseconds. If provided, 
                the callback will only be called at most once per throttle interval.
        
        Example usage:
        ```python
        @viewer.events.update_object()
        def update_object_event(viewer, object_name, data):
            print(f"Object {object_name} updated with attributes: {data.keys()}")
        
        # Or with throttling (100ms interval)
        @viewer.events.update_object(throttle=100)
        def throttled_update_event(viewer, object_name, data):
            print(f"Throttled object update: {object_name}")
        ```
        `object_name: str` is the updated object's name
        
        `data: dict` holds the updated attributes of the object, e.g. `{'vertices': ...}`
        """
        return self._create_throttled_decorator('update_object', throttle)

    def gizmo(self, throttle: int = None) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """The `gizmo` event is triggered when the gizmo is used to transform an object.
        
        Args:
            throttle (int, optional): Throttle interval in milliseconds. If provided, 
                the callback will only be called at most once per throttle interval.
        
        Example usage:
        ```python
        @viewer.events.gizmo()
        def gizmo_event(viewer, gizmo_info):
            print(f"Gizmo was used to transform {gizmo_info.object_name}")
        
        # Or with throttling (50ms interval)
        @viewer.events.gizmo(throttle=50)
        def throttled_gizmo_event(viewer, gizmo_info):
            print(f"Throttled gizmo transform: {gizmo_info.object_name}")
        ```
        `gizmo_info` is a `GizmoInfo` object with the following attributes:

        | Attribute | Type | Description |
        |-----------|------|-------------|
        | object_name | str | Name of the transformed object |
        | object_type | str | Type of Panopti object being transformed (e.g. `'mesh'`, `'points'`) |
        | trans | TransformData | New transformation values with `position`, `rotation`, `scale` |
        | prev_trans | TransformData | Previous transformation values when the drag event started |
        """
        return self._create_throttled_decorator('gizmo', throttle)

    def trigger(self, event: str, *args, **kwargs) -> None:
        """Trigger all callbacks for a given event name."""
        for cb in self._callbacks.get(event, []):
            try:
                # Convert dict data to dataclass instances for events that return structured data
                if event == 'camera' and args and isinstance(args[0], dict):
                    args = (_dict_to_camera_info(args[0]),) + args[1:]
                elif event == 'inspect' and args and isinstance(args[0], dict):
                    args = (_dict_to_inspect_info(args[0]),) + args[1:]
                elif event == 'selection' and args and isinstance(args[0], dict):
                    args = (_dict_to_selection_info(args[0]),) + args[1:]
                elif event == 'gizmo' and args and isinstance(args[0], dict):
                    args = (_dict_to_gizmo_info(args[0]),) + args[1:]
                
                cb(self.viewer, *args, **kwargs)
            except Exception as exc:
                print(f'Error in {event} callback {cb}: {exc}')
