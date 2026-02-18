import React from 'react';
import ReactDOM from 'react-dom';

const SELECTION_MODE_DEFS = [
    // { id: 'box', label: 'Box Selection', icon: 'fas fa-vector-square' },
    { id: 'box', label: 'Box Selection', icon: 'mdi mdi-selection-drag mdi-18px' },
    // { id: 'lasso', label: 'Lasso Selection', icon: 'fas fa-draw-polygon' },
    { id: 'lasso', label: 'Lasso Selection', icon: 'mdi mdi-lasso mdi-18px' },
    { id: 'brush', label: 'Brush Selection', icon: 'fas fa-paint-brush' },
    { id: 'bucket', label: 'Bucket Selection', icon: 'fas fa-fill-drip' },
];

function getSelectionModeDef(mode) {
    return SELECTION_MODE_DEFS.find(def => def.id === mode) || SELECTION_MODE_DEFS[0];
}

function SelectionToolSplitButton({
    selectionTool,
    onToggleSelectionTool,
    onSetSelectionMode,
    onUpdateSelectionOption
}) {
    const [menuOpen, setMenuOpen] = React.useState(false);
    const rootRef = React.useRef(null);
    const menuRef = React.useRef(null);
    const [menuPos, setMenuPos] = React.useState({ top: 0, left: 0, minWidth: 236 });
    const currentMode = getSelectionModeDef(selectionTool.mode);

    const updateMenuPos = React.useCallback(() => {
        if (!rootRef.current) return;
        const rect = rootRef.current.getBoundingClientRect();
        setMenuPos({
            top: rect.bottom + 6,
            left: rect.left,
            minWidth: Math.max(236, rect.width + 120)
        });
    }, []);

    React.useEffect(() => {
        if (!menuOpen) return undefined;

        updateMenuPos();

        const handleOutsideClick = (event) => {
            const inRoot = rootRef.current && rootRef.current.contains(event.target);
            const inMenu = menuRef.current && menuRef.current.contains(event.target);
            if (!inRoot && !inMenu) {
                setMenuOpen(false);
            }
        };

        const handleEscape = (event) => {
            if (event.key === 'Escape') {
                setMenuOpen(false);
            }
        };

        const handleRelayout = () => updateMenuPos();

        document.addEventListener('mousedown', handleOutsideClick);
        document.addEventListener('keydown', handleEscape);
        window.addEventListener('resize', handleRelayout);
        window.addEventListener('scroll', handleRelayout, true);
        return () => {
            document.removeEventListener('mousedown', handleOutsideClick);
            document.removeEventListener('keydown', handleEscape);
            window.removeEventListener('resize', handleRelayout);
            window.removeEventListener('scroll', handleRelayout, true);
        };
    }, [menuOpen, updateMenuPos]);

    const renderModeOptions = () => {
        if (selectionTool.mode === 'box' || selectionTool.mode === 'lasso') {
            return React.createElement(
                'label',
                { className: 'selection-mode-option' },
                React.createElement('input', {
                    type: 'checkbox',
                    checked: !!selectionTool.visibleOnly,
                    onChange: (e) => onUpdateSelectionOption('visibleOnly', e.target.checked),
                }),
                React.createElement('span', null, 'Visible only'),
            );
        }

        if (selectionTool.mode === 'brush') {
            return React.createElement(
                'div',
                { className: 'selection-mode-option selection-mode-slider' },
                React.createElement(
                    'div',
                    { className: 'selection-mode-slider-row' },
                    React.createElement('span', null, 'Radius'),
                    React.createElement('span', null, Number(selectionTool.brushRadius || 0).toFixed(2))
                ),
                React.createElement('input', {
                    type: 'range',
                    min: 0.01,
                    max: 2.0,
                    step: 0.01,
                    value: selectionTool.brushRadius ?? 0.1,
                    onChange: (e) => onUpdateSelectionOption('brushRadius', parseFloat(e.target.value)),
                })
            );
        }

        if (selectionTool.mode === 'bucket') {
            return React.createElement(
                'label',
                { className: 'selection-mode-option' },
                React.createElement('input', {
                    type: 'checkbox',
                    checked: !!selectionTool.bucketSelectComponent,
                    onChange: (e) => onUpdateSelectionOption('bucketSelectComponent', e.target.checked),
                }),
                React.createElement('span', null, 'Select component')
            );
        }

        return null;
    };

    return React.createElement(
        React.Fragment,
        null,
        React.createElement(
            'div',
            { className: 'selection-tool-dropdown', ref: rootRef },
            React.createElement(
                'div',
                { className: 'selection-tool-split' },
                React.createElement(
                    'button',
                    {
                        className: `toolbar-button split-main tooltip ${selectionTool.enabled ? 'active' : ''}`,
                        'data-tooltip': `${currentMode.label}${selectionTool.enabled ? ' (On)' : ' (Off)'}`,
                        onClick: onToggleSelectionTool
                    },
                    React.createElement('i', { className: currentMode.icon })
                ),
                React.createElement(
                    'button',
                    {
                        className: `toolbar-button split-caret ${menuOpen ? 'active' : ''}`,
                        onClick: () => setMenuOpen(prev => !prev),
                        title: 'Selection tool options'
                    },
                    React.createElement('i', { className: `fas fa-chevron-${menuOpen ? 'up' : 'down'}` })
                )
            )
        ),
        menuOpen && ReactDOM.createPortal(
            React.createElement(
                'div',
                {
                    ref: menuRef,
                    className: 'selection-tool-menu selection-tool-menu-overlay',
                    style: {
                        top: `${menuPos.top}px`,
                        left: `${menuPos.left}px`,
                        minWidth: `${menuPos.minWidth}px`
                    }
                },
                React.createElement('div', { className: 'selection-tool-menu-title' }, 'Selection Mode'),
                React.createElement(
                    'div',
                    { className: 'selection-tool-mode-list' },
                    SELECTION_MODE_DEFS.map(modeDef => React.createElement(
                        'button',
                        {
                            key: modeDef.id,
                            className: `selection-tool-mode-btn ${selectionTool.mode === modeDef.id ? 'active' : ''}`,
                            onClick: () => onSetSelectionMode(modeDef.id)
                        },
                        React.createElement('i', { className: modeDef.icon }),
                        React.createElement('span', null, modeDef.label)
                    ))
                ),
                React.createElement('div', { className: 'selection-tool-menu-divider' }),
                React.createElement('div', { className: 'selection-tool-menu-title' }, 'Options'),
                renderModeOptions(),
                React.createElement(
                    'div',
                    { className: 'selection-tool-hints' },
                    'A add, S subtract, D deselect'
                )
            ),
            document.body
        )
    );
}

