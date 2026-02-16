// panopti/server/static/js/main.js
import { Buffer } from 'buffer';
// @ts-ignore
window.Buffer = Buffer;
import React, { lazy } from 'react';
import ReactDOM from 'react-dom';
import { marked } from 'marked';
import { initComms } from './comms.js'; 
import Plotly from 'plotly.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { evaluate } from 'mathjs';

import { downloadFileFromBase64, cameraData, debounce, createFpsCap } from './utils.js';
import { setConstantsFromConfig } from './constants.js';
import { createSceneManager } from './sceneManager.js';
import { initTooltips } from './tooltip.js';
import {
    handleSliderChange as uiHandleSliderChange,
    handleSliderInputCommit as uiHandleSliderInputCommit,
    handleSliderArrow as uiHandleSliderArrow,
    handleButtonClick as uiHandleButtonClick,
    handleCheckboxChange as uiHandleCheckboxChange,
    handleDropdownChange as uiHandleDropdownChange,
    handleColorChange as uiHandleColorChange,
    renderControl as renderUIControl
} from './uiControls.js';
import {
    changeBackgroundColor as bgColor,
    resetCamera as resetCam,
    toggleRenderSetting as toggleSetting,
    updateLightSetting as updateLight,
    captureCurrentView as captureView,
    renderToClipboard as copyToClipboard,
    saveImage as saveImg,
    discardImage as discardImg,
    renderSceneToolbar as sceneToolbar,
    renderRenderToolbar as renderToolbar,
    renderLightingToolbar as lightingToolbar
} from './toolbars.js';
import {
    exportObject as exportObj,
    toggleObjectVisibility as toggleVisibility,
    toggleAnimatedMeshPlayback as togglePlayback,
    renderLayersPanel as layersPanel
} from './layersPanel.js';
import { renderInfoBar } from './infoBar.js';
import ConsoleWindow from './console.js';
import WidgetPanel from './widgetPanel.js';

'use strict';
console.log('PANOPTI CONFIG: ', window.panoptiConfig);

function applyThemeVars(theme) {
    if (!theme) return;
    const root = document.documentElement;
    for (const [k, v] of Object.entries(theme)) {
        root.style.setProperty(`--${k}`, v);
    }
}

function resolveThemeBackground(theme) {
    if (!theme) return '#0b1118';
    return theme['dark-mode'] ? theme['background-color-dark'] : theme['background-color'];
}

