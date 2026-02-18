import * as THREE from 'three';
import { decode as msgpackDecode } from '@msgpack/msgpack';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VertexNormalsHelper } from 'three/addons/helpers/VertexNormalsHelper.js';
import { downloadFileFromBase64, cameraData } from './utils.js';
import { debounce, throttle } from './utils.js';
import * as CONSTANTS from './constants.js';
import { createMaterial, updateMaterial } from './materials.js';
import { Gizmo } from './gizmo.js';
import { createSelectionHelpers, SELECTION_MODE_DEFAULTS } from './selectionTools.js';
import { SlicingPlaneController } from './slicingPlane.js';

function bufferToTypedArray(buf, dtype) {
    // msgpack returns a Uint8Array for binary payloads. When constructing
    // typed arrays we must use the underlying ArrayBuffer; otherwise each
    // byte is interpreted as a separate element.
    const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    switch (dtype) {
        case 'float32':
            return new Float32Array(arrayBuf);
        case 'float64':
            return new Float64Array(arrayBuf);
        case 'int32':
            return new Int32Array(arrayBuf);
        case 'uint32':
            return new Uint32Array(arrayBuf);
        case 'uint8':
            return new Uint8Array(arrayBuf);
        case 'bool':
            return new Uint8Array(arrayBuf);
        default:
            return new Float32Array(arrayBuf);
    }
}

function unpackMsgpack(obj) {
    if (Array.isArray(obj)) {
        return obj.map(unpackMsgpack);
    }
    if (obj && typeof obj === 'object') {
        if (obj.__ndarray__) {
            const arr = bufferToTypedArray(obj.__ndarray__, obj.dtype);
            const shape = obj.shape || [];
            if (shape.length <= 1) {
                return Array.from(arr);
            }
            const out = [];
            const step = shape.slice(1).reduce((a,b)=>a*b,1);
            for (let i=0;i<shape[0];i++) {
                out.push(Array.from(arr.slice(i*step,(i+1)*step)));
            }
            return out;
        }
        const res = {};
        Object.entries(obj).forEach(([k,v]) => res[k] = unpackMsgpack(v));
        return res;
    }
    return obj;
}

function isDisplaySpaceRgb(r, g, b) {
    return Number.isFinite(r) &&
        Number.isFinite(g) &&
        Number.isFinite(b) &&
        r >= 0 && r <= 1 &&
        g >= 0 && g <= 1 &&
        b >= 0 && b <= 1;
}

