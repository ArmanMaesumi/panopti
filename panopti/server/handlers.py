"""Socket.IO event handlers for the panopti server."""

from __future__ import annotations

from typing import Dict, Any
from flask import current_app, request
from flask_socketio import SocketIO

# Events that update viewer state
_OBJECT_ADDS = {"add_mesh", "add_animated_mesh", "add_points", "add_arrows"}
_CONTROL_ADDS = {"add_control"}
_OBJECT_DELETES = {"delete_object"}
_CONTROL_DELETES = {"delete_control"}
_EVENTS = {"events.camera", "events.inspect", "events.select_object", "events.gizmo"}

def _update_viewer_state(event_type: str, data: Dict[str, Any]) -> None:
    """Update stored viewer state depending on the event type."""
    viewer_id = data.get("viewer_id")
    if not viewer_id:
        return
    viewers = current_app.config["CLIENT_VIEWERS"]
    viewer = viewers.setdefault(viewer_id, {"objects": {}, "controls": {}})

    if event_type in _OBJECT_ADDS:
        object_id = data.get("id") or data.get("name")
        if object_id:
            viewer["objects"][object_id] = data
    elif event_type in _CONTROL_ADDS:
        control_id = data.get("id")
        if control_id:
            viewer["controls"][control_id] = data
    elif event_type in _OBJECT_DELETES:
        object_id = data.get("id")
        if object_id:
            viewer["objects"].pop(object_id, None)
    elif event_type in _CONTROL_DELETES:
        control_id = data.get("id")
        if control_id:
            viewer["controls"].pop(control_id, None)


def create_event_handler(event_type: str, socketio: SocketIO):
    """Return a handler that updates server state and broadcasts the event."""

    def handler(data: Dict[str, Any]):
        _update_viewer_state(event_type, data)
        viewer_id = data.get("viewer_id")
        # Avoid sending the event back to the sender to prevent circular updates
        sender_sid = request.sid if hasattr(request, 'sid') else None
        socketio.emit(event_type, data, room=viewer_id, skip_sid=sender_sid)

    return handler


def register_handlers(app) -> None:
    """Register all standard Socket.IO event handlers on the Flask app."""
    socketio: SocketIO = app.config["SOCKETIO"]

    for event in (
        _OBJECT_ADDS
        | _CONTROL_ADDS
        | _OBJECT_DELETES
        | _CONTROL_DELETES
        | _EVENTS
        | {
            "update_object",
            "update_label",
            "download_file",
            "console_output",
            "console_command",
            "console_complete",
            "console_meta",
            "camera_info",
            "selected_object",
            "screenshot",
            "set_camera",
            "viewer_heartbeat",
            "client_heartbeat",
        }
    ):
        socketio.on(event)(create_event_handler(event, socketio))

