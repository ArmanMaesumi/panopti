# panopti/comms/websocket.py
from typing import Dict, Any
import socketio
import json
import requests
from panopti.utils.parse import as_list, encode_msgpack
from socketio.exceptions import ConnectionError  # Added for better error handling

class SocketManager:
    """Abstraction over Socket.IO with HTTP fallback for large payloads."""

    MAX_BYTES = 250_000

    def __init__(self, viewer):
        self.viewer = viewer

    @property
    def server_url(self):
        if hasattr(self.viewer, 'server_url'):
            return self.viewer.server_url
        if hasattr(self.viewer, 'client') and hasattr(self.viewer.client, 'url'):
            return self.viewer.client.url.split('?')[0]
        if hasattr(self.viewer, 'host') and hasattr(self.viewer, 'port'):
            return f"http://{self.viewer.host}:{self.viewer.port}"
        return None

    def _payload_size(self, data: Dict[str, Any]) -> int:
        try:
            return len(json.dumps(data))
        except Exception:
            return 0

    def _emit_http(self, event: str, data: Dict[str, Any]) -> None:
        url = self.server_url
        if not url:
            self.emit(event, data)
            return
        try:
            payload = {"event": event, "data": data}
            if hasattr(self.viewer, "viewer_id"):
                payload["viewer_id"] = self.viewer.viewer_id
            requests.post(f"{url}/http_event", json=payload)
        except Exception as exc:
            self.emit(event, data)

    def _emit_http_msgpack(self, event: str, data: Dict[str, Any]) -> None:
        url = self.server_url
        if not url:
            self.emit(event, as_list(data))
            return
        try:
            payload = {"event": event, "data": data}
            if hasattr(self.viewer, "viewer_id"):
                payload["viewer_id"] = self.viewer.viewer_id
            packed = encode_msgpack(payload)
            headers = {"Content-Type": "application/msgpack"}
            requests.post(f"{url}/http_event", data=packed, headers=headers)
        except Exception as exc:
            self.emit(event, as_list(data))

    @property
    def socketio(self):
        if hasattr(self.viewer, 'app') and self.viewer.app:
            return self.viewer.app.config['SOCKETIO']
        elif hasattr(self.viewer, 'client') and self.viewer.client:
            return self.viewer.client
        return None

    def emit(self, event: str, data: Dict[str, Any]) -> None:
        if hasattr(self.viewer, 'viewer_id'):
            data['viewer_id'] = self.viewer.viewer_id
        self.socketio.emit(event, data)

    def emit_with_fallback(self, event: str, data: Dict[str, Any], raw_data: Dict[str, Any] = None) -> None:
        """Emit data, using HTTP if the payload is large."""
        if self._payload_size(data) > self.MAX_BYTES:
            if raw_data is not None:
                self._emit_http_msgpack(event, raw_data)
            else:
                self._emit_http(event, data)
        else:
            self.emit(event, data)

    def emit_add_geometry(self, geometry) -> None:
        data = as_list(geometry.to_dict())
        raw = geometry.to_dict(serialize=False)
        geometry_type = data["type"]
        self.emit_with_fallback(f"add_{geometry_type}", data, raw)

    def emit_update_object(self, obj, updates: Dict[str, Any], raw_data: Dict[str, Any] = None) -> None:
        updates = as_list(updates)
        data = {"id": obj.name, "updates": updates}
        if raw_data is not None:
            raw = {"id": obj.name, "updates": raw_data}
        else:
            raw = None
        self.emit_with_fallback("update_object", data, raw)

    def emit_delete_object(self, object_id: str) -> None:
        data = {
            "id": object_id
        }
        self.emit('delete_object', data)

    def emit_add_control(self, control) -> None:
        data = as_list(control.to_dict())
        self.emit('add_control', data)

    def emit_download_file(self, file_bytes: bytes, filename: str) -> None:
        import base64
        data = {
            "filename": filename,
            "data": base64.b64encode(file_bytes).decode("utf-8"),
        }
        self.emit_with_fallback("download_file", data)

    def emit_update_label(self, label_id: str, text: str) -> None:
        data = {
            "id": label_id,
            "text": text
        }
        self.emit('update_label', data)

    def emit_update_image_gallery(self, gallery_id: str, images: list) -> None:
        data = {
            "id": gallery_id,
            "images": images
        }
        self.emit_with_fallback('update_image_gallery', data)

    def emit_delete_control(self, control_id: str) -> None:
        data = {
            "id": control_id
        }
        self.emit('delete_control', data)

    def emit_console_output(self, segments):
        data = {"segments": segments}
        self.emit('console_output', data)

class RemoteSocketIO:
    def __init__(self, url: str, viewer_id: str = None):
        self.client = socketio.Client()
        self.url = url
        self.viewer_id = viewer_id
        self.connected = False
        self.viewer = None  # Will be set by the ViewerClient

    def connect(self):
        if not self.connected:
            try:
                print(f"Connecting to server at {self.url}")
                self.client.connect(self.url)
                self.connected = True
                if self.viewer_id:
                    print(f"Registering viewer with ID: {self.viewer_id}")
                    self.client.emit('register_viewer', {'viewer_id': self.viewer_id})
                    print("Registration successful")
            except ConnectionError as exc:
                msg = (
                    "\n[Panopti] ERROR:\n"
                    f"Could not connect to server at {self.url}. Is the panopti server running? To start server, run: python -m panopti.run_server --host localhost --port 8080\n"
                    "See https://armanmaesumi.github.io/panopti/getting_started/ for more information.\n"
                    "Exiting...\n"
                )
                raise RuntimeError(msg) from exc
            except Exception as exc:
                msg = (
                    "\n[Panopti] ERROR:\n"
                    f"Unexpected error connecting to server: {exc}\n"
                    "Exiting...\n"
                )
                raise RuntimeError(msg) from exc

    def disconnect(self):
        if self.connected:
            self.client.disconnect()
            self.connected = False

    def emit(self, event: str, data: Dict[str, Any]) -> None:
        if not self.connected:
            self.connect()
        self.client.emit(event, data)

    def on(self, event: str, handler):
        self.client.on(event, handler)