export function changeBackgroundColor(sceneManagerRef, setBackgroundColor, color) {
    setBackgroundColor(color);
    if (sceneManagerRef.current) {
        sceneManagerRef.current.setBackgroundColor(color);
    }
}

export function resetCamera(sceneManagerRef) {
    if (sceneManagerRef.current) {
        sceneManagerRef.current.resetCamera();
    }
}

export function toggleRenderSetting(sceneManagerRef, setRenderSettings, setting, value) {
    setRenderSettings(prev => {
        let newValue;
        if (setting === 'wireframe') {
            if (typeof value === 'number') {
                newValue = value;
            } else {
                newValue = (prev[setting] + 1) % 4;
            }
        } else {
            newValue = !prev[setting];
        }
        const newSettings = { ...prev, [setting]: newValue };
        if (sceneManagerRef.current) {
            sceneManagerRef.current.applyRenderSettings(newSettings);
        }
        return newSettings;
    });
}

export function updateLightSetting(sceneManagerRef, setLightSettings, setting, value) {
    setLightSettings(prev => {
        const newSettings = { ...prev, [setting]: value };
        if (sceneManagerRef.current) {
            sceneManagerRef.current.applyLightSettings(newSettings);
        }
        return newSettings;
    });
}

export function captureCurrentView(rendererRef, sceneManagerRef, setCapturedImage, setShowRenderModal) {
    if (!rendererRef.current) return;
    rendererRef.current.render(sceneManagerRef.current.scene, sceneManagerRef.current.camera);
    const dataURL = rendererRef.current.domElement.toDataURL('image/png');
    setCapturedImage(dataURL);
    setShowRenderModal(true);
}

export async function renderToClipboard(rendererRef, sceneManagerRef) {
    if (!rendererRef.current) return;
    try {
        rendererRef.current.render(sceneManagerRef.current.scene, sceneManagerRef.current.camera);
        rendererRef.current.domElement.toBlob(async (blob) => {
            if (blob && navigator.clipboard && navigator.clipboard.write) {
                const item = new ClipboardItem({ 'image/png': blob });
                await navigator.clipboard.write([item]);
            } else {
                console.warn('Clipboard API not supported');
            }
        }, 'image/png');
    } catch (error) {
        console.error('Failed to copy to clipboard:', error);
    }
}

export function saveImage(capturedImage, setShowRenderModal, setCapturedImage) {
    if (!capturedImage) return;
    const link = document.createElement('a');
    link.download = 'panopti-render.png';
    link.href = capturedImage;
    link.click();
    setShowRenderModal(false);
    setCapturedImage(null);
}

export function discardImage(setShowRenderModal, setCapturedImage) {
    setShowRenderModal(false);
    setCapturedImage(null);
}