const App = () => {
    
    // Global config:
    const [config, setConfig] = React.useState(window.panoptiConfig);
    const [maxFps, setMaxFps] = React.useState(60);
    const fpsCapRef = React.useRef(null);

    // Controls panel:
    const [controls, setControls] = React.useState([]);
    const [isPanelCollapsed, setIsPanelCollapsed] = React.useState(false);
    const [panelTransitionClass, setPanelTransitionClass] = React.useState('');

    const [isLoading, setIsLoading] = React.useState(true);

    // ThreeJS Viewer:
    const [backgroundColor, setBackgroundColor] = React.useState(() =>
        resolveThemeBackground(window.panoptiConfig?.viewer?.theme)
    );
    const [sceneObjects, setSceneObjects] = React.useState([]);
    const [selectedObject, setSelectedObject] = React.useState(null);
    const [renderSettings, setRenderSettings] = React.useState({
        wireframe: false,
        flatShading: false,
        showNormals: false,
        showGrid: true,
        showAxes: true,
        inspectMode: false,
        powerPreference: 'default'
    });
    const [gizmoEnabled, setGizmoEnabled] = React.useState(false);
    const [lightSettings, setLightSettings] = React.useState({
        ambientColor: '#ffffff',
        ambientIntensity: 0.5,
        directionalColor: '#ffffff',
        directionalIntensity: 0.7
    });
    const [showRenderModal, setShowRenderModal] = React.useState(false);
    const [capturedImage, setCapturedImage] = React.useState(null);

    // Transformation panel:
    const [transformState, setTransformState] = React.useState({
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1]
    });
    const [lockScale, setLockScale] = React.useState(false);
    const transformStateRef = React.useRef(transformState);
    const lockScaleRef = React.useRef(lockScale);

    // Console:
    const [consoleLines, setConsoleLines] = React.useState([]);
    const [showConsole, setShowConsole] = React.useState(false);
    const [consolePos, setConsolePos] = React.useState({ x: 50, y: 50 });
    const [consoleSize, setConsoleSize] = React.useState({ width: 550, height: 250 });

    // Status alerts:
    const [connectionStatus, setConnectionStatus] = React.useState('disconnected');
    const [scriptStatus, setScriptStatus] = React.useState('unknown');
    const [lastHeartbeat, setLastHeartbeat] = React.useState(Date.now() - 10000);
    const [ping, setPing] = React.useState(null);
    const heartbeatSentAtRef = React.useRef(null);
    
    const [isLayersPanelCollapsed, setIsLayersPanelCollapsed] = React.useState(false);
    const [showInfoBar, setShowInfoBar] = React.useState(true);

    // Widgets:
    const [widgets, setWidgets] = React.useState([
        // {
        //     id: 'widget1',
        //     title: 'Statistics',
        //     icon: 'fas fa-chart-bar',
        //     isOpen: false,
        //     pos: { x: 100, y: 100 },
        //     content: React.createElement('div', null, 
        //         // React.createElement('h3', null, 'Scene Statistics'),
        //         React.createElement('p', null, 'Total Objects: ', sceneObjects.length),
        //         React.createElement('p', null, 'Selected Object: ', selectedObject ? selectedObject.data.id : 'None'),
        //         React.createElement('p', null, 'Connection: ', connectionStatus)
        //     )
        // },
        // {
        //     id: 'widget2', 
        //     title: 'Settings',
        //     icon: 'fas fa-cog',
        //     isOpen: false,
        //     pos: { x: 150, y: 150 },
        //     content: React.createElement('div', null,
        //         // React.createElement('h3', null, 'Render Settings'),
        //         React.createElement('p', null, 'Wireframe: ', renderSettings.wireframe),
        //         React.createElement('p', null, 'Flat Shading: ', renderSettings.flatShading ? 'On' : 'Off'),
        //         React.createElement('p', null, 'Show Grid: ', renderSettings.showGrid ? 'On' : 'Off'),
        //         React.createElement('p', null, 'Show Axes: ', renderSettings.showAxes ? 'On' : 'Off')
        //     )
        // }
    ]);

    const consoleRef = React.useRef(null);
    const dragRef = React.useRef(null);
    const sceneRef = React.useRef(null);
    const rendererRef = React.useRef(null);
    const sceneManagerRef = React.useRef(null);
    const socketRef = React.useRef(null);

    // Load config from injected data or fallback defaults
    React.useEffect(() => {
        const injectedConfig = window.panoptiConfig;
        const cfg = injectedConfig || getFallbackDefaults();
        
        setConfig(cfg);

        setConstantsFromConfig(cfg);

        setMaxFps(cfg.viewer.renderer['max-fps']);

        // Apply theme variables to CSS
        if (cfg.viewer.theme['dark-mode']) {
            changeBackgroundColor(cfg.viewer.theme['background-color-dark']);
            setBackgroundColor(cfg.viewer.theme['background-color-dark']);
        } else {
            changeBackgroundColor(cfg.viewer.theme['background-color']);
            setBackgroundColor(cfg.viewer.theme['background-color']);
        }
        applyThemeVars(cfg.viewer.theme);
        
        // Set initial UI state
        setIsPanelCollapsed(cfg.viewer.ui.panel.controls.collapsed);
        setIsLayersPanelCollapsed(cfg.viewer.ui.panel.layers.collapsed);
        
        // Set render settings (tools)
        setRenderSettings(prev => ({
            ...prev,
            showGrid: cfg.viewer.tools.grid.enabled,
            showAxes: cfg.viewer.tools.axes.enabled,
            powerPreference: cfg.viewer.renderer['power-preference']
        }));
        
        // Set console and infobar visibility
        setShowConsole(cfg.viewer.ui.console.enabled);
        setShowInfoBar(cfg.viewer.ui.infobar.enabled);
        
        // Update camera if SceneManager is ready
        if (sceneManagerRef.current) {
            sceneManagerRef.current.setCamera({
                position: cfg.viewer.camera.position,
                target: cfg.viewer.camera.target,
                fov: cfg.viewer.camera.fov,
                near: cfg.viewer.camera.near,
                far: cfg.viewer.camera.far
            });
        }
    }, []);

    React.useEffect(() => {
        if (selectedObject && selectedObject.data && selectedObject.data.position) {
            const newState = {
                position: [...selectedObject.data.position],
                rotation: [...selectedObject.data.rotation],
                scale: [...selectedObject.data.scale]
            };
            setTransformState(newState);
            transformStateRef.current = newState;
        }
    }, [selectedObject]);
    
    React.useEffect(() => {
        const socket = initComms(sceneManagerRef, { 
            setIsLoading, 
            setControls, 
            setConsoleLines,
            setConnectionStatus,
            setPing
        });
        socketRef.current = socket;

        const container = sceneRef.current;
        const { clientWidth, clientHeight } = container;
        
        // Create SceneManager with config from injected data
        const injectedConfig = window.panoptiConfig || getFallbackDefaults();
        const initialBackgroundColor = resolveThemeBackground(injectedConfig?.viewer?.theme);
        const SceneManager = createSceneManager(
            container,
            socketRef.current,
            {
                onSelectObject: setSelectedObject,
                onSceneObjectsChange: updateSceneObjectsList
            },
            initialBackgroundColor,
            injectedConfig.viewer.camera,
        );
        sceneManagerRef.current = SceneManager;
        rendererRef.current = SceneManager.renderer;
        
        // Observe container resize using ResizeObserver
        const resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                SceneManager.onWindowResize(width, height);
            }
        });

        resizeObserver.observe(container);
        
        // FPS-throttled render loop:
        fpsCapRef.current = createFpsCap( sceneManagerRef.current.update, maxFps );

        function onAnimationFrame( time ) {
            fpsCapRef.current.loop( time );
            requestAnimationFrame( onAnimationFrame );
        }
        requestAnimationFrame( onAnimationFrame );
        
        return () => {
            // Clear the debounced functions reference
            debouncedSliderEmitRef.current = {};
            
            resizeObserver.disconnect();
            socket.disconnect();
            if (sceneManagerRef.current) {
                sceneManagerRef.current.dispose();
            }
        };
    }, []);

    // Register client_heartbeat handler
    React.useEffect(() => {
        if (!socketRef.current) return;
        const handler = (data) => {
            if (data.viewer_id && window.viewerId && data.viewer_id !== window.viewerId) return;
            setLastHeartbeat(Date.now());
            setScriptStatus('running');
            if (heartbeatSentAtRef.current) {
                const latency = Date.now() - heartbeatSentAtRef.current;
                setPing(latency);
            }
        };
        socketRef.current.on('client_heartbeat', handler);
        return () => {
            socketRef.current.off('client_heartbeat', handler);
        };
    }, []);

    React.useEffect(() => {
        function heartbeatInterval() {
            if (socketRef.current) {
                heartbeatSentAtRef.current = Date.now();
                socketRef.current.emit('viewer_heartbeat', { viewer_id: window.viewerId });
            }
            if (lastHeartbeat) {
                const timeSinceLastHeartbeat = Date.now() - lastHeartbeat;
                if (timeSinceLastHeartbeat > 5000) {
                    setScriptStatus('terminated');
                }
            }
        }

        const intervalId = setInterval(heartbeatInterval, 3000);
        return () => clearInterval(intervalId);
    }, [lastHeartbeat]);

    // Effect to resize the renderer when panel is collapsed/expanded
    React.useEffect(() => {
        // Force an immediate resize
        if (sceneManagerRef.current) {
            sceneManagerRef.current.onWindowResize();
        }
        
        const resizeTimeout = setTimeout(() => {
            if (sceneManagerRef.current) {
                sceneManagerRef.current.onWindowResize();
            }
        }, 160);
        
        return () => clearTimeout(resizeTimeout);
    }, [isPanelCollapsed]);
    
    React.useEffect(() => {
        if (sceneManagerRef.current) {
            sceneManagerRef.current.applyRenderSettings(renderSettings);
        }
    }, [renderSettings]);
    
    React.useEffect(() => {
        if (sceneManagerRef.current) {
            updateSceneObjectsList();
        }
    }, [sceneManagerRef.current]);

    // Recreate FPS cap when maxFps changes
    React.useEffect(() => {
        if (sceneManagerRef.current) {
            fpsCapRef.current = createFpsCap(sceneManagerRef.current.update, maxFps);
        }
    }, [maxFps]);

    React.useEffect(() => {
        if (showConsole && consoleRef.current) {
            consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
        }
    }, [consoleLines, showConsole]);

    React.useEffect(() => {
        setTimeout(() => {
            controls.forEach(c => {
                if (c.type === 'plotly') {
                    const el = document.getElementById(`plotly-${c.id}`);
                    if (el) {
                        Plotly.react(el, c.spec.data || [], c.spec.layout || {}, c.spec.config || {});
                    }
                }
            });
        }, 0);
    }, [controls]);
    
    const updateSceneObjectsList = () => {
        if (sceneManagerRef.current) {
            setSceneObjects(sceneManagerRef.current.getAllObjects());
        }
    };
    
    const debouncedSliderEmitRef = React.useRef({});

    const handleSliderChange = (id, value) =>
        uiHandleSliderChange(controls, socketRef, debouncedSliderEmitRef, id, value);
    const handleSliderInputCommit = (id, value) =>
        uiHandleSliderInputCommit(controls, socketRef, debouncedSliderEmitRef, id, value);
    const handleSliderArrow = (id, dir) =>
        uiHandleSliderArrow(controls, socketRef, debouncedSliderEmitRef, id, dir);
    const handleButtonClick = (id) => uiHandleButtonClick(socketRef, id);
    const handleCheckboxChange = (id, checked) =>
        uiHandleCheckboxChange(socketRef, id, checked);
    const handleDropdownChange = (id, value) =>
        uiHandleDropdownChange(socketRef, id, value);
    const handleColorChange = (id, value) =>
        uiHandleColorChange(socketRef, id, value);
    
    const handlePanelCollapseToggle = () => {
        if (!isPanelCollapsed) {
            setPanelTransitionClass('panel-collapsing');
            setIsPanelCollapsed(true);
            setTimeout(() => setPanelTransitionClass(''), 0);
        } else {
            setPanelTransitionClass('panel-expanding');
            setIsPanelCollapsed(false);
            // Remove class after expand transition
            setTimeout(() => setPanelTransitionClass(''), 140);
        }
    };
    
    const changeBackgroundColor = (color) =>
        bgColor(sceneManagerRef, setBackgroundColor, color);

    const toggleBackgroundColor = () => {
        const isDark = backgroundColor === config.viewer.theme['background-color-dark'];
        const newColor = isDark ? config.viewer.theme['background-color'] : config.viewer.theme['background-color-dark'];
        changeBackgroundColor(newColor);
    };

    const resetCamera = () => resetCam(sceneManagerRef);
    
    const refreshState = () => {
        // Clear existing objects and controls
        if (sceneManagerRef.current) {
            sceneManagerRef.current.clearAllObjects();
        }
        setControls([]);
        setSelectedObject(null);
        socketRef.current.emit('request_state', { viewer_id: window.viewerId });
    };

    const restartConsoleMessage = { segments: [ { text: "-------------------------------\n[Panopti] Restarting script...\n-------------------------------\n", color: "yellow" } ] };
    const restartScript = () => {
        setScriptStatus('restarting');
        setConsoleLines(prev => [...prev, restartConsoleMessage]);
        const payload = {};
        if (window.viewerId) payload.viewer_id = window.viewerId;
        socketRef.current.emit('restart_script', payload);
        refreshState();
    };

    const applyTransforms = (updates) => {
        if (!sceneManagerRef.current || !selectedObject) return;
        sceneManagerRef.current.updateObject(selectedObject.data.id, updates);
        const payload = { id: selectedObject.data.id, updates };
        if (window.viewerId) payload.viewer_id = window.viewerId;
        socketRef.current.emit('update_object', payload);
    };

    const handleTransformCommit = (type, index, value) => {
        let num;
        try {
            if (typeof value === 'string' && value.trim() !== '') {
                num = evaluate(value);
            }
        } catch (err) {
            num = NaN;
        }
        if (typeof num !== 'number' || isNaN(num)) {
            num = transformState[type][index];
            console.warn(`Invalid input for ${type}[${index}]:`, value, 'Using previous value:', num);
        }
        let currentState = transformStateRef.current;
        let arr = [...currentState[type]];
        if (type === 'scale' && lockScaleRef.current) {
            const ratio = num / arr[index];
            arr = arr.map(v => v * ratio);
        } else {
            arr[index] = num;
        }
        applyTransforms({ [type]: arr });
        const newState = { ...currentState, [type]: arr };
        setTransformState(newState);
        transformStateRef.current = newState;
    };

    const handleTransformArrow = (type, index, dir) => {
        const step = 0.1;
        let currentState = transformStateRef.current;
        let arr = [...currentState[type]];
        const prevVal = arr[index];
        const val = prevVal + dir * step;
        if (type === 'scale' && lockScaleRef.current) {
            const ratio = val / prevVal;
            arr = arr.map(v => v * ratio);
        } else {
            arr[index] = prevVal + dir * step;
        }
        applyTransforms({ [type]: arr });
        const newState = { ...currentState, [type]: arr };
        setTransformState(newState);
        transformStateRef.current = newState;
    };

    const toggleScaleLock = () => {
        setLockScale(prev => {
            lockScaleRef.current = !prev;
            return !prev;
        });
    };

    const resetTransform = () => {
        const defaults = { position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] };
        applyTransforms(defaults);
        const newState = { ...transformState, ...defaults };
        setTransformState(newState);
        transformStateRef.current = newState;
    };

    const toggleConsole = () => setShowConsole(prev => !prev);

    const runConsoleCommand = (command) => {
        if (!socketRef.current) return;
        const trimmed = command.trim();
        if (!trimmed) return;

        setConsoleLines(prev => [
            ...prev,
            { segments: [{ text: `>>> ${command}\n`, color: 'bright-cyan' }] }
        ]);

        const payload = { command };
        if (window.viewerId) payload.viewer_id = window.viewerId;
        socketRef.current.emit('console_command', payload);
    };

    const toggleWidget = (widgetId) => {
        setWidgets(prev => prev.map(widget => 
            widget.id === widgetId 
                ? { ...widget, isOpen: !widget.isOpen }
                : widget
        ));
    };

    const minimizeWidget = (widgetId) => {
        setWidgets(prev => prev.map(widget => 
            widget.id === widgetId 
                ? { ...widget, isOpen: false }
                : widget
        ));
    };

    const updateWidgetPosition = (widgetId, newPos) => {
        setWidgets(prev => prev.map(widget => 
            widget.id === widgetId 
                ? { ...widget, pos: newPos }
                : widget
        ));
    };
    
    const toggleRenderSetting = (setting, value) =>
        toggleSetting(sceneManagerRef, setRenderSettings, setting, value);

    const updateLightSetting = (setting, value) =>
        updateLight(sceneManagerRef, setLightSettings, setting, value);
    
    const toggleGizmo = () => {
        const newEnabled = !gizmoEnabled;
        setGizmoEnabled(newEnabled);
        if (sceneManagerRef.current) {
            sceneManagerRef.current.setGizmoEnabled(newEnabled);
        }
    };
    
    const exportObject = exportObj;

    // Toggle object visibility with 3 states: visible, semi-transparent, hidden
    const toggleObjectVisibility = (objectId) =>
        toggleVisibility(sceneManagerRef, sceneObjects, objectId, updateSceneObjectsList);

    // Toggle animated mesh playback
    const toggleAnimatedMeshPlayback = (objectId) =>
        togglePlayback(sceneManagerRef, objectId, updateSceneObjectsList);
    
    const renderControl = (control) =>
        renderUIControl(control, {
            handleSliderChange,
            handleSliderInputCommit,
            handleSliderArrow,
            handleButtonClick,
            handleCheckboxChange,
            handleDropdownChange,
            handleColorChange
        });
    
    // Render capture functions
    const captureCurrentView = () =>
        captureView(rendererRef, sceneManagerRef, setCapturedImage, setShowRenderModal);

    const renderToClipboard = () =>
        copyToClipboard(rendererRef, sceneManagerRef);

    const saveImage = () =>
        saveImg(capturedImage, setShowRenderModal, setCapturedImage);

    const discardImage = () =>
        discardImg(setShowRenderModal, setCapturedImage);
    
    // Create Scene Toolbar
    const renderSceneToolbar = () =>
        sceneToolbar({
            resetCamera,
            toggleBackgroundColor,
            refreshState,
            restartScript,
            toggleConsole,
            isDark: backgroundColor === config.viewer.theme['background-color-dark'],
        });
    
    // Create Render Toolbar
    const renderRenderToolbar = () =>
        renderToolbar(renderSettings, toggleRenderSetting, captureCurrentView, renderToClipboard, gizmoEnabled, toggleGizmo);
    
    // Create Lighting Toolbar
    const renderLightingToolbar = () =>
        lightingToolbar(lightSettings, updateLightSetting);

    // Render Layers Panel
    const renderLayersPanel = () =>
        layersPanel(
            sceneObjects,
            selectedObject,
            setSelectedObject,
            sceneManagerRef,
            updateSceneObjectsList,
            isLayersPanelCollapsed,
            () => setIsLayersPanelCollapsed((prev) => !prev)
        );

    const renderTransformPanel = () => {
        if (!selectedObject || !selectedObject.data.position) return null;
        const fields = (type) =>
            [0,1,2].map(i =>
                React.createElement(
                    'div',
                    { className: 'slider-value-container', key: i },
                    React.createElement('i', {
                        className: 'fas fa-chevron-left slider-btn',
                        onClick: () => handleTransformArrow(type, i, -1)
                    }),
                    React.createElement('input', {
                        type: 'text',
                        className: 'slider-value',
                        style: { width: '40px' },
                        value: transformState[type][i],
                        onChange: (e) => {
                            const val = e.target.value; // just update display
                            setTransformState(prev => {
                                const arr = [...prev[type]];
                                arr[i] = val;
                                return { ...prev, [type]: arr };
                            });
                        },
                        onBlur: (e) => handleTransformCommit(type, i, e.target.value),
                        onKeyDown: (e) => { if (e.key === 'Enter') { e.target.blur(); } }
                    }),
                    React.createElement('i', {
                        className: 'fas fa-chevron-right slider-btn',
                        onClick: () => handleTransformArrow(type, i, 1)
                    })
                )
            );

        return React.createElement(
            'div',
            { className: 'transform-panel' },
            React.createElement(
                'div',
                { className: 'transform-row', style: { display: 'flex', alignItems: 'center', marginBottom: '10px' } },
                React.createElement(
                    'label',
                    { style: { marginRight: '0.5em', fontWeight: 'bold' } },
                    'T'
                ),
                React.createElement(
                    'div',
                    { className: 'vector-fields', style: { display: 'flex', gap: '10px' } },
                    ...fields('position')
                )
            ),
            React.createElement(
                'div',
                { className: 'transform-row', style: { display: 'flex', alignItems: 'center', marginBottom: '10px' } },
                React.createElement(
                    'label',
                    { style: { marginRight: '0.5em', fontWeight: 'bold'} },
                    'R'
                ),
                React.createElement(
                    'div',
                    { className: 'vector-fields', style: { display: 'flex', gap: '10px' } },
                    ...fields('rotation')
                )
            ),
            React.createElement(
                'div',
                { className: 'transform-row', style: { display: 'flex', alignItems: 'center', marginBottom: '10px' } },
                React.createElement(
                    'label',
                    { style: { marginRight: '0.5em', fontWeight: 'bold'} },
                    'S'
                ),
                React.createElement(
                    'div',
                    { className: 'vector-fields', style: { display: 'flex', gap: '10px' } },
                    ...fields('scale')
                )
            ),
            React.createElement(
                'div',
                { className: 'transform-lock-reset' },
                React.createElement(
                    'button',
                    { className: 'lock-btn tooltip', onClick: toggleScaleLock, 'data-tooltip': lockScale ? 'Unlock aspect ratio' : 'Lock aspect ratio' },
                    React.createElement('i', { className: lockScale ? 'fas fa-lock' : 'fas fa-lock-open' })
                ),
                React.createElement(
                    'button',
                    { className: 'reset-btn', onClick: resetTransform },
                    'Reset'
                )
            )
        );
    };
    
    // Loading Overlay
    const renderLoadingOverlay = () => {
        if (!isLoading) return null;
        
        return React.createElement(
            'div',
            { className: 'loading-overlay' },
            React.createElement('div', { className: 'spinner' })
        );
    };

    return React.createElement(
        'div',
        { className: "viewer-container", style: { position: 'relative' } },
        React.createElement(
            'div',
            {
                className: "scene-container",
                ref: sceneRef
            },
            renderSceneToolbar(),
            renderRenderToolbar(),
            // renderLightingToolbar(),
            renderTransformPanel(),
            showInfoBar && renderInfoBar(selectedObject, connectionStatus, scriptStatus, ping, widgets, toggleWidget),
            renderLayersPanel(),
            React.createElement(ConsoleWindow, {
                consoleLines,
                setConsoleLines,
                consolePos,
                setConsolePos,
                consoleSize,
                setConsoleSize,
                toggleConsole,
                showConsole,
                consoleRef,
                onSubmitCommand: runConsoleCommand,
            }),
            // Render widget panels
            widgets.map(widget => 
                React.createElement(WidgetPanel, {
                    key: widget.id,
                    showWidget: widget.isOpen,
                    widgetId: widget.id,
                    widgetTitle: widget.title,
                    widgetContent: widget.content,
                    widgetPos: widget.pos,
                    setWidgetPos: (newPos) => updateWidgetPosition(widget.id, newPos),
                    onMinimize: minimizeWidget,
                    dragRef
                })
            )
        ),
        React.createElement(
            'div',
            { 
                className: `ui-panel${isPanelCollapsed ? ' panel-collapsed' : ''}${panelTransitionClass ? ' ' + panelTransitionClass : ''}`
            },
            React.createElement(
                'div',
                { className: 'ui-panel-header' },
                React.createElement(
                    'div',
                    { className: 'ui-panel-header-content' },
                    React.createElement(
                        'button',
                        {
                            className: 'collapse-ui-panel-btn',
                            onClick: (e) => { e.stopPropagation(); handlePanelCollapseToggle(); },
                            style: { transform: isPanelCollapsed ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }
                        },
                        React.createElement('i', { className: 'fas fa-chevron-right' })
                    ),
                    React.createElement('h2', null, config.title || "Panopti"),
                    config.subtitle && React.createElement('div', { className: 'ui-panel-subtitle' }, config.subtitle)
                )
            ),
            React.createElement(
                'div',
                { className: 'ui-panel-content' },
                controls.length > 0 
                    ? controls.map(renderControl)
                    : React.createElement('p', null, "No controls available.")
            )
        ),
        isPanelCollapsed && React.createElement(
            'button',
            {
                className: 'floating-ui-panel-caret',
                onClick: handlePanelCollapseToggle
            },
            React.createElement('i', { className: 'fas fa-chevron-left' })
        ),
        // Render Modal
        showRenderModal && React.createElement(
            'div',
            { className: 'modal-overlay', onClick: discardImage },
            React.createElement(
                'div',
                { 
                    className: 'modal-content',
                    onClick: (e) => e.stopPropagation()
                },
                React.createElement('h3', null, 'Rendered View'),
                React.createElement('img', {
                    src: capturedImage,
                    alt: 'Rendered view',
                    style: { maxWidth: '100%', maxHeight: '400px' }
                }),
                React.createElement(
                    'div',
                    { className: 'modal-buttons' },
                    React.createElement(
                        'button',
                        { 
                            className: 'modal-btn save-btn',
                            onClick: saveImage
                        },
                        'Save As'
                    ),
                    React.createElement(
                        'button',
                        { 
                            className: 'modal-btn discard-btn',
                            onClick: discardImage
                        },
                        'Discard'
                    )
                )
            )
        ),
    );
};

ReactDOM.render(
    React.createElement(App),
    document.getElementById('app')
);

initTooltips();

// import hack to avoid dev server error
const ChromePicker = React.lazy(() => import('@uiw/react-color').then(module => ({ default: module.ChromePicker })));
