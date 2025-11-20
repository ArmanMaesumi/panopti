# panopti/server/app.py
import os
import uuid
import json
from importlib.resources import files as pkg_files
from flask import Flask, render_template, send_from_directory, request, Response, jsonify
from panopti.utils.parse import decode_msgpack, encode_msgpack, as_list
from flask_socketio import SocketIO, join_room

import panopti.objects as PanoptiObjects
from panopti.objects.utils import export_object_from_dict
from .handlers import register_handlers, _update_viewer_state
from panopti.config import load_config

# Resolve template directory via importlib.resources (avoids deprecated pkg_resources)
_TEMPLATES_DIR = str((pkg_files('panopti') / 'server' / 'static' / 'templates'))

def create_app(config_path: str = None, debug: bool = False):
    app = Flask(__name__, template_folder=_TEMPLATES_DIR)
    app.config['SECRET_KEY'] = 'secret!'
    app.config['DEBUG'] = debug
    app.config['VITE_DEV_SERVER'] = os.environ.get('VITE_DEV_SERVER')

    # Load Vite manifest if available (when not using dev server)
    manifest = {}
    if not app.config['VITE_DEV_SERVER']:
        manifest_path = str((pkg_files('panopti') / 'server' / 'static' / 'dist' / '.vite' / 'manifest.json'))
        try:
            with open(manifest_path, 'r', encoding='utf-8') as f:
                manifest = json.load(f)
        except FileNotFoundError:
            # Manifest not found; likely running without a built frontend. We'll fall back to dev mode templates.
            manifest = {}
    app.config['VITE_MANIFEST'] = manifest

    socketio = SocketIO(app,
                        cors_allowed_origins="*",
                        async_mode='eventlet',
                        ping_timeout=60, ping_interval=1, max_http_buffer_size=1e8)

    app.config['SOCKETIO'] = socketio
    app.config['CLIENT_VIEWERS'] = {}  # Store registered clients
    app.config['HTTP_EVENTS'] = {}

    # Load configuration at startup
    app.config['PANOPTI_CONFIG'] = load_config(config_path)

    def _handle_missing_viewer_id(data):
        """Handle cases where viewer_id is not provided."""
        if not data or 'viewer_id' not in data:
            raise ValueError(f"Missing viewer_id")
        if data['viewer_id'] not in app.config['CLIENT_VIEWERS']:
            raise ValueError(f"Viewer ID {data['viewer_id']} not registered")

    @app.route('/')
    def index():
        # Check if viewer_id was specified in query params
        viewer_id = request.args.get('viewer_id')
        is_dev = bool(app.config['VITE_DEV_SERVER'])
        return render_template(
            'index.html',
            viewer_id=viewer_id,
            bundle=app.config.get('VITE_MANIFEST', {}),
            config=app.config['PANOPTI_CONFIG'],
            is_dev=is_dev
        )

    @app.route('/static/<path:path>')
    def serve_static(path):
        return send_from_directory('static', path)

    @app.route('/export/<viewer_id>/<object_id>', methods=['GET'])
    def export_object(viewer_id, object_id):
        """Export a geometry object registered by a viewer."""
        if viewer_id not in app.config['CLIENT_VIEWERS']:
            return "Invalid viewer ID", 404

        obj = app.config['CLIENT_VIEWERS'][viewer_id]['objects'].get(object_id)
        if obj is None:
            return "Object not found in viewer data", 404

        obj_content = export_object_from_dict(obj)

        if obj['type'] == 'mesh':
            return Response(
                obj_content,
                mimetype='text/plain',
                headers={'Content-Disposition': f'attachment; filename="{object_id}.obj"'}
            )
        elif obj['type'] == 'animated_mesh' or obj['type'] == 'points':
            return Response(
                obj_content,
                mimetype='application/octet-stream',
                headers={'Content-Disposition': f'attachment; filename="{object_id}.npz"'}
            )

        return "Object not found or not exportable", 404

    @app.route('/http_event', methods=['POST'])
    def handle_http_event():
        if request.content_type == 'application/msgpack':
            payload = decode_msgpack(request.get_data())
        else:
            payload = request.get_json()
        if not payload:
            return {"status": "error", "message": "no payload"}, 400
        event = payload.get('event')
        data = payload.get('data')
        viewer_id = payload.get('viewer_id')
        if viewer_id and isinstance(data, dict) and 'viewer_id' not in data:
            data['viewer_id'] = viewer_id
        token = uuid.uuid4().hex
        app.config['HTTP_EVENTS'][token] = data
        _update_viewer_state(event, as_list(data))
        socketio.emit(
            'http_event',
            {
                'event': event,
                'url': f'/http_event_data/{token}',
                'viewer_id': viewer_id
            },
            room=viewer_id
        )
        return {"status": "ok", "token": token}

    @app.route('/http_event_data/<token>')
    def get_http_event_data(token):
        data = app.config['HTTP_EVENTS'].get(token)
        if data is None:
            return "not found", 404
        packed = encode_msgpack(data)
        return Response(packed, mimetype='application/msgpack')

    @socketio.on('connect')
    def handle_connect():
        print("Client connected")
        viewer_id = request.args.get('viewer_id')
        if viewer_id:
            join_room(viewer_id)
            app.config['CLIENT_VIEWERS'].setdefault(
                viewer_id,
                {'id': viewer_id, 'objects': {}, 'controls': {}}
            )
            print(f"Joined room {viewer_id}")

    @socketio.on('request_state')
    def handle_request_state(data=None):
        _handle_missing_viewer_id(data)

        viewer_id = data.get('viewer_id')
        print(f"Request for viewer ID: {viewer_id}")
        socketio.emit('request_state_from_client', room=viewer_id)

    @socketio.on('disconnect')
    def handle_disconnect():
        print("Client disconnected")

    @socketio.on('ui_event')
    def handle_ui_event(data):
        _handle_missing_viewer_id(data)

        viewer_id = data.get('viewer_id')
        event_type = data.get('eventType')
        control_id = data.get('controlId')
        value = data.get('value')

        socketio.emit(
            'ui_event_response',
            {
                'viewer_id': viewer_id,
                'eventType': event_type,
                'controlId': control_id,
                'value': value
            },
            room=viewer_id
        )

    # Register standard event handlers:
    register_handlers(app)

    @socketio.on('request_camera_info')
    def handle_request_camera_info(data):
        _handle_missing_viewer_id(data)
        viewer_id = data.get('viewer_id')
        socketio.emit('request_camera_info', data or {}, room=viewer_id)

    @socketio.on('request_selected_object')
    def handle_request_selected_object(data):
        _handle_missing_viewer_id(data)
        viewer_id = data.get('viewer_id')
        socketio.emit('request_selected_object', data or {}, room=viewer_id)

    @socketio.on('request_screenshot')
    def handle_request_screenshot(data):
        _handle_missing_viewer_id(data)
        viewer_id = data.get('viewer_id')
        socketio.emit('request_screenshot', data or {}, room=viewer_id)

    # General function that lets the client request simple state information from the frontend
    @socketio.on('relay_state_request')
    def handle_relay_state_request(data):
        _handle_missing_viewer_id(data)
        viewer_id = data.get('viewer_id')
        event_str = data.get('event')
        req_data = data.get('data', {})
        socketio.emit(event_str, req_data, room=viewer_id)

    @socketio.on('restart_script')
    def handle_restart_script(data=None):
        _handle_missing_viewer_id(data)
        viewer_id = data.get('viewer_id')
        socketio.emit('restart_script', {'viewer_id': viewer_id}, room=viewer_id)

    @socketio.on('register_viewer')
    def handle_register_viewer(data):
        _handle_missing_viewer_id(data)
        viewer_id = data.get('viewer_id')
        print(f"Registering viewer with ID: {viewer_id}")
        app.config['CLIENT_VIEWERS'].setdefault(
            viewer_id,
            {'id': viewer_id, 'objects': {}, 'controls': {}}
        )
        if viewer_id:
            join_room(viewer_id)
        return {'status': 'success', 'viewer_id': viewer_id}

    app.config['SOCKETIO'] = socketio

    return app

def run_standalone_server(host='localhost', port=8080, debug=False, config_path: str = None):
    app = create_app(config_path, debug=debug)
    socketio = app.config['SOCKETIO']
    print(f"Starting standalone server at http://{host}:{port}")
    socketio.run(app, host=host, port=port, debug=debug, use_reloader=False)