export function renderSceneToolbar({ resetCamera, toggleBackgroundColor, refreshState, restartScript, toggleConsole, isDark }) {
    return React.createElement(
        'div',
        { className: 'scene-toolbar' },
        React.createElement(
            'button',
            { className: 'toolbar-button tooltip', 'data-tooltip': 'Reset Camera', onClick: resetCamera },
            React.createElement('i', { className: 'fa-solid fa-camera-rotate' })
        ),
        React.createElement(
            'button',
            {
                className: 'toolbar-button tooltip',
                'data-tooltip': isDark ? 'Light Background' : 'Dark Background',
                onClick: toggleBackgroundColor
            },
            React.createElement('i', { className: isDark ? 'fas fa-sun' : 'fas fa-moon' })
        ),
        React.createElement(
            'button',
            { className: 'toolbar-button tooltip', 'data-tooltip': 'Refresh Scene', onClick: refreshState },
            React.createElement('i', { className: ' mdi mdi-cloud-sync', style: { fontSize: '20px' } })
        ),
        React.createElement(
            'button',
            {
                className: 'toolbar-button tooltip',
                'data-tooltip': 'Restart Script',
                onClick: restartScript,
                disabled: false
            },
            React.createElement('i', { className: 'fas fa-sync-alt' }),
        ),
        React.createElement(
            'button',
            { className: 'toolbar-button tooltip', 'data-tooltip': 'Show Console', onClick: toggleConsole },
            React.createElement('i', { className: 'fas fa-terminal' })
        )
    );
}

export function renderRenderToolbar(
    renderSettings,
    toggleRenderSetting,
    captureCurrentView,
    renderToClipboard,
    gizmoEnabled = false,
    toggleGizmo = null,
    slicingPlaneEnabled = false,
    toggleSlicingPlane = null,
    selectionTool = null,
    onToggleSelectionTool = null,
    onSetSelectionMode = null,
    onUpdateSelectionOption = null
) {
    return React.createElement(
        'div',
        { className: 'render-toolbar' },
        React.createElement(
            'button',
            {
                className: `toolbar-button tooltip ${renderSettings.flatShading ? 'active' : ''}`,
                'data-tooltip': renderSettings.flatShading ?  'Shading mode: Flat' : 'Shading mode: Smooth',
                onClick: () => toggleRenderSetting('flatShading')
            },
            React.createElement(
                'span',
                {
                    className: `material-symbols-outlined ${renderSettings.flatShading ? 'ms-outlined' : 'ms-filled'}`,
                },
                'ev_shadow'
            )
        ),
        React.createElement(
            'button',
            {
                className: `toolbar-button tooltip ${renderSettings.showNormals ? 'active' : ''}`,
                'data-tooltip': renderSettings.showNormals ? 'Hide Normals' : 'Show Normals',
                onClick: () => toggleRenderSetting('showNormals')
            },
            React.createElement(
                'span',
                { className: `material-symbols-outlined`, style: { transform: 'rotate(-90deg)' } },
                'start'
            )
        ),
        React.createElement('div', { className: 'toolbar-separator' }),
        React.createElement(
            'div',
            { className: 'segmented-control wireframe-segmented' },
            [
                { mode: 1, icon: 'fas fa-cube', tooltip: 'Render mode: Surface' },
                { mode: 2, icon: 'fa-solid fa-border-top-left', tooltip: 'Render mode: Surface + Wireframe' },
                { mode: 3, icon: 'fas fa-vector-square', tooltip: 'Render mode: Wireframe Only' }
            ].map(opt =>
                React.createElement(
                    'button',
                    {
                        key: opt.mode,
                        className: `toolbar-button segmented${renderSettings.wireframe === opt.mode ? ' active' : ''} tooltip`,
                        'data-tooltip': opt.tooltip,
                        onClick: () => toggleRenderSetting('wireframe', renderSettings.wireframe === opt.mode ? 0 : opt.mode)
                    },
                    React.createElement('i', { className: opt.icon })
                )
            )
        ),
        React.createElement('div', { className: 'toolbar-separator' }),
        React.createElement(
            'button',
            {
                className: `toolbar-button tooltip ${renderSettings.showGrid ? 'active' : ''}`,
                'data-tooltip': renderSettings.showGrid ? 'Disable Grid' : 'Enable Grid',
                onClick: () => toggleRenderSetting('showGrid')
            },
            React.createElement('i', { className: 'fas fa-border-all' })
        ),
        React.createElement(
            'button',
            {
                className: `toolbar-button tooltip ${renderSettings.showAxes ? 'active' : ''}`,
                'data-tooltip': renderSettings.showAxes ? 'Disable Axes' : 'Enable Axes', 
                onClick: () => toggleRenderSetting('showAxes')
            },
            React.createElement('i', { className: 'mdi mdi-axis-arrow', style: { fontSize: '20px' } })
        ),
        React.createElement(
            'button',
            {
                className: `toolbar-button tooltip ${renderSettings.inspectMode ? 'active' : ''}`,
                'data-tooltip': 'Inspect Vertices/Faces',
                onClick: () => toggleRenderSetting('inspectMode')
            },
            React.createElement('i', { className: 'fas fa-search' })
        ),
        selectionTool && onToggleSelectionTool && onSetSelectionMode && onUpdateSelectionOption && React.createElement(
            SelectionToolSplitButton,
            {
                selectionTool,
                onToggleSelectionTool,
                onSetSelectionMode,
                onUpdateSelectionOption
            }
        ),
        // Gizmo toggle button
        toggleGizmo && React.createElement(
            'button',
            {
                className: `toolbar-button tooltip ${gizmoEnabled ? 'active' : ''}`,
                'data-tooltip': gizmoEnabled ? 'Disable Transform Gizmo' : 'Enable Transform Gizmo (E/R/T for translate/rotate/scale)',
                onClick: toggleGizmo
            },
            React.createElement('i', { className: 'fas fa-arrows-alt' })
        ),
        toggleSlicingPlane && React.createElement(
            'button',
            {
                className: `toolbar-button tooltip ${slicingPlaneEnabled ? 'active' : ''}`,
                'data-tooltip': slicingPlaneEnabled ? 'Disable Slicing Plane' : 'Slice Selected Object',
                onClick: toggleSlicingPlane
            },
            React.createElement('i', { className: 'fas fa-cut' })
        ),
        React.createElement('div', { className: 'toolbar-separator' }),
        React.createElement(
            'button',
            { className: 'toolbar-button tooltip', 'data-tooltip': 'Render View', onClick: captureCurrentView },
            React.createElement('i', { className: 'fas fa-camera' })
        ),
        React.createElement(
            'button',
            { className: 'toolbar-button tooltip', 'data-tooltip': 'Render to Clipboard', onClick: renderToClipboard },
            React.createElement('i', { className: 'fas fa-clipboard' })
        )
    );
}