function srgbToLinearChannel(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function toLinearColorArray(colors) {
    const linearColors = new Float32Array(colors.length);
    for (let i = 0; i < colors.length; i++) {
        const c = colors[i];
        if (Number.isFinite(c) && c >= 0 && c <= 1) {
            linearColors[i] = srgbToLinearChannel(c);
        } else {
            linearColors[i] = c;
        }
    }
    return linearColors;
}

const TONE_MAPPING_MAP = {
    none: THREE.NoToneMapping,
    linear: THREE.LinearToneMapping,
    reinhard: THREE.ReinhardToneMapping,
    cineon: THREE.CineonToneMapping,
    acesfilmic: THREE.ACESFilmicToneMapping
};

if (THREE['AgXToneMapping'] !== undefined) {
    TONE_MAPPING_MAP.agx = THREE['AgXToneMapping'];
}

function parseToneMapping(toneMapping, fallback = THREE.ACESFilmicToneMapping) {
    if (typeof toneMapping === 'number') {
        return toneMapping;
    }
    if (typeof toneMapping !== 'string') {
        return fallback;
    }

    const normalized = toneMapping.toLowerCase().replace(/[\s_-]+/g, '');
    return TONE_MAPPING_MAP[normalized] ?? fallback;
}

function parseToneMappingExposure(exposure, fallback = 0.95) {
    const parsed = Number(exposure);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
}

// Helper to parse hex color or rgb array
function parseColor(color) {
    if (typeof color === 'string' || typeof color === 'number') {
        return new THREE.Color(color);
    }

    if (Array.isArray(color) && color.length >= 3) {
        const [r, g, b] = color;
        if (isDisplaySpaceRgb(r, g, b)) {
            return new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
        }
        return new THREE.Color(r, g, b);
    }

    return new THREE.Color(0xffffff);
}

// Helper to add a light from config
function addLightFromConfig(scene, lightConfig) {
    let light;
    // type, color, intensity are required
    const type = lightConfig.type;
    const color = parseColor(lightConfig.color);
    const intensity = lightConfig.intensity;
    if (type === undefined || color === undefined || intensity === undefined) {
        return;
    }
    // optional: castShadow, target (for directional light)
    let castShadow = lightConfig.castShadow === undefined ? false : lightConfig.castShadow;
    let target = lightConfig.target === undefined ? [0, 0, 0] : lightConfig.target;
    if (type === 'directional') {
        light = new THREE.DirectionalLight(color, intensity);
        if (lightConfig.position) {
            light.position.set(...lightConfig.position);
        }
        light.target.position.set(...target);
    } else if (type === 'ambient') {
        light = new THREE.AmbientLight(color, intensity);
        castShadow = false;
    } else if (type === 'point') {
        light = new THREE.PointLight(color, intensity);
        if (lightConfig.position) {
            light.position.set(...lightConfig.position);
        }
    }
    if (light) {
        light.castShadow = castShadow;
        scene.add(light);
    }
    return light;
}

// Utility: Expand vertices for non-indexed geometry (face colors)
function expandVerticesForNonIndexed(vertices, faces) {
    // vertices: [ [x, y, z], ... ]
    // faces: [ [a, b, c], ... ]
    // Returns: [ [x, y, z], ... ] expanded so each face has unique vertices
    const expanded = [];
    for (let i = 0; i < faces.length; i++) {
        const [a, b, c] = faces[i];
        expanded.push(vertices[a]);
        expanded.push(vertices[b]);
        expanded.push(vertices[c]);
    }
    return expanded;
}

function isFromUIPanelTarget(target) {
    return Boolean(
        target &&
        (
            target.closest('.console-window') ||
            target.closest('.layers-panel') ||
            target.closest('.transform-panel') ||
            target.closest('.ui-panel') ||
            target.closest('.scene-toolbar') ||
            target.closest('.render-toolbar') ||
            target.closest('.lighting-toolbar') ||
            target.closest('.info-bar') ||
            target.closest('.selection-tool-menu')
        )
    );
}

function isTextInputElement(target) {
    if (!target || !(target instanceof Element)) return false;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return true;
    return false;
}

// Main Three.js scene setup:
export function createSceneManager(container, socket, callbacks = {}, backgroundColor = '#f0f0f0', cameraConfig = null, setShowWidget) {
    const { onSelectObject, onSceneObjectsChange } = callbacks;
    THREE.ColorManagement.enabled = true;

    const rendererConfig = window.panoptiConfig.viewer.renderer || {};

    const scene = new THREE.Scene();
    scene.background = parseColor(backgroundColor);

    // --- Parse lights in .panopti.toml ---
    Object.entries(rendererConfig).forEach(([key, value]) => {
        if (key.startsWith('light-')) {
            addLightFromConfig(scene, value);
        }
    });

    // Add camera
    const { clientWidth, clientHeight } = container;
    let camera = new THREE.PerspectiveCamera(
        cameraConfig.fov, clientWidth / clientHeight, cameraConfig.near, cameraConfig.far
    );
    camera.position.set(...cameraConfig.position);
    camera.lookAt(...cameraConfig.target);
    
    let renderSettings = {
        wireframe: 0, // 0: Default (respect per-object), 1: Surface, 2: Wireframe + Surface, 3: Wireframe Only
        flatShading: false,
        showNormals: false,
        showGrid: true,
        showAxes: true,
        inspectMode: false,
    };
    
    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
        powerPreference: rendererConfig['power-preference']
    });

    const toneMapping = parseToneMapping(rendererConfig['tone-mapping']);
    const toneMappingExposure = parseToneMappingExposure(rendererConfig['tone-mapping-exposure']);

    renderer.setSize(clientWidth, clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = toneMapping;
    renderer.toneMappingExposure = toneMappingExposure;
    container.appendChild(renderer.domElement);
    
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.25;

    controls.addEventListener('change', throttle(() => {
        if (socket) {
            const camData = cameraData(camera, controls);
            const payload = { camera: camData };
            if (window.viewerId) payload.viewer_id = window.viewerId;
            socket.emit('events.camera', payload);
        }
    }, CONSTANTS.DEBOUNCE_CAMERA));
    
    // Initialize gizmo (transform controls)
    const gizmo = new Gizmo(scene, camera, renderer, controls, socket);
    
    // Set up gizmo update callback to propagate changes to backend
    gizmo.setUpdateCallback((transforms) => {
        if (slicingPlane.isEnabled() && slicingPlane.isHandle(gizmo.getAttachedObject())) {
            syncSlicingPlaneFromHandle();
            return;
        }

        if (selectedObject && selectedObject.data) {
            const objectId = selectedObject.data.id;
            // Update the object locally
            updateObject(objectId, transforms);
            
            // Emit to backend
            if (socket) {
                const payload = { id: objectId, updates: transforms };
                if (window.viewerId) payload.viewer_id = window.viewerId;
                socket.emit('update_object', payload);
            }
        }
    });
    gizmo.setChangeCallback(() => {
        if (slicingPlane.isEnabled() && slicingPlane.isHandle(gizmo.getAttachedObject())) {
            syncSlicingPlaneFromHandle();
        }
    });

    const gridHelper = new THREE.GridHelper(10, 10);
    scene.add(gridHelper);
    
    const axesHelper = new THREE.AxesHelper(5);
    scene.add(axesHelper);
    
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const normalHelpers = {};
    const objects = {};
    
    let selectedObject = null;
    const slicingPlane = new SlicingPlaneController(scene, renderer);
    let selectionTool = { ...SELECTION_MODE_DEFAULTS };
    const selectionByObject = {};
    let lastSelectionInfo = null;
    const selectionKeyState = { add: false, subtract: false };
    const selectionInteraction = {
        active: false,
        pointerId: null,
        mode: null,
        objectId: null,
        start: [0, 0],
        current: [0, 0],
        points: [],
        stagedSelection: null,
        initialSelection: null,
        previewApplied: false,
        controlsEnabledBefore: true
    };
    const brushCursor = {
        valid: false,
        x: 0,
        y: 0
    };

    function applySlicingPlaneToObject(objData) {
        slicingPlane.applyToObject(objData, selectedObject?.data?.id || null);
    }

    function applySlicingPlaneToAllObjects() {
        slicingPlane.applyToObjects(objects, selectedObject?.data?.id || null);
    }

    function getSelectedSceneObjectData() {
        if (!selectedObject || !selectedObject.data || !selectedObject.data.id) return null;
        return objects[selectedObject.data.id] || null;
    }

    function syncSlicingPlaneFromHandle() {
        slicingPlane.syncPlaneFromHandle();
    }

    function centerSlicingPlaneOnSelectedObject(resetOrientation = false) {
        const target = getSelectedSceneObjectData();
        if (!target || !target.object) return false;
        return slicingPlane.centerOnObject(target.object, resetOrientation);
    }

    function syncGizmoAttachment() {
        if (!gizmo || !gizmo.isEnabled()) {
            gizmo.detach();
            return;
        }

        if (slicingPlane.isEnabled()) {
            gizmo.attach(slicingPlane.getHandle());
            gizmo.setSelectedObject(null);
            return;
        }

        const target = getSelectedSceneObjectData();
        if (target) {
            gizmo.attach(target.object);
            gizmo.setSelectedObject({ type: target.type, data: target.data });
        } else {
            gizmo.detach();
        }
    }

    function setSlicingPlaneEnabled(enabled) {
        const nextEnabled = !!enabled;
        if (!slicingPlane.setEnabled(nextEnabled)) return;

        if (nextEnabled) {
            if (!centerSlicingPlaneOnSelectedObject(true)) {
                slicingPlane.resetToDefault();
            }
        }

        applySlicingPlaneToAllObjects();
        syncGizmoAttachment();
    }

    const selectionHelpers = createSelectionHelpers({
        container,
        getCamera: () => camera,
        raycaster,
        mouse
    });

    const selectionCanvas = document.createElement('canvas');
    selectionCanvas.className = 'selection-overlay-canvas';
    selectionCanvas.style.position = 'absolute';
    selectionCanvas.style.inset = '0';
    selectionCanvas.style.pointerEvents = 'none';
    selectionCanvas.style.zIndex = '11';
    container.appendChild(selectionCanvas);
    const selectionCtx = selectionCanvas.getContext('2d');

    function resizeSelectionCanvas() {
        const rect = container.getBoundingClientRect();
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        selectionCanvas.width = Math.max(1, Math.floor(rect.width * dpr));
        selectionCanvas.height = Math.max(1, Math.floor(rect.height * dpr));
        selectionCanvas.style.width = `${rect.width}px`;
        selectionCanvas.style.height = `${rect.height}px`;
        selectionCtx.setTransform(1, 0, 0, 1, 0, 0);
        selectionCtx.scale(dpr, dpr);
    }

    function clearSelectionOverlayCanvas() {
        const rect = container.getBoundingClientRect();
        selectionCtx.clearRect(0, 0, rect.width, rect.height);
    }

    function drawSelectionOverlayCanvas() {
        clearSelectionOverlayCanvas();
        const showBrushCursor = selectionTool.enabled && selectionTool.mode === 'brush' && brushCursor.valid;
        if (!selectionInteraction.active && !showBrushCursor) return;

        const mode = selectionInteraction.active ? selectionInteraction.mode : 'brush';
        selectionCtx.save();
        selectionCtx.lineWidth = 1.5;
        selectionCtx.strokeStyle = '#4aa8ff';
        selectionCtx.fillStyle = 'rgba(74, 168, 255, 0.15)';
        selectionCtx.setLineDash([4, 3]);

        if (mode === 'box') {
            const [sx, sy] = selectionInteraction.start;
            const [cx, cy] = selectionInteraction.current;
            const x = Math.min(sx, cx);
            const y = Math.min(sy, cy);
            const w = Math.abs(cx - sx);
            const h = Math.abs(cy - sy);
            selectionCtx.fillRect(x, y, w, h);
            selectionCtx.strokeRect(x, y, w, h);
        } else if (mode === 'lasso') {
            const pts = selectionInteraction.points;
            if (pts.length >= 2) {
                selectionCtx.beginPath();
                selectionCtx.moveTo(pts[0][0], pts[0][1]);
                for (let i = 1; i < pts.length; i += 1) {
                    selectionCtx.lineTo(pts[i][0], pts[i][1]);
                }
                selectionCtx.lineTo(selectionInteraction.current[0], selectionInteraction.current[1]);
                selectionCtx.closePath();
                selectionCtx.fill();
                selectionCtx.stroke();
            }
        } else if (mode === 'brush') {
            const cx = selectionInteraction.active ? selectionInteraction.current[0] : brushCursor.x;
            const cy = selectionInteraction.active ? selectionInteraction.current[1] : brushCursor.y;
            const radiusPx = getBrushRadiusPixels();
            selectionCtx.beginPath();
            selectionCtx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
            selectionCtx.fill();
            selectionCtx.stroke();
        }

        selectionCtx.restore();
    }

    resizeSelectionCanvas();
    
    // Create inspection text overlay
    const inspectionDiv = document.createElement('div');
    inspectionDiv.style.position = 'absolute';
    inspectionDiv.style.background = 'rgba(0, 0, 0, 0.8)';
    inspectionDiv.style.color = 'white';
    inspectionDiv.style.padding = '8px 12px';
    inspectionDiv.style.borderRadius = '4px';
    inspectionDiv.style.fontSize = '12px';
    inspectionDiv.style.fontFamily = 'monospace';
    inspectionDiv.style.pointerEvents = 'none';
    inspectionDiv.style.display = 'none';
    inspectionDiv.style.zIndex = '1000';
    inspectionDiv.style.maxWidth = '200px';
    inspectionDiv.style.whiteSpace = 'pre-line';
    container.appendChild(inspectionDiv);

    const inspectionContent = document.createElement('div');
    inspectionContent.style.pointerEvents = 'none';
    inspectionDiv.appendChild(inspectionContent);

    // Close button for inspection overlay
    const closeBtn = document.createElement('span');
    closeBtn.textContent = '✕';
    closeBtn.style.position = 'absolute';
    closeBtn.style.top = '2px';
    closeBtn.style.right = '4px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.pointerEvents = 'auto';
    inspectionDiv.appendChild(closeBtn);
    
    // Visual inspection helpers
    let inspectionHighlight = null;
    let inspectionVertexPoints = null;
    let inspectionPoint = null;
    let inspectionData = null;
    
    // Function to clear inspection highlights
    function clearInspectionHighlights() {
        if (inspectionHighlight) {
            scene.remove(inspectionHighlight);
            if (inspectionHighlight.geometry) inspectionHighlight.geometry.dispose();
            if (inspectionHighlight.material) inspectionHighlight.material.dispose();
            inspectionHighlight = null;
        }
        if (inspectionVertexPoints) {
            scene.remove(inspectionVertexPoints);
            if (inspectionVertexPoints.geometry) inspectionVertexPoints.geometry.dispose();
            if (inspectionVertexPoints.material) inspectionVertexPoints.material.dispose();
            inspectionVertexPoints = null;
        }
        inspectionPoint = null;
        inspectionData = null;
    }

    // Close button handler to hide overlay and clear highlights
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        inspectionDiv.style.display = 'none';
        clearInspectionHighlights();
    });

    function computeBarycentric(p, a, b, c) {
        const v0 = b.clone().sub(a);
        const v1 = c.clone().sub(a);
        const v2 = p.clone().sub(a);
        const d00 = v0.dot(v0);
        const d01 = v0.dot(v1);
        const d11 = v1.dot(v1);
        const d20 = v2.dot(v0);
        const d21 = v2.dot(v1);
        const denom = d00 * d11 - d01 * d01;
        const v = (d11 * d20 - d01 * d21) / denom;
        const w = (d00 * d21 - d01 * d20) / denom;
        const u = 1 - v - w;
        return { u, v, w };
    }

    function getActiveSelectableObjectData() {
        if (!selectedObject || !selectedObject.data || !selectedObject.data.id) return null;
        const objData = objects[selectedObject.data.id];
        if (!objData) return null;
        if (objData.type !== 'mesh' && objData.type !== 'points') return null;
        if (!objData.object.visible) return null;
        return objData;
    }

    function getBrushRadiusPixels(radiusSetting = selectionTool.brushRadius) {
        return selectionHelpers.getBrushRadiusPixels(radiusSetting);
    }

    function getGeometryFaceCount(geometry) {
        return selectionHelpers.getGeometryFaceCount(geometry);
    }

    function getGeometryFaceVertexIndices(geometry, faceIndex) {
        return selectionHelpers.getGeometryFaceVertexIndices(geometry, faceIndex);
    }

    function getTopologyFaceVertexIndices(objData, faceIndex) {
        return selectionHelpers.getTopologyFaceVertexIndices(objData, faceIndex);
    }

    function getDataFaceVertexIndices(objData, faceIndex) {
        return selectionHelpers.getDataFaceVertexIndices(objData, faceIndex);
    }

    function ensureMeshBVH(objData) {
        return selectionHelpers.ensureMeshBVH(objData);
    }

    function invalidateMeshBVH(objData) {
        return selectionHelpers.invalidateMeshBVH(objData);
    }

    function raycastObjectFromLocal(objData, localX, localY, options = {}) {
        return selectionHelpers.raycastObjectFromLocal(objData, localX, localY, options);
    }

    function raycastObjectFromClient(objData, clientX, clientY, options = {}) {
        return selectionHelpers.raycastObjectFromClient(objData, clientX, clientY, options);
    }

    function collectAllMeshSelection(objData) {
        return selectionHelpers.collectAllMeshSelection(objData);
    }

    function collectAllPointsSelection(objData) {
        return selectionHelpers.collectAllPointsSelection(objData);
    }

    function collectRegionSelectionMesh(objData, region, visibleOnly = true) {
        return selectionHelpers.collectRegionSelectionMesh(objData, region, visibleOnly);
    }

    function collectRegionSelectionPoints(objData, region, visibleOnly = true) {
        return selectionHelpers.collectRegionSelectionPoints(objData, region, visibleOnly);
    }

    function collectBrushSelection(objData, clientX, clientY, radius, targetSelection) {
        return selectionHelpers.collectBrushSelection(objData, clientX, clientY, radius, targetSelection);
    }

    function collectBucketSelection(objData, clientX, clientY) {
        return selectionHelpers.collectBucketSelection(
            objData,
            clientX,
            clientY,
            !!selectionTool.bucketSelectComponent
        );
    }

    function ensureObjectSelectionState(objectId, objectType) {
        if (!selectionByObject[objectId]) {
            selectionByObject[objectId] = {
                objectType,
                faceIndices: new Set(),
                vertexIndices: new Set(),
                pointIndices: new Set(),
                overlay: null
            };
        }
        return selectionByObject[objectId];
    }

    function disposeObjectSelectionOverlay(objectId) {
        const state = selectionByObject[objectId];
        if (!state || !state.overlay) return;
        const overlay = state.overlay;
        if (overlay.parent) {
            overlay.parent.remove(overlay);
        }
        if (overlay.geometry) {
            overlay.geometry.dispose();
        }
        if (overlay.material) {
            if (Array.isArray(overlay.material)) {
                overlay.material.forEach(mat => mat.dispose());
            } else {
                overlay.material.dispose();
            }
        }
        state.overlay = null;
    }

    function refreshObjectSelectionOverlay(objectId) {
        const objData = objects[objectId];
        if (!objData) return;
        const state = ensureObjectSelectionState(objectId, objData.type);

        disposeObjectSelectionOverlay(objectId);

        if (objData.type === 'mesh') {
            const selectedFaces = Array.from(state.faceIndices).sort((a, b) => a - b);
            if (!selectedFaces.length) return;

            const sourceGeometry = objData.object.geometry;
            const posAttr = sourceGeometry.getAttribute('position');
            if (!posAttr) return;

            const positions = [];
            const indices = [];
            selectedFaces.forEach((faceIndex, i) => {
                const [a, b, c] = getGeometryFaceVertexIndices(sourceGeometry, faceIndex);
                const base = i * 3;
                positions.push(
                    posAttr.array[a * 3], posAttr.array[a * 3 + 1], posAttr.array[a * 3 + 2],
                    posAttr.array[b * 3], posAttr.array[b * 3 + 1], posAttr.array[b * 3 + 2],
                    posAttr.array[c * 3], posAttr.array[c * 3 + 1], posAttr.array[c * 3 + 2]
                );
                indices.push(base, base + 1, base + 2);
            });

            const overlayGeometry = new THREE.BufferGeometry();
            overlayGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
            overlayGeometry.setIndex(indices);
            const overlayMaterial = new THREE.MeshBasicMaterial({
                color: 0x22d3ee,
                transparent: true,
                opacity: 0.35,
                side: THREE.DoubleSide,
                depthWrite: false
            });
            const overlayMesh = new THREE.Mesh(overlayGeometry, overlayMaterial);
            overlayMesh.renderOrder = 999;
            objData.object.add(overlayMesh);
            state.overlay = overlayMesh;
            return;
        }

        if (objData.type === 'points') {
            const selectedPoints = Array.from(state.pointIndices).sort((a, b) => a - b);
            if (!selectedPoints.length) return;

            const positions = [];
            const scale = objData.data?.scale || [1, 1, 1];
            selectedPoints.forEach(pointIndex => {
                const point = objData.data.points[pointIndex];
                if (!point) return;
                positions.push(
                    point[0] * scale[0],
                    point[1] * scale[1],
                    point[2] * scale[2]
                );
            });
            if (!positions.length) return;

            const overlayGeometry = new THREE.BufferGeometry();
            overlayGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
            const overlayMaterial = new THREE.PointsMaterial({
                color: 0x22d3ee,
                size: Math.max(0.02, (objData.data.size || 0.01) * 2.0),
                transparent: true,
                opacity: 0.95,
                depthWrite: false
            });
            const overlayPoints = new THREE.Points(overlayGeometry, overlayMaterial);
            overlayPoints.renderOrder = 999;
            objData.object.add(overlayPoints);
            state.overlay = overlayPoints;
        }
    }

    function getSelectionOperation() {
        if (selectionKeyState.add && !selectionKeyState.subtract) return 'add';
        if (selectionKeyState.subtract && !selectionKeyState.add) return 'subtract';
        return 'replace';
    }

    function cloneSelectionSnapshot(objData) {
        const state = ensureObjectSelectionState(objData.data.id, objData.type);
        if (objData.type === 'mesh') {
            return {
                faceIndices: new Set(state.faceIndices),
                vertexIndices: new Set(state.vertexIndices)
            };
        }
        return {
            pointIndices: new Set(state.pointIndices)
        };
    }

    function selectionResultFromSnapshot(objData, snapshot) {
        if (objData.type === 'mesh') {
            return {
                faceIndices: Array.from(snapshot.faceIndices || []),
                vertexIndices: Array.from(snapshot.vertexIndices || [])
            };
        }
        return {
            pointIndices: Array.from(snapshot.pointIndices || [])
        };
    }

    function buildBrushPreviewResult(objData, operation) {
        const staged = selectionInteraction.stagedSelection || {
            faceIndices: new Set(),
            vertexIndices: new Set(),
            pointIndices: new Set()
        };
        const initial = selectionInteraction.initialSelection || cloneSelectionSnapshot(objData);

        if (objData.type === 'mesh') {
            let nextFaces;
            if (operation === 'replace') {
                nextFaces = new Set(staged.faceIndices);
            } else if (operation === 'add') {
                nextFaces = new Set(initial.faceIndices);
                staged.faceIndices.forEach(faceIndex => nextFaces.add(faceIndex));
            } else {
                nextFaces = new Set(initial.faceIndices);
                staged.faceIndices.forEach(faceIndex => nextFaces.delete(faceIndex));
            }

            const nextVerts = new Set();
            nextFaces.forEach(faceIndex => {
                const faceVerts = getDataFaceVertexIndices(objData, faceIndex);
                nextVerts.add(faceVerts[0]);
                nextVerts.add(faceVerts[1]);
                nextVerts.add(faceVerts[2]);
            });

            return {
                faceIndices: Array.from(nextFaces),
                vertexIndices: Array.from(nextVerts)
            };
        }

        let nextPoints;
        if (operation === 'replace') {
            nextPoints = new Set(staged.pointIndices);
        } else if (operation === 'add') {
            nextPoints = new Set(initial.pointIndices);
            staged.pointIndices.forEach(pointIndex => nextPoints.add(pointIndex));
        } else {
            nextPoints = new Set(initial.pointIndices);
            staged.pointIndices.forEach(pointIndex => nextPoints.delete(pointIndex));
        }

        return {
            pointIndices: Array.from(nextPoints)
        };
    }

    function emitSelectionPayload(objData) {
        const selectionPayload = getSelectionPayload(objData);
        if (!selectionPayload) return;
        lastSelectionInfo = selectionPayload;
        if (socket) {
            const payload = { selection: selectionPayload };
            if (window.viewerId) payload.viewer_id = window.viewerId;
            socket.emit('events.selection', payload);
        }
    }

    function applyBrushPreviewSelection(objData) {
        if (!objData || selectionInteraction.mode !== 'brush') return;
        const operation = getSelectionOperation();
        const previewResult = buildBrushPreviewResult(objData, operation);
        applySelectionResult(objData, previewResult, 'replace', false);
        selectionInteraction.previewApplied = true;
    }

    function restoreSelectionFromSnapshot(objData, snapshot) {
        if (!objData || !snapshot) return;
        const result = selectionResultFromSnapshot(objData, snapshot);
        applySelectionResult(objData, result, 'replace', false);
    }

    function applySelectionResult(objData, nextResult, operation = 'replace', emit = true) {
        if (!objData || !nextResult) return;
        const state = ensureObjectSelectionState(objData.data.id, objData.type);

        if (objData.type === 'mesh') {
            const nextFaces = new Set(nextResult.faceIndices || []);
            const nextVerts = new Set(nextResult.vertexIndices || []);
            if (operation === 'replace') {
                state.faceIndices = nextFaces;
                state.vertexIndices = nextVerts;
            } else if (operation === 'add') {
                nextFaces.forEach(i => state.faceIndices.add(i));
                nextVerts.forEach(i => state.vertexIndices.add(i));
            } else if (operation === 'subtract') {
                nextFaces.forEach(i => state.faceIndices.delete(i));
                nextVerts.forEach(i => state.vertexIndices.delete(i));
            }

            if (state.faceIndices.size > 0) {
                const rebuiltVerts = new Set();
                state.faceIndices.forEach(faceIndex => {
                    const verts = getDataFaceVertexIndices(objData, faceIndex);
                    rebuiltVerts.add(verts[0]);
                    rebuiltVerts.add(verts[1]);
                    rebuiltVerts.add(verts[2]);
                });
                state.vertexIndices = rebuiltVerts;
            } else if (operation !== 'add') {
                state.vertexIndices.clear();
            }
        } else if (objData.type === 'points') {
            const nextPoints = new Set(nextResult.pointIndices || []);
            if (operation === 'replace') {
                state.pointIndices = nextPoints;
            } else if (operation === 'add') {
                nextPoints.forEach(i => state.pointIndices.add(i));
            } else if (operation === 'subtract') {
                nextPoints.forEach(i => state.pointIndices.delete(i));
            }
        }

        refreshObjectSelectionOverlay(objData.data.id);
        if (emit) {
            emitSelectionPayload(objData);
        } else {
            const selectionPayload = getSelectionPayload(objData);
            if (selectionPayload) {
                lastSelectionInfo = selectionPayload;
            }
        }
    }

    function getSelectionPayload(objData) {
        if (!objData || !objData.data || !objData.data.id) return null;
        const state = ensureObjectSelectionState(objData.data.id, objData.type);
        if (objData.type === 'mesh') {
            return {
                object_name: objData.data.id,
                object_type: 'mesh',
                selection_result: {
                    face_indices: Array.from(state.faceIndices).sort((a, b) => a - b),
                    vertex_indices: Array.from(state.vertexIndices).sort((a, b) => a - b)
                }
            };
        }
        if (objData.type === 'points') {
            return {
                object_name: objData.data.id,
                object_type: 'points',
                selection_result: {
                    point_indices: Array.from(state.pointIndices).sort((a, b) => a - b)
                }
            };
        }
        return null;
    }

    function clearSelectionForObject(objectId, emit = true) {
        const objData = objects[objectId];
        if (!objData) return;
        const state = ensureObjectSelectionState(objectId, objData.type);
        state.faceIndices.clear();
        state.vertexIndices.clear();
        state.pointIndices.clear();
        refreshObjectSelectionOverlay(objectId);
        if (emit) {
            applySelectionResult(objData, objData.type === 'mesh'
                ? { faceIndices: [], vertexIndices: [] }
                : { pointIndices: [] }, 'replace', true);
        }
    }

    function getSelectionInfo() {
        if (!lastSelectionInfo) return null;
        return JSON.parse(JSON.stringify(lastSelectionInfo));
    }

    function buildRegionFromInteraction() {
        if (selectionInteraction.mode === 'box') {
            const [sx, sy] = selectionInteraction.start;
            const [cx, cy] = selectionInteraction.current;
            return {
                type: 'box',
                minX: Math.min(sx, cx),
                minY: Math.min(sy, cy),
                maxX: Math.max(sx, cx),
                maxY: Math.max(sy, cy)
            };
        }
        if (selectionInteraction.mode === 'lasso') {
            const points = [...selectionInteraction.points, selectionInteraction.current];
            if (points.length < 3) return null;
            return {
                type: 'lasso',
                points
            };
        }
        return null;
    }

    function shouldHandleSelectionPointerEvent(event) {
        if (!selectionTool.enabled) return false;
        if (event.button !== undefined && event.button !== 0) return false;
        if (isFromUIPanelTarget(event.target)) return false;
        if (gizmo && gizmo.isDragging()) return false;
        return Boolean(getActiveSelectableObjectData());
    }

    function startSelectionInteraction(event) {
        if (!shouldHandleSelectionPointerEvent(event)) return;
        const objData = getActiveSelectableObjectData();
        if (!objData) return;

        const rect = container.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        brushCursor.valid = true;
        brushCursor.x = x;
        brushCursor.y = y;

        selectionInteraction.active = true;
        selectionInteraction.pointerId = event.pointerId ?? null;
        selectionInteraction.mode = selectionTool.mode;
        selectionInteraction.objectId = objData.data.id;
        selectionInteraction.start = [x, y];
        selectionInteraction.current = [x, y];
        selectionInteraction.points = [[x, y]];
        selectionInteraction.controlsEnabledBefore = controls.enabled;
        selectionInteraction.stagedSelection = {
            faceIndices: new Set(),
            vertexIndices: new Set(),
            pointIndices: new Set()
        };
        selectionInteraction.initialSelection = cloneSelectionSnapshot(objData);
        selectionInteraction.previewApplied = false;

        if (selectionInteraction.mode === 'brush') {
            collectBrushSelection(
                objData,
                event.clientX,
                event.clientY,
                Number(selectionTool.brushRadius || 0.1),
                selectionInteraction.stagedSelection
            );
            applyBrushPreviewSelection(objData);
        }

        controls.enabled = false;
        drawSelectionOverlayCanvas();
        event.preventDefault();
    }

    function updateSelectionInteraction(event) {
        if (!selectionInteraction.active) return;
        if (selectionInteraction.pointerId !== null && event.pointerId !== selectionInteraction.pointerId) return;

        const rect = container.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        selectionInteraction.current = [x, y];
        brushCursor.valid = true;
        brushCursor.x = x;
        brushCursor.y = y;

        if (selectionInteraction.mode === 'lasso') {
            const prev = selectionInteraction.points[selectionInteraction.points.length - 1];
            const dx = x - prev[0];
            const dy = y - prev[1];
            if (dx * dx + dy * dy > 9) {
                selectionInteraction.points.push([x, y]);
            }
        } else if (selectionInteraction.mode === 'brush') {
            const objData = selectionInteraction.objectId ? objects[selectionInteraction.objectId] : null;
            if (objData) {
                collectBrushSelection(
                    objData,
                    event.clientX,
                    event.clientY,
                    Number(selectionTool.brushRadius || 0.1),
                    selectionInteraction.stagedSelection
                );
                applyBrushPreviewSelection(objData);
            }
        }

        drawSelectionOverlayCanvas();
        event.preventDefault();
    }

    function finishSelectionInteraction(event) {
        if (!selectionInteraction.active) return;
        if (selectionInteraction.pointerId !== null && event.pointerId !== selectionInteraction.pointerId) return;

        const objData = selectionInteraction.objectId ? objects[selectionInteraction.objectId] : null;
        const operation = getSelectionOperation();

        if (objData) {
            if (selectionInteraction.mode === 'box' || selectionInteraction.mode === 'lasso') {
                const region = buildRegionFromInteraction();
                if (region) {
                    if (objData.type === 'mesh') {
                        const res = collectRegionSelectionMesh(objData, region, !!selectionTool.visibleOnly);
                        applySelectionResult(objData, res, operation, true);
                    } else if (objData.type === 'points') {
                        const res = collectRegionSelectionPoints(objData, region, false);
                        applySelectionResult(objData, res, operation, true);
                    }
                }
            } else if (selectionInteraction.mode === 'brush') {
                collectBrushSelection(
                    objData,
                    event.clientX,
                    event.clientY,
                    Number(selectionTool.brushRadius || 0.1),
                    selectionInteraction.stagedSelection
                );
                applyBrushPreviewSelection(objData);
                emitSelectionPayload(objData);
            } else if (selectionInteraction.mode === 'bucket') {
                const res = collectBucketSelection(objData, event.clientX, event.clientY);
                if (res) {
                    applySelectionResult(objData, res, operation, true);
                }
            }
        }

        selectionInteraction.active = false;
        selectionInteraction.pointerId = null;
        selectionInteraction.mode = null;
        selectionInteraction.objectId = null;
        selectionInteraction.points = [];
        selectionInteraction.stagedSelection = null;
        selectionInteraction.initialSelection = null;
        selectionInteraction.previewApplied = false;
        controls.enabled = selectionInteraction.controlsEnabledBefore;
        clearSelectionOverlayCanvas();
        drawSelectionOverlayCanvas();
    }

    function cancelSelectionInteraction() {
        if (!selectionInteraction.active) return;
        const objData = selectionInteraction.objectId ? objects[selectionInteraction.objectId] : null;
        if (selectionInteraction.mode === 'brush' && objData && selectionInteraction.previewApplied) {
            restoreSelectionFromSnapshot(objData, selectionInteraction.initialSelection);
        }
        selectionInteraction.active = false;
        selectionInteraction.pointerId = null;
        selectionInteraction.mode = null;
        selectionInteraction.objectId = null;
        selectionInteraction.points = [];
        selectionInteraction.stagedSelection = null;
        selectionInteraction.initialSelection = null;
        selectionInteraction.previewApplied = false;
        controls.enabled = selectionInteraction.controlsEnabledBefore;
        clearSelectionOverlayCanvas();
        drawSelectionOverlayCanvas();
    }

    function handleSelectionKeyDown(event) {
        if (!selectionTool.enabled) return;
        if (isTextInputElement(event.target)) return;

        if (event.code === 'KeyA') {
            selectionKeyState.add = true;
            if (selectionInteraction.active && selectionInteraction.mode === 'brush') {
                const objData = selectionInteraction.objectId ? objects[selectionInteraction.objectId] : null;
                if (objData) applyBrushPreviewSelection(objData);
            }
            return;
        }
        if (event.code === 'KeyS') {
            selectionKeyState.subtract = true;
            if (selectionInteraction.active && selectionInteraction.mode === 'brush') {
                const objData = selectionInteraction.objectId ? objects[selectionInteraction.objectId] : null;
                if (objData) applyBrushPreviewSelection(objData);
            }
            return;
        }
        if (event.code === 'KeyD') {
            const objData = getActiveSelectableObjectData();
            if (objData) {
                applySelectionResult(
                    objData,
                    objData.type === 'mesh'
                        ? { faceIndices: [], vertexIndices: [] }
                        : { pointIndices: [] },
                    'replace',
                    true
                );
                if (selectionInteraction.active &&
                    selectionInteraction.mode === 'brush' &&
                    selectionInteraction.objectId === objData.data.id) {
                    selectionInteraction.initialSelection = cloneSelectionSnapshot(objData);
                    selectionInteraction.stagedSelection = {
                        faceIndices: new Set(),
                        vertexIndices: new Set(),
                        pointIndices: new Set()
                    };
                }
            }
            event.preventDefault();
        }
    }

    function handleSelectionKeyUp(event) {
        if (event.code === 'KeyA') {
            selectionKeyState.add = false;
            if (selectionInteraction.active && selectionInteraction.mode === 'brush') {
                const objData = selectionInteraction.objectId ? objects[selectionInteraction.objectId] : null;
                if (objData) applyBrushPreviewSelection(objData);
            }
            return;
        }
        if (event.code === 'KeyS') {
            selectionKeyState.subtract = false;
            if (selectionInteraction.active && selectionInteraction.mode === 'brush') {
                const objData = selectionInteraction.objectId ? objects[selectionInteraction.objectId] : null;
                if (objData) applyBrushPreviewSelection(objData);
            }
        }
    }

    const handlePointerDown = (event) => {
        if (!selectionTool.enabled) return;
        startSelectionInteraction(event);
    };

    const handlePointerMove = (event) => {
        if (!selectionTool.enabled) return;
        if (selectionTool.mode === 'brush') {
            const rect = container.getBoundingClientRect();
            brushCursor.valid = true;
            brushCursor.x = event.clientX - rect.left;
            brushCursor.y = event.clientY - rect.top;
            if (!selectionInteraction.active) {
                selectionInteraction.current = [brushCursor.x, brushCursor.y];
                drawSelectionOverlayCanvas();
            }
        }
        updateSelectionInteraction(event);
    };

    const handlePointerUp = (event) => {
        if (!selectionTool.enabled) return;
        finishSelectionInteraction(event);
    };

    const handlePointerLeave = () => {
        brushCursor.valid = false;
        if (!selectionInteraction.active) {
            drawSelectionOverlayCanvas();
        }
    };

    container.addEventListener('pointerdown', handlePointerDown);
    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerleave', handlePointerLeave);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', cancelSelectionInteraction);
    document.addEventListener('keydown', handleSelectionKeyDown);
    document.addEventListener('keyup', handleSelectionKeyUp);
    
    // Add click event listener for object selection and inspection
    container.addEventListener('click', (event) => {
        if (selectionTool.enabled) {
            return;
        }
        // Check if click originated from a UI panel - if so, ignore it
        // TODO: this is a hack we should find a better way to do this
        const target = event.target;
        const isFromUIPanel = isFromUIPanelTarget(target);
        if (isFromUIPanel) {
            return;
        }

        const rect = container.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        raycaster.setFromCamera(mouse, camera);
        
        if (renderSettings.inspectMode) {
            raycaster.params.Line.threshold = 0.1;
        }
        
        // Get all selectable objects
        const selectableObjects = Object.values(objects)
            .map(obj => obj.object)
            .filter(obj => obj.visible);
        
        // In inspection mode, we want to intersect with the actual mesh objects, not wireframe overlays
        let intersectTargets = selectableObjects;
        let temporaryMaterials = new Map();
        
        if (renderSettings.inspectMode) {
            // Filter to only mesh objects and ensure we hit the main mesh, not wireframe helpers
            intersectTargets = selectableObjects.filter(obj => {
                return !(obj.material && obj.material.type === 'LineBasicMaterial');
            });
            
            // For wireframe materials, temporarily replace with solid material for raycasting
            intersectTargets.forEach(obj => {
                if (obj.material && obj.material.wireframe === true) {
                    temporaryMaterials.set(obj, obj.material);
                    obj.material = new THREE.MeshBasicMaterial({
                        color: obj.material.color,
                        transparent: true,
                        opacity: 0.01,
                        side: THREE.DoubleSide
                    });
                }
            });
        }
        
        const intersects = raycaster.intersectObjects(intersectTargets, false);
        
        // Restore original materials
        temporaryMaterials.forEach((originalMaterial, obj) => {
            obj.material.dispose();
            obj.material = originalMaterial;
        });
        
        if (intersects.length > 0) {
            const intersection = intersects[0];
            const intersectedObject = intersection.object;
            let topLevelObject = intersectedObject;
            
            // Traverse up the hierarchy if needed
            while (topLevelObject.parent && topLevelObject.parent !== scene) {
                topLevelObject = topLevelObject.parent;
            }
            
            // Find the object data for the intersected object
            let objectData = null;
            for (const [id, obj] of Object.entries(objects)) {
                if (obj.object === topLevelObject) {
                    objectData = obj;
                    break;
                }
            }

            if (renderSettings.inspectMode && objectData && (objectData.type === 'mesh' || objectData.type === 'animated_mesh' || objectData.type === 'points')) {
                clearInspectionHighlights();

                const faceIndex = intersection.faceIndex;
                const targetGeometry = intersectedObject.geometry;

                // Inspection mode: show information depending on object type
                if (objectData.type === 'points' && intersection.instanceId !== undefined) {
                    const pointIndex = intersection.instanceId;

                    // Highlight the selected point
                    const highlightGeom = new THREE.SphereGeometry(objectData.data.size * 1.2, 8, 8);
                    const highlightMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
                    inspectionHighlight = new THREE.Mesh(highlightGeom, highlightMat);
                    inspectionHighlight.position.copy(intersection.point);
                    scene.add(inspectionHighlight);

                    inspectionPoint = intersection.point.clone();

                    inspectionData = {
                        object: intersectedObject,
                        type: objectData.type,
                        index: pointIndex
                    };

                    // Display inspection info
                    inspectionContent.textContent = `Point Index: ${pointIndex}`;
                    inspectionDiv.style.display = 'block';
                    inspectionDiv.style.left = (event.clientX + 10) + 'px';
                    inspectionDiv.style.top = (event.clientY - 10) + 'px';

                    // Emit inspection event to server
                    if (socket) {
                        const payload = {
                            inspection: {
                                object_name: objectData.data.id,
                                object_type: objectData.type,
                                inspect_result: { point_index: pointIndex },
                                world_coords: [intersection.point.x, intersection.point.y, intersection.point.z],
                                screen_coords: [event.clientX - rect.left, event.clientY - rect.top]
                            }
                        };
                        if (window.viewerId) payload.viewer_id = window.viewerId;
                        socket.emit('events.inspect', payload);
                    }
                } else if (faceIndex !== undefined && targetGeometry) {
                    let inspectionText = `Face Index: ${faceIndex}\n`;
                    let vertexIndices = [];

                    if (targetGeometry.index) {
                        // Indexed geometry
                        const a = targetGeometry.index.array[faceIndex * 3];
                        const b = targetGeometry.index.array[faceIndex * 3 + 1];
                        const c = targetGeometry.index.array[faceIndex * 3 + 2];
                        vertexIndices = [a, b, c];
                        inspectionText += `Vertex Indices: ${a}, ${b}, ${c}`;
                    } else {
                        // Non-indexed geometry
                        const a = faceIndex * 3;
                        const b = faceIndex * 3 + 1;
                        const c = faceIndex * 3 + 2;
                        vertexIndices = [a, b, c];
                        inspectionText += `Vertex Indices: ${a}, ${b}, ${c}`;
                    }

                    // Create visual highlights
                    const positionAttribute = targetGeometry.getAttribute('position');
                    if (positionAttribute && vertexIndices.length === 3) {
                        // Create face highlight
                        const faceVertices = [];
                        const localVerts = [];
                        const worldVerts = [];

                        for (let i = 0; i < 3; i++) {
                            const idx = vertexIndices[i];
                            const x = positionAttribute.array[idx * 3];
                            const y = positionAttribute.array[idx * 3 + 1];
                            const z = positionAttribute.array[idx * 3 + 2];
                            faceVertices.push(x, y, z);
                            const lv = new THREE.Vector3(x, y, z);
                            localVerts.push(lv.clone());
                            worldVerts.push(lv);
                        }

                        // Transform vertex positions to world space
                        const worldMatrix = topLevelObject.matrixWorld;
                        worldVerts.forEach(pos => pos.applyMatrix4(worldMatrix));

                        // Compute barycentric coordinates of the intersection
                        const invMatrix = new THREE.Matrix4().copy(worldMatrix).invert();
                        const localHit = intersection.point.clone().applyMatrix4(invMatrix);
                        const bary = computeBarycentric(localHit, localVerts[0], localVerts[1], localVerts[2]);

                        // Create face highlight
                        const faceGeometry = new THREE.BufferGeometry();
                        faceGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(faceVertices), 3));
                        faceGeometry.setIndex([0, 1, 2]);

                        const faceMaterial = new THREE.MeshBasicMaterial({
                            color: 0xff0000,
                            transparent: true,
                            opacity: 0.5,
                            side: THREE.DoubleSide
                        });

                        inspectionHighlight = new THREE.Mesh(faceGeometry, faceMaterial);
                        inspectionHighlight.matrix.copy(worldMatrix);
                        inspectionHighlight.matrixAutoUpdate = false;
                        scene.add(inspectionHighlight);

                        // Create vertex points
                        const pointsGeometry = new THREE.BufferGeometry();
                        const pointPositions = [];
                        worldVerts.forEach(pos => {
                            pointPositions.push(pos.x, pos.y, pos.z);
                        });
                        pointsGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pointPositions), 3));

                        const pointsMaterial = new THREE.PointsMaterial({
                            color: 0x00ff00,
                            size: 8,
                            sizeAttenuation: false
                        });

                        inspectionVertexPoints = new THREE.Points(pointsGeometry, pointsMaterial);
                        scene.add(inspectionVertexPoints);

                        // Store inspection data for animated meshes
                        inspectionData = {
                            object: topLevelObject,
                            type: objectData.type,
                            vertexIndices: vertexIndices,
                            barycentric: bary
                        };
                    }

                    inspectionPoint = intersection.point.clone();

                    // Display inspection information
                    inspectionContent.textContent = inspectionText;
                    inspectionDiv.style.display = 'block';
                    inspectionDiv.style.left = (event.clientX + 10) + 'px';
                    inspectionDiv.style.top = (event.clientY - 10) + 'px';

                    if (socket) {
                        const payload = {
                            inspection: {
                                object_name: objectData.data.id,
                                object_type: objectData.type,
                                inspect_result: {
                                    face_index: faceIndex,
                                    vertex_indices: vertexIndices
                                },
                                world_coords: [intersection.point.x, intersection.point.y, intersection.point.z],
                                screen_coords: [event.clientX - rect.left, event.clientY - rect.top]
                            }
                        };
                        if (window.viewerId) payload.viewer_id = window.viewerId;
                        socket.emit('events.inspect', payload);
                    }
                }
            } else {
                // Regular selection mode
                if (objectData) {
                    const previousSelectedId = selectedObject?.data?.id || null;
                    selectedObject = { ...objectData };

                    if (slicingPlane.isEnabled() && previousSelectedId !== objectData.data.id) {
                        centerSlicingPlaneOnSelectedObject(false);
                    }
                    applySlicingPlaneToAllObjects();
                    syncGizmoAttachment();
                    
                    // Notify React component about selection
                    if (typeof onSelectObject === 'function') {
                        onSelectObject(null);
                        onSelectObject({ type: objectData.type, data: objectData.data });
                        event_select_object(objectData.data.id);
                    }
                }
            }
        } else {
            // Clicked empty space; only deselect if the click originated on the canvas
            // TODO check how we are absorbing clicks here:
            // if (!renderSettings.inspectMode && event.composedPath().includes(renderer.domElement)) {
            //     selectedObject = null;
            //     if (typeof onSelectObject === 'function') {
            //         console.log('Deselected object');
            //         onSelectObject(null);
            //     }
            // }
            
            // Keep inspection overlay visible in inspection mode
        }
    });
    
    // Socket event handlers
    socket.on('add_mesh', (data) => {
        addMesh(data);
        if (typeof onSceneObjectsChange === 'function') {
            onSceneObjectsChange();
        }
    });
    
    socket.on('add_animated_mesh', (data) => {
        addAnimatedMesh(data);
        if (typeof onSceneObjectsChange === 'function') {
            onSceneObjectsChange();
        }
    });
    
    socket.on('add_points', (data) => {
        addPoints(data);
        if (typeof onSceneObjectsChange === 'function') {
            onSceneObjectsChange();
        }
    });
    
    socket.on('add_arrows', (data) => {
        addArrows(data);
        if (typeof onSceneObjectsChange === 'function') {
            onSceneObjectsChange();
        }
    });
    
    socket.on('update_object', (data) => {
        const _selectedObject = selectedObject ? { ...selectedObject } : null;

        updateObject(data.id, data.updates);

        // Check if the updated object is currently selected, preserve selection:
        const isSelected = _selectedObject && _selectedObject.data.id === data.id;
        if (isSelected && typeof onSelectObject === 'function') {
            selectedObject = { type: objects[data.id].type, data: objects[data.id].data };
            applySlicingPlaneToAllObjects();
            syncGizmoAttachment();
            onSelectObject(selectedObject);
        }

        if (typeof onSceneObjectsChange === 'function') {
            onSceneObjectsChange();
        }
    });

    socket.on('set_camera', (data) => {
        if (data.viewer_id && window.viewerId && data.viewer_id !== window.viewerId) {
            return;
        }
        setCamera(data.camera);
    });
    
    socket.on('delete_object', (data) => {
        deleteObject(data.id);
        if (typeof onSceneObjectsChange === 'function') {
            onSceneObjectsChange();
        }
    });

    socket.on('download_file', (data) => {
        if (data.viewer_id && window.viewerId && data.viewer_id !== window.viewerId) {
            return;
        }
        downloadFileFromBase64(data.filename, data.data);
    });

    socket.on('http_event', (info) => {
        if (info.viewer_id && window.viewerId && info.viewer_id !== window.viewerId) {
            return;
        }
        fetch(info.url)
            .then(resp => resp.arrayBuffer())
            .then(buffer => {
                const decoded = msgpackDecode(new Uint8Array(buffer));
                const data = unpackMsgpack(decoded);
                switch (info.event) {
                    case 'add_mesh':
                        addMesh(data);
                        break;
                    case 'add_animated_mesh':
                        addAnimatedMesh(data);
                        break;
                    case 'add_points':
                        addPoints(data);
                        break;
                    case 'add_arrows':
                        addArrows(data);
                        break;
                    case 'update_object':
                        updateObject(data.id, data.updates);
                        break;
                    case 'set_camera':
                        setCamera(data.camera);
                        break;
                    case 'download_file':
                        downloadFileFromBase64(data.filename, data.data);
                        break;
                }
                if (typeof onSceneObjectsChange === 'function') {
            onSceneObjectsChange();
        }
            });
    });
    
    // Scene management functions
    function addMesh(data) {
        if (objects[data.id]) {
            deleteObject(data.id);
        }
        
        let geometry = new THREE.BufferGeometry();
        
        const vertices = new Float32Array(data.vertices.flat());
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        
        if (data.faces && data.faces.length > 0) {
            const indices = new Uint32Array(data.faces.flat());
            geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        }
        
        let vcolors = false;
        let fcolors = false;
        if (data.vertex_colors) {
            const colors = toLinearColorArray(data.vertex_colors.flat());
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            vcolors = true;
        }else if (data.face_colors) {
            geometry = geometry.toNonIndexed();
            const colors = [];
            for (let i = 0; i < data.face_colors.length; i++) {
                colors.push(...data.face_colors[i]);
                colors.push(...data.face_colors[i]);
                colors.push(...data.face_colors[i]);
            }
            geometry.setAttribute('color', new THREE.Float32BufferAttribute(toLinearColorArray(colors), 3));
            fcolors = true;
        }
        
        let material;
        if (data.material) {
            // Create material from backend data
            material = createMaterial(data.material);
            if (vcolors || fcolors) {
                material.vertexColors = true;
            }
        } else {
            // Default material when none specified, this generally wont trigger unless the user deleted the material attribute
            material = new THREE.MeshStandardMaterial({
                color: new THREE.Color(1.0, 1.0, 1.0),
                vertexColors: vcolors || fcolors,
                transparent: data.opacity < 1.0,
                opacity: data.opacity,
                flatShading: renderSettings.flatShading,
                roughness: 0.45,
                metalness: 0.1
            });
        }

        const originalWireframe = material.wireframe;
        if (renderSettings.wireframe === 1) { 
            // surface only
            material.wireframe = false;
        } else if (renderSettings.wireframe > 1) { 
            // wireframe + surface or wireframe only
            material.wireframe = true;
        }

        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.position.set(data.position[0], data.position[1], data.position[2]);
        mesh.rotation.set(data.rotation[0], data.rotation[1], data.rotation[2]);
        mesh.scale.set(data.scale[0], data.scale[1], data.scale[2]);
        
        if (!geometry.attributes.normal) {
            geometry.computeVertexNormals();
        }
        
        mesh.visible = data.visible;
        scene.add(mesh);
        
        if (renderSettings.showNormals) {
            const normalHelper = new VertexNormalsHelper(mesh, 0.2, 0x00ff00, 1);
            scene.add(normalHelper);
            normalHelpers[data.id] = normalHelper;
        }
        
        // Store original opacity for visibility toggle functionality
        if (!data.originalOpacity) {
            if (data.material && data.material.opacity !== undefined) {
                data.originalOpacity = data.material.opacity;
            } else {
                data.originalOpacity = data.opacity || 1.0;
            }
        }
        
        objects[data.id] = {
            object: mesh,
            type: 'mesh',
            data: data
        };
        // mesh.userData.originalWireframe = !!data.wireframe;
        mesh.userData.originalWireframe = originalWireframe;
        applyRenderSettings(renderSettings);
    }
    
    function addAnimatedMesh(data) {
        if (objects[data.id]) {
            deleteObject(data.id);
        }
        // Validate vertices format - should be 3D array (frames, vertices, 3)
        // After msgpack unpacking, vertices might be flattened: (frames, 3*vertices) instead of (frames, vertices, 3)
        if (!data.vertices || data.vertices.length === 0 || !data.vertices[0] || !data.vertices[0].length) {
            console.error('Invalid animated mesh vertices format. Expected (frames, vertices, 3)');
            console.error('data.vertices:', data.vertices);
            return;
        }
        
        const numFrames = data.vertices.length;
        const flatVerticesPerFrame = data.vertices[0].length;
        
        // Check if vertices are flattened (3*vertices) and reshape if needed
        let reshapedVertices = data.vertices;
        let numVertices;
        const isFlattened = !Array.isArray(data.vertices[0][0]);
        if (isFlattened) {
            // Vertices are likely flattened, reshape them
            numVertices = flatVerticesPerFrame / 3;
            reshapedVertices = data.vertices.map(frameVerts => {
                const reshaped = [];
                for (let i = 0; i < numVertices; i++) {
                    reshaped.push([frameVerts[i * 3], frameVerts[i * 3 + 1], frameVerts[i * 3 + 2]]);
                }
                return reshaped;
            });
        } else {
            numVertices = data.vertices[0].length;
        }
        
        // Update data.vertices with reshaped version
        data.vertices = reshapedVertices;
        let geometry = new THREE.BufferGeometry();
        let useFaceColors = false;
        let expandedVerticesFrames = null;
        // If face colors, expand all frames to non-indexed
        if (data.face_colors && data.faces) {
            useFaceColors = true;
            expandedVerticesFrames = data.vertices.map(frameVerts => expandVerticesForNonIndexed(frameVerts, data.faces));
        }
        // Use expanded or original for initial frame
        const initialVertices = new Float32Array(
            useFaceColors ? expandedVerticesFrames[0].flat() : data.vertices[0].flat()
        );
        geometry.setAttribute('position', new THREE.BufferAttribute(initialVertices, 3));
        if (data.faces && data.faces.length > 0 && !useFaceColors) {
            const indices = new Uint32Array(data.faces.flat());
            geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        }
        // Set vertex colors if available (using first frame)
        let vcolors = false;
        let fcolors = false;
        let baseColor = parseColor(data.color);
        if (data.vertex_colors) {
            const colors = toLinearColorArray(data.vertex_colors.flat());
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            vcolors = true;
            baseColor = new THREE.Color(1.0, 1.0, 1.0);
        } else if (data.face_colors) {
            geometry = geometry.toNonIndexed(); // already non-indexed, but safe
            const colors = [];
            for (let i = 0; i < data.face_colors.length; i++) {
                colors.push(...data.face_colors[i]);
                colors.push(...data.face_colors[i]);
                colors.push(...data.face_colors[i]);
            }
            geometry.setAttribute('color', new THREE.Float32BufferAttribute(toLinearColorArray(colors), 3));
            fcolors = true;
            baseColor = new THREE.Color(1.0, 1.0, 1.0);
        }
        let material;
        if (data.material) {
            material = createMaterial(data.material);
            if (vcolors || fcolors) {
                material.vertexColors = true;
            }
        } else {
            material = new THREE.MeshStandardMaterial({
                color: baseColor,
                vertexColors: vcolors || fcolors,
                transparent: data.opacity < 1.0,
                opacity: data.opacity,
                flatShading: renderSettings.flatShading,
                roughness: 0.45,
                metalness: 0.1
            });
        }
        const originalWireframe = material.wireframe;
        if (renderSettings.wireframe === 1) {
            material.wireframe = false;
        } else if (renderSettings.wireframe > 1) {
            material.wireframe = true;
        }
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.position.set(data.position[0], data.position[1], data.position[2]);
        mesh.rotation.set(data.rotation[0], data.rotation[1], data.rotation[2]);
        mesh.scale.set(data.scale[0], data.scale[1], data.scale[2]);
        if (!geometry.attributes.normal) {
            geometry.computeVertexNormals();
        }
        mesh.visible = data.visible;
        scene.add(mesh);
        if (renderSettings.showNormals) {
            const normalHelper = new VertexNormalsHelper(mesh, 0.2, 0x00ff00, 1);
            scene.add(normalHelper);
            normalHelpers[data.id] = normalHelper;
        }
        const animationData = {
            vertices: data.vertices,
            expandedVerticesFrames: expandedVerticesFrames, // may be null
            framerate: data.framerate,
            currentFrame: data.current_frame || 0,
            isPlaying: data.is_playing || false,
            startTime: data.is_playing ? Date.now() / 1000 : null,
            numFrames: numFrames,
            useFaceColors: useFaceColors
        };
        // Store original opacity for visibility toggle functionality
        if (!data.originalOpacity) {
            if (data.material && data.material.opacity !== undefined) {
                data.originalOpacity = data.material.opacity;
            } else {
                data.originalOpacity = data.opacity || 1.0;
            }
        }
        objects[data.id] = {
            object: mesh,
            type: 'animated_mesh',
            data: data,
            animation: animationData
        };
        mesh.userData.originalWireframe = originalWireframe;
        applyRenderSettings(renderSettings);
    }
    
    function addPoints(data) {
        if (objects[data.id]) {
            deleteObject(data.id);
        }

        const count = data.points.length;

        // Base sphere geometry with few segments for performance
        const geometry = new THREE.SphereGeometry(data.size, 6, 6);

        let material;
        const usePerColor = Array.isArray(data.colors[0]);
        if (usePerColor) {
            material = new THREE.MeshStandardMaterial({
                color: new THREE.Color(0.9, 0.9, 0.9) // temporary color, will override with setColorAt
            });
        } else {
            material = new THREE.MeshStandardMaterial({
                color: parseColor(data.colors)
            });
        }
        // set opacity:
        material.opacity = data.opacity;
        material.transparent = data.opacity < 1.0;

        const spheres = new THREE.InstancedMesh(geometry, material, count);
        const dummy = new THREE.Object3D();
        
        // Apply initial scale to point positions if provided
        const scale = data.scale || [1, 1, 1];
        
        for (let i = 0; i < count; i++) {
            const p = data.points[i];
            // Apply scale to point position
            dummy.position.set(
                p[0] * scale[0],
                p[1] * scale[1],
                p[2] * scale[2]
            );
            dummy.updateMatrix();
            spheres.setMatrixAt(i, dummy.matrix);

            if (usePerColor) {
                const c = data.colors[i];
                spheres.setColorAt(i, parseColor(c));
            }
        }

        if (usePerColor && spheres.instanceColor) {
            spheres.instanceColor.needsUpdate = true;
        }

        spheres.castShadow = true;
        spheres.receiveShadow = true;
        spheres.visible = data.visible;
        
        // Apply transformations (except scale for points - handled in updateObject)
        if (data.position) {
            spheres.position.set(data.position[0], data.position[1], data.position[2]);
        }
        if (data.rotation) {
            spheres.rotation.set(data.rotation[0], data.rotation[1], data.rotation[2]);
        }
        // Note: Scale for points is handled by scaling the point positions, not the object
        
        scene.add(spheres);

        // Store original opacity for visibility toggle functionality
        if (!data.originalOpacity) {
            data.originalOpacity = data.opacity;
        }
        
        objects[data.id] = {
            object: spheres,
            type: 'points',
            data: data
        };
        applySlicingPlaneToObject(objects[data.id]);
    }
    
    const ARROW_BODY = new THREE.CylinderGeometry( 1, 1, 1, 12 ).rotateX( Math.PI/2).translate( 0, 0, 0.5 );
    const ARROW_HEAD = new THREE.ConeGeometry( 1, 1, 12 ).rotateX( Math.PI/2).translate( 0, 0, -0.5 );
    function customArrow( fx, fy, fz, ix, iy, iz, color, data) {
        // borrowed from: https://discourse.threejs.org/t/how-do-you-make-a-custom-arrow/55401/9
        let thickness = data.width;
        let transparent = data.opacity < 1.0;
        let opacity = data.opacity;
        var material = new THREE.MeshPhongMaterial( { color: color, flatShading: false, transparent: transparent, opacity: opacity} );
        var length = Math.sqrt( (ix-fx)**2 + (iy-fy)**2 + (iz-fz)**2 );
        var body = new THREE.Mesh( ARROW_BODY, material );
            body.scale.set( thickness, thickness, length-10*thickness );
        var head = new THREE.Mesh( ARROW_HEAD, material );
            head.position.set( 0, 0, length );
            head.scale.set( 3*thickness, 3*thickness, 10*thickness );
        var arrow = new THREE.Group( );
            arrow.position.set( ix, iy, iz );
            arrow.lookAt( fx, fy, fz );	
            arrow.add( body, head );
        return arrow;
    }

    function addArrows(data) {
        if (objects[data.id]) {
            deleteObject(data.id);
        }    
        
        const group = new THREE.Group();
        const starts = data.starts;
        const ends = data.ends;
        data.opacity = data.opacity;
        data.transparent = data.opacity < 1.0;
        for (let i = 0; i < starts.length; i++) {
            let col = Array.isArray(data.color[0]) ? parseColor(data.color[i]) : parseColor(data.color);
            const arrowHelper = customArrow(
                ends[i][0], ends[i][1], ends[i][2],
                starts[i][0], starts[i][1], starts[i][2],
                col,
                data
            );
            group.add(arrowHelper);
        }
        
        group.visible = data.visible !== undefined ? data.visible : true;
        
        // Apply transformations
        if (data.position) {
            group.position.set(data.position[0], data.position[1], data.position[2]);
        }
        if (data.rotation) {
            group.rotation.set(data.rotation[0], data.rotation[1], data.rotation[2]);
        }
        if (data.scale) {
            group.scale.set(data.scale[0], data.scale[1], data.scale[2]);
        }
        
        scene.add(group);
        
        // Store original opacity for visibility toggle functionality
        if (!data.originalOpacity) {
            data.originalOpacity = data.opacity;
        }
        
        objects[data.id] = {
            object: group,
            type: 'arrows',
            data: data
        };
    }
    
    function updateObject(id, updates) {
        // console.log('updateObject', id, updates);
        const objData = objects[id];
        if (!objData) return;

        const GEOMETRY_PROPERTIES = {
            mesh: ['vertices', 'faces', 'vertex_colors', 'face_colors'],
            animated_mesh: ['vertices', 'faces', 'vertex_colors', 'face_colors'],
            points: ['points', 'colors', 'size'],
            arrows: ['starts', 'ends', 'color', 'width']
        };

        // Check if any geometry properties need updating
        const geometryProps = GEOMETRY_PROPERTIES[objData.type] || [];
        const hasGeometryUpdates = geometryProps.some(prop => updates[prop] !== undefined);

        if (hasGeometryUpdates && (objData.type === 'mesh' || objData.type === 'points')) {
            applySelectionResult(
                objData,
                objData.type === 'mesh'
                    ? { faceIndices: [], vertexIndices: [] }
                    : { pointIndices: [] },
                'replace',
                false
            );
        }
        
        // Try in-place geometry updates first
        if (hasGeometryUpdates) {
            const needsRebuild = !tryInPlaceGeometryUpdate(objData, updates);
            if (needsRebuild) {
                rebuildObject(objData, updates);
                return;
            }
        }

        updateTransforms(objData, updates);
        updateProperties(objData, updates);
        updateSelectionIfNeeded(objData, id);

        if (selectionByObject[id] && selectionByObject[id].overlay) {
            refreshObjectSelectionOverlay(id);
        }

        return objData;
    }

    // Try to update geometry in-place without rebuilding the entire object
    function tryInPlaceGeometryUpdate(objData, updates) {
        const { type, object, data } = objData;

        if (type === 'mesh' || type === 'animated_mesh') {
            return tryInPlaceMeshUpdate(objData, updates);
        } else if (type === 'points') {
            return tryInPlacePointsUpdate(objData, updates);
        } else if (type === 'arrows') {
            // Arrows always need rebuild for geometry changes
            return false;
        }

        return true;
    }

    // In-place updates for mesh and animated mesh objects
    function tryInPlaceMeshUpdate(objData, updates) {
        const { object, data, type } = objData;
        const geom = object.geometry;
        let success = true;
        let shouldInvalidateBVH = false;

        if (updates.vertices !== undefined) {
            const newVerts = updates.vertices.flat();
            const posAttr = geom.getAttribute('position');
            if (posAttr && posAttr.count * 3 === newVerts.length) {
                posAttr.array.set(newVerts);
                posAttr.needsUpdate = true;
                data.vertices = updates.vertices;
                shouldInvalidateBVH = true;
            } else {
                success = false;
            }
        }

        if (updates.faces !== undefined) {
            const newIndices = updates.faces.flat();
            const idxAttr = geom.getIndex();
            if (idxAttr && idxAttr.count === newIndices.length) {
                idxAttr.array.set(newIndices);
                idxAttr.needsUpdate = true;
                data.faces = updates.faces;
                shouldInvalidateBVH = true;
            } else {
                success = false;
            }
        }

        if (updates.vertex_colors !== undefined) {
            if (updates.vertex_colors === null) {
                delete data.vertex_colors;
            } else {
                const newColors = updates.vertex_colors.flat();
                const linearColors = toLinearColorArray(newColors);
                const colorAttr = geom.getAttribute('color');
                if (colorAttr && colorAttr.count * 3 === newColors.length) {
                    colorAttr.array.set(linearColors);
                    colorAttr.needsUpdate = true;
                    data.vertex_colors = updates.vertex_colors;
                } else {
                    // Try to replace the color attribute if vertex count matches
                    const posAttr = geom.getAttribute('position');
                    if (posAttr && posAttr.count * 3 === newColors.length) {
                        geom.setAttribute('color', new THREE.BufferAttribute(linearColors, 3));
                        geom.attributes.color.needsUpdate = true;
                        data.vertex_colors = updates.vertex_colors;
                    } else {
                        success = false;
                    }
                }
            }
        }

        if (updates.face_colors !== undefined) {
            if (updates.face_colors === null) {
                delete data.face_colors;
            } else {
                // For animated meshes with face colors, always rebuild to avoid issues
                if (type === 'animated_mesh') {
                    success = false;
                } else {
                    const newColors = [];
                    for (let i = 0; i < updates.face_colors.length; i++) {
                        newColors.push(...updates.face_colors[i]);
                        newColors.push(...updates.face_colors[i]);
                        newColors.push(...updates.face_colors[i]);
                    }
                    const linearColors = toLinearColorArray(newColors);
                    const colorAttr = geom.getAttribute('color');
                    if (colorAttr && colorAttr.count * 3 === newColors.length) {
                        colorAttr.array.set(linearColors);
                        colorAttr.needsUpdate = true;
                        data.face_colors = updates.face_colors;
                    } else {
                        // Try to replace the color attribute if vertex count matches
                        const posAttr = geom.getAttribute('position');
                        if (posAttr && posAttr.count * 3 === newColors.length) {
                            geom.setAttribute('color', new THREE.BufferAttribute(linearColors, 3));
                            geom.attributes.color.needsUpdate = true;
                            data.face_colors = updates.face_colors;
                        } else {
                            success = false;
                        }
                    }
                }
            }
        }

        // Update material vertexColors setting
        if (object.material) {
            const hasVertexColors = data.vertex_colors && data.vertex_colors.length > 0;
            const hasFaceColors = data.face_colors && data.face_colors.length > 0;
            object.material.vertexColors = hasVertexColors || hasFaceColors;
            object.material.needsUpdate = true;
        }

        if (success && shouldInvalidateBVH) {
            invalidateMeshBVH(objData);
        }

        return success;
    }

    // In-place updates for points objects
    function tryInPlacePointsUpdate(objData, updates) {
        const { object, data } = objData;
        let success = true;

        if (updates.points !== undefined) {
            const count = updates.points.length;
            if (object.count === count) {
                const scale = data.scale || [1, 1, 1];
                const dummy = new THREE.Object3D();
                for (let i = 0; i < count; i++) {
                    const p = updates.points[i];
                    dummy.position.set(
                        p[0] * scale[0],
                        p[1] * scale[1],
                        p[2] * scale[2]
                    );
                    dummy.updateMatrix();
                    object.setMatrixAt(i, dummy.matrix);
                }
                object.instanceMatrix.needsUpdate = true;
                data.points = updates.points;
            } else {
                success = false;
            }
        }

        if (updates.colors !== undefined) {
            const count = updates.colors.length;
            if (object.count === count && object.instanceColor) {
                for (let i = 0; i < count; i++) {
                    const c = updates.colors[i];
                    object.setColorAt(i, parseColor(c));
                }
                object.instanceColor.needsUpdate = true;
                data.colors = updates.colors;
            } else {
                success = false;
            }
        }

        // Handle point size (requires rebuild)
        if (updates.size !== undefined && updates.size !== data.size) {
            success = false;
        }

        return success;
    }

    // Rebuild the entire object when in-place updates aren't possible
    function rebuildObject(objData, updates) {
        const { type, data } = objData;
        const isSelected = selectedObject && selectedObject.data.id === data.id;
        const newData = { ...data, ...updates };

        deleteObject(data.id);
        
        switch (type) {
            case 'mesh':
                addMesh(newData);
                break;
            case 'animated_mesh':
                addAnimatedMesh(newData);
                break;
            case 'points':
                addPoints(newData);
                break;
            case 'arrows':
                addArrows(newData);
                break;
        }

        if (isSelected) {
            selectedObject = { type: objects[data.id].type, data: objects[data.id].data };
            if (typeof onSelectObject === 'function') {
                onSelectObject(selectedObject);
            }
        }
    }

    // Update transform properties (position, rotation, scale)
    function updateTransforms(objData, updates) {
        const { object, data, type } = objData;

        if (updates.position !== undefined) {
            object.position.set(updates.position[0], updates.position[1], updates.position[2]);
            data.position = updates.position;
        }

        if (updates.rotation !== undefined) {
            object.rotation.set(updates.rotation[0], updates.rotation[1], updates.rotation[2]);
            data.rotation = updates.rotation;
        }

        if (updates.scale !== undefined) {
            if (type === 'points') {
                // For points, scale affects individual point positions
                data.scale = updates.scale;
                const originalPoints = data.points;
                const scale = updates.scale;
                const dummy = new THREE.Object3D();
                for (let i = 0; i < originalPoints.length; i++) {
                    const p = originalPoints[i];
                    dummy.position.set(
                        p[0] * scale[0],
                        p[1] * scale[1],
                        p[2] * scale[2]
                    );
                    dummy.updateMatrix();
                    object.setMatrixAt(i, dummy.matrix);
                }
                object.instanceMatrix.needsUpdate = true;
            } else {
                object.scale.set(updates.scale[0], updates.scale[1], updates.scale[2]);
                data.scale = updates.scale;
            }
        }
    }

    // Update material and other properties
    function updateProperties(objData, updates) {
        const { object, data, type } = objData;

        if (updates.visible !== undefined) {
            object.visible = updates.visible;
            data.visible = updates.visible;
        }

        if (updates.opacity !== undefined) {
            data.opacity = updates.opacity;
            data.originalOpacity = updates.opacity;
            
            if (type === 'arrows') {
                // Arrows have multiple materials (one per child)
                object.children.forEach(child => {
                    if (child.material) {
                        child.material.opacity = updates.opacity;
                        child.material.transparent = updates.opacity < 1.0;
                    }
                });
            } else if (object.material) {
                // Single material objects
                object.material.opacity = updates.opacity;
                object.material.transparent = updates.opacity < 1.0;
            }
        }

        if (updates.material !== undefined && object.material) {
            const newMaterial = updateMaterial(object.material, updates.material);
            
            // if mat type changed we reassign using newMaterial 
            // (otherwise updates are done in-place on `object.material` in `updateMaterial`)
            if (newMaterial.type !== object.material.type) {
                const vertexColors = object.material.vertexColors;
                object.material.dispose();
                object.material = newMaterial;
                object.material.vertexColors = vertexColors;
            }
            
            data.material = updates.material;
            if (updates.material.opacity !== undefined && !data.originalOpacity) {
                data.originalOpacity = updates.material.opacity;
            }
        }

        // Handle any other properties not explicitly handled above
        const handledProps = ['visible', 'opacity', 'position', 'rotation', 'scale', 'material'];
        for (const [key, value] of Object.entries(updates)) {
            if (!handledProps.includes(key)) {
                data[key] = value;
            }
        }

        applySlicingPlaneToObject(objData);
    }

    function updateSelectionIfNeeded(objData, id) {
        if (selectedObject && selectedObject.data.id === id) {
            if (slicingPlane.isEnabled()) {
                syncGizmoAttachment();
            }
            if (typeof onSelectObject === 'function') {
                onSelectObject({ type: objData.type, data: objData.data });
            }
        }
    }
    
    function deleteObject(id) {
        const objData = objects[id];
        if (!objData) return;
        
        const { object } = objData;
        disposeObjectSelectionOverlay(id);
        
        scene.remove(object);
        
        if (normalHelpers[id]) {
            scene.remove(normalHelpers[id]);
            if (normalHelpers[id].geometry) {
                normalHelpers[id].geometry.dispose();
            }
            if (normalHelpers[id].material) {
                normalHelpers[id].material.dispose();
            }
            delete normalHelpers[id];
        }
        
        if (object.geometry) {
            if (object.geometry.boundsTree && typeof object.geometry.disposeBoundsTree === 'function') {
                object.geometry.disposeBoundsTree();
            }
            object.geometry.dispose();
        }
        
        if (object.material) {
            if (Array.isArray(object.material)) {
                object.material.forEach(material => material.dispose());
            } else {
                object.material.dispose();
            }
        }
        
        delete objects[id];
        delete selectionByObject[id];
        if (lastSelectionInfo && lastSelectionInfo.object_name === id) {
            lastSelectionInfo = null;
        }
        
        if (selectedObject && selectedObject.data.id === id) {
            selectedObject = null;
            applySlicingPlaneToAllObjects();
            syncGizmoAttachment();
            if (typeof onSelectObject === 'function') {
                onSelectObject(null);
            }
        }
    }
    
    function onWindowResize(width, height) {
        if (!width || !height) {
            const containerRect = container.getBoundingClientRect();
            width = containerRect.width;
            height = containerRect.height;
        }
        
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, true);
        renderer.setPixelRatio(window.devicePixelRatio);
        resizeSelectionCanvas();
        drawSelectionOverlayCanvas();
    }
    
    function update() {
        controls.update();
        
        // Update gizmo
        if (gizmo) {
            gizmo.update();
        }

        // Update animated meshes
        const currentTime = Date.now() / 1000;
        for (const [id, objData] of Object.entries(objects)) {
            if (objData.type === 'animated_mesh' && objData.animation.isPlaying) {
                const animation = objData.animation;
                const elapsed = currentTime - animation.startTime;
                const frameFloat = (elapsed * animation.framerate) % animation.numFrames;
                const currentFrame = Math.floor(frameFloat);
                let currentVertices;
                if (animation.useFaceColors && animation.expandedVerticesFrames) {
                    currentVertices = animation.expandedVerticesFrames[currentFrame];
                } else {
                    currentVertices = animation.vertices[currentFrame];
                }
                // Update geometry
                const vertices = new Float32Array(currentVertices.flat());
                objData.object.geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
                objData.object.geometry.attributes.position.needsUpdate = true;
                // Recompute normals if needed
                if (!objData.data.wireframe) {
                    objData.object.geometry.computeVertexNormals();
                }
                animation.currentFrame = currentFrame;
            }
        }
        
        // Update normal helpers if they exist
        if (renderSettings.showNormals) {
            for (const [id, helper] of Object.entries(normalHelpers)) {
                if (helper && helper.update) {
                    helper.update();
                }
            }
        }

        // Update inspection highlight for moving objects
        if (inspectionData && (inspectionData.type === 'mesh' || inspectionData.type === 'animated_mesh')) {
            const obj = inspectionData.object;
            const geom = obj.geometry;
            const posAttr = geom.getAttribute('position');
            if (posAttr) {
                const ai = inspectionData.vertexIndices[0];
                const bi = inspectionData.vertexIndices[1];
                const ci = inspectionData.vertexIndices[2];
                const v0 = new THREE.Vector3(posAttr.array[ai * 3], posAttr.array[ai * 3 + 1], posAttr.array[ai * 3 + 2]);
                const v1 = new THREE.Vector3(posAttr.array[bi * 3], posAttr.array[bi * 3 + 1], posAttr.array[bi * 3 + 2]);
                const v2 = new THREE.Vector3(posAttr.array[ci * 3], posAttr.array[ci * 3 + 1], posAttr.array[ci * 3 + 2]);

                const worldMatrix = obj.matrixWorld;
                const w0 = v0.clone().applyMatrix4(worldMatrix);
                const w1 = v1.clone().applyMatrix4(worldMatrix);
                const w2 = v2.clone().applyMatrix4(worldMatrix);

                if (inspectionHighlight) {
                    const arr = inspectionHighlight.geometry.getAttribute('position').array;
                    arr[0] = v0.x; arr[1] = v0.y; arr[2] = v0.z;
                    arr[3] = v1.x; arr[4] = v1.y; arr[5] = v1.z;
                    arr[6] = v2.x; arr[7] = v2.y; arr[8] = v2.z;
                    inspectionHighlight.geometry.attributes.position.needsUpdate = true;
                    inspectionHighlight.matrix.copy(worldMatrix);
                }

                if (inspectionVertexPoints) {
                    const arr = inspectionVertexPoints.geometry.getAttribute('position').array;
                    arr[0] = w0.x; arr[1] = w0.y; arr[2] = w0.z;
                    arr[3] = w1.x; arr[4] = w1.y; arr[5] = w1.z;
                    arr[6] = w2.x; arr[7] = w2.y; arr[8] = w2.z;
                    inspectionVertexPoints.geometry.attributes.position.needsUpdate = true;
                }

                const bary = inspectionData.barycentric;
                const localPoint = v0.clone().multiplyScalar(bary.u)
                    .add(v1.clone().multiplyScalar(bary.v))
                    .add(v2.clone().multiplyScalar(bary.w));
                inspectionPoint.copy(localPoint.applyMatrix4(worldMatrix));
            }
        }

        // Reposition inspection overlay if active
        if (inspectionDiv.style.display !== 'none' && inspectionPoint) {
            const vector = inspectionPoint.clone().project(camera);
            const rect = container.getBoundingClientRect();
            const x = rect.left + (vector.x + 1) / 2 * rect.width;
            const y = rect.top + (-vector.y + 1) / 2 * rect.height;
            inspectionDiv.style.left = (x + 10) + 'px';
            inspectionDiv.style.top = (y - 10) + 'px';
        }

        renderer.render(scene, camera);
    }
    
    function resetCamera() {
        setCamera(window.panoptiConfig.viewer.camera);
        controls.update();
    }

    function setCamera(cam) {
        if (cam.position) {
            camera.position.set(cam.position[0], cam.position[1], cam.position[2]);
        }
        if (cam.quaternion) {
            camera.quaternion.set(cam.quaternion[0], cam.quaternion[1], cam.quaternion[2], cam.quaternion[3]);
        } else if (cam.rotation) {
            camera.rotation.set(cam.rotation[0], cam.rotation[1], cam.rotation[2]);
        }
        if (cam.up) {
            camera.up.set(cam.up[0], cam.up[1], cam.up[2]);
        }
        if (cam.fov !== undefined) camera.fov = cam.fov;
        if (cam.near !== undefined) camera.near = cam.near;
        if (cam.far !== undefined) camera.far = cam.far;
        if (cam.aspect !== undefined) camera.aspect = cam.aspect;
        if (cam.projection_mode) {
            const mode = cam.projection_mode;
            if (mode === 'orthographic' && !camera.isOrthographicCamera) {
                const { clientWidth, clientHeight } = container;
                const ortho = new THREE.OrthographicCamera(
                    clientWidth / -2, clientWidth / 2,
                    clientHeight / 2, clientHeight / -2,
                    camera.near, camera.far
                );
                ortho.position.copy(camera.position);
                ortho.rotation.copy(camera.rotation);
                camera = ortho;
                controls.object = camera;
            } else if (mode === 'perspective' && !camera.isPerspectiveCamera) {
                const persp = new THREE.PerspectiveCamera(
                    camera.fov, camera.aspect, camera.near, camera.far
                );
                persp.position.copy(camera.position);
                persp.rotation.copy(camera.rotation);
                camera = persp;
                controls.object = camera;
            }
        }
        if (cam.target) {
            controls.target.set(cam.target[0], cam.target[1], cam.target[2]);
            camera.lookAt(cam.target[0], cam.target[1], cam.target[2]);
        }
        camera.updateProjectionMatrix();
        // controls.update();
    }

    function lookAt(position, target) {
        setCamera({ position, target });
    }
    
    function setBackgroundColor(colorHex) {
        scene.background = parseColor(colorHex);
    }
    
    function clearAllObjects() {
        Object.keys(objects).forEach(deleteObject);
        Object.keys(selectionByObject).forEach(key => delete selectionByObject[key]);
        lastSelectionInfo = null;
        cancelSelectionInteraction();
        clearSelectionOverlayCanvas();
        if (typeof onSceneObjectsChange === 'function') {
            onSceneObjectsChange();
        }
    }
    
    function dispose() {
        window.removeEventListener('pointerup', handlePointerUp);
        window.removeEventListener('pointercancel', cancelSelectionInteraction);
        document.removeEventListener('keydown', handleSelectionKeyDown);
        document.removeEventListener('keyup', handleSelectionKeyUp);
        container.removeEventListener('pointerdown', handlePointerDown);
        container.removeEventListener('pointermove', handlePointerMove);
        container.removeEventListener('pointerleave', handlePointerLeave);

        clearAllObjects();
        clearInspectionHighlights();
        if (container.contains(inspectionDiv)) {
            container.removeChild(inspectionDiv);
        }
        if (container.contains(selectionCanvas)) {
            container.removeChild(selectionCanvas);
        }

        slicingPlane.dispose();
        
        // Dispose gizmo
        if (gizmo) {
            gizmo.dispose();
        }
        
        if (renderer) {
            renderer.dispose();
            if (container.contains(renderer.domElement)) {
                container.removeChild(renderer.domElement);
            }
        }
    }
    
    function applyRenderSettings(settings) {
        renderSettings = { ...settings };
        
        for (const [id, objData] of Object.entries(objects)) {
            if (objData.type === 'mesh' || objData.type === 'animated_mesh') {
                const { object, data } = objData;

                if (object.material && !Array.isArray(object.material)) {
                    const mat = object.material;

                    if (object.userData.wireframeHelper) {
                        object.remove(object.userData.wireframeHelper);
                        if (object.userData.wireframeHelper.geometry) {
                            object.userData.wireframeHelper.geometry.dispose();
                        }
                        if (object.userData.wireframeHelper.material) {
                            object.userData.wireframeHelper.material.dispose();
                        }
                        object.userData.wireframeHelper = null;
                    }

                    const original = object.userData.originalWireframe;

                    if (renderSettings.wireframe === 0) {
                        mat.wireframe = original;
                    } else if (renderSettings.wireframe === 1) {
                        mat.wireframe = false;
                    } else if (renderSettings.wireframe === 2) {
                        mat.wireframe = false;
                        const wireGeometry = new THREE.WireframeGeometry(object.geometry);
                        const wireframeHelper = new THREE.LineSegments(wireGeometry);
                        wireframeHelper.material.depthTest = true;
                        wireframeHelper.material.transparent = true;
                        wireframeHelper.material.color = new THREE.Color(0, 0, 0);
                        object.add(wireframeHelper);
                        object.userData.wireframeHelper = wireframeHelper;
                    } else if (renderSettings.wireframe === 3) {
                        mat.wireframe = true;
                    }

                    mat.flatShading = renderSettings.flatShading;
                    mat.vertexColors = (data.vertex_colors || data.face_colors) ? true : false;
                    // mat.transparent = data.opacity < 1.0;
                    // mat.opacity = data.opacity;
                    mat.needsUpdate = true;

                    if (object.geometry && object.geometry.computeVertexNormals) {
                        object.geometry.computeVertexNormals();
                    }
                }

                if (renderSettings.showNormals) {
                    if (!normalHelpers[id]) {
                        const normalHelper = new VertexNormalsHelper(object, 0.2, 0x00ff00, 1);
                        scene.add(normalHelper);
                        normalHelpers[id] = normalHelper;
                    }
                } else {
                    if (normalHelpers[id]) {
                        scene.remove(normalHelpers[id]);
                        if (normalHelpers[id].geometry) {
                            normalHelpers[id].geometry.dispose();
                        }
                        if (normalHelpers[id].material) {
                            normalHelpers[id].material.dispose();
                        }
                        delete normalHelpers[id];
                    }
                }

                applySlicingPlaneToObject(objData);
            }
        }
        
        gridHelper.visible = renderSettings.showGrid;
        axesHelper.visible = renderSettings.showAxes;
        return selectedObject;
    }
    
    // Get the currently selected object
    function getSelectedObject() {
        return selectedObject;
    }
    
    // Get all objects in the scene
    function getAllObjects() {
        return Object.entries(objects).map(([id, obj]) => ({
            id,
            type: obj.type,
            visible: obj.object.visible,
            data: obj.data
        }));
    }

    // Allow external components to programmatically select/deselect an object
    function selectObject(id) {
        if (id === null) {
            selectedObject = null;
            applySlicingPlaneToAllObjects();
            syncGizmoAttachment();
            if (typeof onSelectObject === 'function') {
                onSelectObject(null);
            }
            event_select_object(null);
            return;
        }
        const objData = objects[id];
        if (objData) {
            const previousSelectedId = selectedObject?.data?.id || null;
            selectedObject = { ...objData };
            if (slicingPlane.isEnabled() && previousSelectedId !== id) {
                centerSlicingPlaneOnSelectedObject(false);
            }
            applySlicingPlaneToAllObjects();
            syncGizmoAttachment();
            if (typeof onSelectObject === 'function') {
                onSelectObject(selectedObject);
            }
            event_select_object(id);
        }
    }
    
    // Toggle animated mesh playback method
    function toggleAnimatedMeshPlayback(objectId) {
        const objData = objects[objectId];
        if (objData && objData.type === 'animated_mesh') {
            const isCurrentlyPlaying = objData.animation.isPlaying;
            
            // Update local animation state
            objData.animation.isPlaying = !isCurrentlyPlaying;
            if (objData.animation.isPlaying) {
                objData.animation.startTime = Date.now() / 1000;
            } else {
                objData.animation.startTime = null;
            }
            
            // Update data for UI
            objData.data.is_playing = objData.animation.isPlaying;
        }
    }

    function getScreenshot(bgColor = null, width = undefined, height = undefined) {
        const prevColor = new THREE.Color();
        renderer.getClearColor(prevColor);
        const prevAlpha = renderer.getClearAlpha();
        const prevBackgroundColor = scene.background ? scene.background.clone() : null;

        // Store previous renderer and camera settings
        const prevSize = renderer.getSize(new THREE.Vector2());
        const prevPixelRatio = renderer.getPixelRatio();
        const prevAspect = camera.aspect;
        let didResize = false;
        if (width !== undefined && height !== undefined) {
            // Set renderer size and camera aspect
            renderer.setSize(width, height, false);
            renderer.setPixelRatio(1); // for screenshots, use 1:1 pixel ratio
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            didResize = true;
        }

        if (bgColor === null) { // transparent background
            renderer.setClearColor(0x000000, 0);
            scene.background = null;
        } else { // solid background
            scene.background = parseColor(bgColor);
        }
        renderer.render(scene, camera);
        const dataURL = renderer.domElement.toDataURL('image/png');
        
        // Restore previous settings
        renderer.setClearColor(prevColor, prevAlpha);
        if (prevBackgroundColor) {
            scene.background = prevBackgroundColor;
        } else {
            scene.background = null;
        }
        if (didResize) {
            renderer.setSize(prevSize.x, prevSize.y, false);
            renderer.setPixelRatio(prevPixelRatio);
            camera.aspect = prevAspect;
            camera.updateProjectionMatrix();
        }
        return dataURL;
    }

    function event_select_object(id) {
        const payload = { selected_object: id };
        if (window.viewerId) payload.viewer_id = window.viewerId;
        socket.emit('events.select_object', payload);
    }

    function setSelectionTool(nextTool = {}) {
        const prevMode = selectionTool.mode;
        selectionTool = { ...selectionTool, ...nextTool };
        if (!selectionTool.enabled || prevMode !== selectionTool.mode) {
            cancelSelectionInteraction();
            clearSelectionOverlayCanvas();
        }
        if (!selectionTool.enabled) {
            selectionKeyState.add = false;
            selectionKeyState.subtract = false;
            brushCursor.valid = false;
        } else if (selectionTool.mode !== 'brush') {
            brushCursor.valid = false;
        }
        drawSelectionOverlayCanvas();
    }
    
    return {
        update,
        onWindowResize,
        resetCamera,
        setBackgroundColor,
        clearAllObjects,
        dispose,
        applyRenderSettings,
        getSelectedObject,
        getAllObjects,
        selectObject,
        updateObject,
        toggleAnimatedMeshPlayback,
        getScreenshot,
        getSelectionInfo,
        setSelectionTool,
        setSlicingPlaneEnabled,
        getSlicingPlaneEnabled: () => slicingPlane.isEnabled(),
        setCamera,
        lookAt,
        renderer,
        scene,
        camera,
        controls,
        // Gizmo methods
        gizmo,
        setGizmoEnabled: (enabled) => {
            gizmo.setEnabled(enabled);
            syncGizmoAttachment();
        },
        getGizmoEnabled: () => gizmo.isEnabled(),
        setGizmoMode: (mode) => gizmo.setMode(mode),
        getGizmoMode: () => gizmo.getMode(),
        isGizmoDragging: () => gizmo.isDragging()
    };
}
