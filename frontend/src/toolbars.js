import React from 'react';

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

export function renderRenderToolbar(renderSettings, toggleRenderSetting, captureCurrentView, renderToClipboard, gizmoEnabled = false, toggleGizmo = null) {
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
        React.createElement(
            'button',
            {
                className: `toolbar-button tooltip ${renderSettings.boxInspectMode ? 'active' : ''}`,
                'data-tooltip': 'Box Inspect (drag to select vertices)',
                onClick: () => toggleRenderSetting('boxInspectMode')
            },
            React.createElement('i', { className: 'fas fa-vector-square' })
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