export function renderLightingToolbar(lightSettings, updateLightSetting) {
    const openColorPicker = (setting, currentColor) => {
        const input = document.createElement('input');
        input.type = 'color';
        input.value = currentColor;
        input.addEventListener('input', (e) => {
            updateLightSetting(setting, e.target.value);
        });
        input.click();
    };
    return React.createElement(
        'div',
        { className: 'lighting-toolbar' },
        React.createElement(
            'button',
            {
                className: 'toolbar-button tooltip',
                'data-tooltip': 'Ambient Light Color',
                onClick: () => openColorPicker('ambientColor', lightSettings.ambientColor),
                style: { backgroundColor: lightSettings.ambientColor }
            },
            React.createElement('i', { className: 'fas fa-lightbulb' })
        ),
        React.createElement(
            'button',
            {
                className: 'toolbar-button tooltip',
                'data-tooltip': 'Decrease Ambient Light',
                onClick: () => updateLightSetting('ambientIntensity', Math.max(0.1, lightSettings.ambientIntensity - 0.5))
            },
            React.createElement('i', { className: 'fas fa-minus' })
        ),
        React.createElement(
            'button',
            {
                className: 'toolbar-button tooltip',
                'data-tooltip': 'Increase Ambient Light',
                onClick: () => updateLightSetting('ambientIntensity', Math.min(5.0, lightSettings.ambientIntensity + 0.5))
            },
            React.createElement('i', { className: 'fas fa-plus' })
        ),
        React.createElement(
            'button',
            {
                className: 'toolbar-button tooltip',
                'data-tooltip': 'Directional Light Color',
                onClick: () => openColorPicker('directionalColor', lightSettings.directionalColor),
                style: { backgroundColor: lightSettings.directionalColor }
            },
            React.createElement('i', { className: 'fas fa-sun' })
        ),
        React.createElement(
            'button',
            {
                className: 'toolbar-button tooltip',
                'data-tooltip': 'Decrease Directional Light',
                onClick: () => updateLightSetting('directionalIntensity', Math.max(0.1, lightSettings.directionalIntensity - 0.5))
            },
            React.createElement('i', { className: 'fas fa-minus' })
        ),
        React.createElement(
            'button',
            {
                className: 'toolbar-button tooltip',
                'data-tooltip': 'Increase Directional Light',
                onClick: () => updateLightSetting('directionalIntensity', Math.min(5.0, lightSettings.directionalIntensity + 0.5))
            },
            React.createElement('i', { className: 'fas fa-plus' })
        )
    );
}
