import { io } from 'socket.io-client';
import { marked } from 'marked';
import { cameraData } from './utils.js';

export function initComms(
    sceneManagerRef,
    {
        setIsLoading,
        setControls,
        setConsoleLines,
        setConsoleInteractiveEnabled,
        setConnectionStatus,
        setPing,
        setViewerScriptName,
        onViewerSessionStarted
    } = {}
) {
    const opts = window.viewerId ? { query: { viewer_id: window.viewerId } } : {};
    const socket = io(opts);

    socket.on('connect', () => {
        if (window.viewerId) {
            socket.emit('register_viewer', { viewer_id: window.viewerId });
        }
        const req = {};
        if (window.viewerId) req.viewer_id = window.viewerId;
        socket.emit('request_state', req);
        if (setIsLoading) setTimeout(() => setIsLoading(false), 500);
        console.log('connecting');
        setConnectionStatus('connected');
        setPing(null);
        setConsoleInteractiveEnabled && setConsoleInteractiveEnabled(false);
    });

    socket.on('disconnect', () => {
        console.log('disconnected');
        setConnectionStatus('disconnected');
        setPing(null);
        if (setIsLoading) setIsLoading(true);
        setConsoleInteractiveEnabled && setConsoleInteractiveEnabled(false);
    });

    socket.on('add_control', data => {
        setConnectionStatus('connected');
        setControls && setControls(prev => {
            const existingIndex = prev.findIndex(c => c.id === data.id);
            if (existingIndex === -1) {
                return [...prev, data];
            }

            const next = [...prev];
            next[existingIndex] = { ...next[existingIndex], ...data };
            return next;
        });
    });

    socket.on('update_label', data => {
        setConnectionStatus('connected');
        setControls && setControls(prev => prev.map(c => c.id === data.id ? { ...c, text: marked.parse(data.text) } : c));
    });

    socket.on('delete_control', data => {
        setConnectionStatus('connected');
        setControls && setControls(prev => prev.filter(c => c.id !== data.id));
    });

    socket.on('console_output', data => {
        setConnectionStatus('connected');
        if (data.viewer_id && window.viewerId && data.viewer_id !== window.viewerId) return;
        let message;
        if (data.segments) {
            message = { segments: data.segments };
        } else {
            // Fallback for old format
            const color = data.color || null;
            message = { segments: [{ text: data.text, color }] };
        }
        setConsoleLines && setConsoleLines(prev => [...prev, message]);
    });

    socket.on('console_meta', data => {
        setConnectionStatus('connected');
        if (data.viewer_id && window.viewerId && data.viewer_id !== window.viewerId) return;
        setConsoleInteractiveEnabled && setConsoleInteractiveEnabled(Boolean(data.enabled));
    });

    socket.on('viewer_meta', data => {
        setConnectionStatus('connected');
        if (data.viewer_id && window.viewerId && data.viewer_id !== window.viewerId) return;
        setViewerScriptName && setViewerScriptName(data.script_name || null);
    });

    socket.on('viewer_session_started', data => {
        setConnectionStatus('connected');
        if (data.viewer_id && window.viewerId && data.viewer_id !== window.viewerId) return;

        onViewerSessionStarted && onViewerSessionStarted();

        const req = {};
        if (window.viewerId) req.viewer_id = window.viewerId;
        socket.emit('request_state', req);
    });

    // Handlers for simple state requests -- should follow "request_{eventName} pattern:
    const queryHandlers = {
        request_camera_info: () => {
            const cam = cameraData(sceneManagerRef.current.camera, sceneManagerRef.current.controls);
            return { data: cam };
        },
        request_selected_object: () => {
            const obj = sceneManagerRef.current.getSelectedObject();
            return { data: obj ? obj.data.id : null };
        },
        request_screenshot: data => {
            if (!sceneManagerRef.current) return { data: null };
            const width = data && data.width !== undefined ? data.width : undefined;
            const height = data && data.height !== undefined ? data.height : undefined;
            const screenshot = sceneManagerRef.current.getScreenshot(data.bg_color, width, height);
            return { data: screenshot };
        },
        request_selection_info: () => {
            if (!sceneManagerRef.current) return { data: null };
            return { data: sceneManagerRef.current.getSelectionInfo() };
        }
    };
    Object.entries(queryHandlers).forEach(([reqEvent, handler]) => {
        const resEvent = reqEvent.replace('request_', '');
        socket.on(reqEvent, data => {
            setConnectionStatus('connected');
            console.log('received request for', reqEvent, 'with data', data);
            if (data.viewer_id && window.viewerId && data.viewer_id !== window.viewerId) return;
            if (!sceneManagerRef.current) return;
            const payload = { ...handler(data), event: reqEvent };
            if (window.viewerId) payload.viewer_id = window.viewerId;
            socket.emit(resEvent, payload);
        });
    });
    // ---------


    // Handle errors:
    socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        setConnectionStatus('disconnected');
        setPing(null);
    });

    socket.io.on('reconnect_failed', err => {
        console.error('Reconnect failed:', err);
        setConnectionStatus('disconnected');
        setPing(null);
      });

    socket.io.on('reconnect_error', err => {
        console.error('Reconnect error:', err);
        setConnectionStatus('disconnected');
        setPing(null);
    });

    socket.io.on('reconnect_attempt', () => {
        console.log('Reconnect attempt');
        setConnectionStatus('disconnected');
        setPing(null);
    });

    return socket;
}
