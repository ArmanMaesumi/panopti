import React from 'react';

export function exportObject(objectId) {
    const link = document.createElement('a');
    const vid = window.viewerId || '';
    link.href = `/export/${vid}/${objectId}`;
    console.log(`Exporting object ${objectId} from ${link.href}`);
    link.download = `${objectId}.obj`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

export function toggleObjectVisibility(sceneManagerRef, sceneObjects, objectId, updateSceneObjectsList) {
    if (!sceneManagerRef.current) return;
    const obj = sceneObjects.find(o => o.id === objectId);
    if (!obj) return;
    
    // Get the current material opacity from the scene object
    let currentOpacity = 1.0;
    if (obj.data.material && obj.data.material.opacity !== undefined) {
        currentOpacity = obj.data.material.opacity;
    } else if (obj.data.opacity !== undefined) {
        currentOpacity = obj.data.opacity;
    }
    
    let newVisibility = 'visible';
    let newOpacity = 1.0;
    
    if (obj.visible && currentOpacity === 1.0) {
        // Going from visible to semi-visible
        // Use original opacity if it was less than 1.0, otherwise use 0.3
        newVisibility = 'semi';
        newOpacity = (obj.data.originalOpacity && obj.data.originalOpacity < 1.0) ? obj.data.originalOpacity : 0.3;
    } else if (obj.visible && currentOpacity < 1.0) {
        // Going from semi-visible to hidden
        newVisibility = 'hidden';
    } else {
        // Going from hidden to visible - restore original opacity
        newVisibility = 'visible';
        newOpacity = 1.0;
    }

    // For arrows toggle between [visible OR semi-visible (if opacity given)] and hidden
    if (obj.type === 'arrows') {
        if (newVisibility === 'semi' && obj.data.originalOpacity && obj.data.originalOpacity === 1.0) {
            newVisibility = 'hidden';
            newOpacity = 0.0;
        }
    }

    const updates = { visible: newVisibility !== 'hidden' };
    const updatedObj = sceneManagerRef.current.updateObject(objectId, updates);
    
    if (
        updatedObj &&
        (updatedObj.type === 'mesh' || updatedObj.type === 'points' || updatedObj.type == 'arrows' || updatedObj.type == 'animated_mesh') &&
        updatedObj.object.material
    ) {
        // Update the material's opacity directly
        updatedObj.object.material.opacity = newOpacity;
        updatedObj.object.material.transparent = newOpacity < 1.0;
        updatedObj.object.material.needsUpdate = true;
        
        // Also update the material data in the object's data structure
        if (updatedObj.type === 'points') {
            // For points, update the direct opacity field
            updatedObj.data.opacity = newOpacity;
        } else {
            // For meshes, update the material data
            if (!updatedObj.data.material) {
                updatedObj.data.material = {};
            }
            updatedObj.data.material.opacity = newOpacity;
            updatedObj.data.material.transparent = newOpacity < 1.0;
        }
    }
    
    updateSceneObjectsList();
}

export function toggleAnimatedMeshPlayback(sceneManagerRef, objectId, updateSceneObjectsList) {
    if (sceneManagerRef.current) {
        sceneManagerRef.current.toggleAnimatedMeshPlayback(objectId);
        updateSceneObjectsList();
    }
}

export function getObjectIcon(type) {
    switch (type) {
        case 'mesh':
            return 'mdi mdi-cube-outline mdi-24px';
        case 'animated_mesh':
            return 'mdi mdi-cube-send mdi-24px';
        case 'points':
            return 'mdi mdi-dots-triangle mdi-24px';
        case 'arrows':
            return 'mdi mdi-arrow-expand mdi-24px';
        default:
            return 'mdi mdi-help-circle-outline mdi-24px';
    }
}

export function getVisibilityIconClass(obj) {
    if (!obj.visible) {
        return 'fas fa-eye-slash visibility-hidden';
    } else {
        // Check opacity
        let opacity = 1.0;
        if (obj.data.material && obj.data.material.opacity !== undefined) {
            opacity = obj.data.material.opacity;
        } else if (obj.data.opacity !== undefined) {
            opacity = obj.data.opacity;
        }
        
        if (opacity < 1.0) {
            return 'fas fa-eye visibility-semi';
        } else {
            return 'fas fa-eye visibility-visible';
        }
    }
}

export function renderLayersPanel(sceneObjects, selectedObject, setSelectedObject, sceneManagerRef, updateSceneObjectsList, isCollapsed, onToggleCollapse, selectionToolEnabled = false, slicingPlaneEnabled = false) {
    const needsObject = !selectedObject && !isCollapsed;
    const showSelectObjectHint = selectionToolEnabled && needsObject;
    const showSlicingPlaneHint = slicingPlaneEnabled && needsObject && !showSelectObjectHint;

    return React.createElement(
        'div',
        { className: `layers-panel${isCollapsed ? ' collapsed' : ''}` },
        React.createElement(
            'div',
            { className: 'layers-panel-header' },
            React.createElement('h3', null, 'Objects'),
            React.createElement(
                'button',
                {
                    className: 'collapse-layers-btn tooltip',
                    'data-tooltip': isCollapsed ? 'Expand' : 'Collapse',
                    onClick: (e) => { e.stopPropagation(); onToggleCollapse && onToggleCollapse(); },
                    style: { transform: isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }
                },
                React.createElement('i', { className: 'fas fa-chevron-down' })
            )
        ),
        React.createElement(
            'div',
            { className: 'layers-panel-content', style: { position: 'relative' } },
            showSelectObjectHint && React.createElement(
                'div',
                { className: 'layers-panel-select-hint' },
                React.createElement('i', { className: 'fa-regular fa-hand-pointer' }),
                React.createElement('span', { className: 'layers-panel-select-hint-text' }, 'Select an object to use selection tools')
            ),
            showSlicingPlaneHint && React.createElement(
                'div',
                { className: 'layers-panel-select-hint' },
                React.createElement('i', { className: 'fas fa-cut' }),
                React.createElement('span', { className: 'layers-panel-select-hint-text' }, 'Select an object to slice')
            ),
            sceneObjects.length > 0
                ? sceneObjects.map(obj =>
                    React.createElement(
                        'div',
                        {
                            key: obj.id,
                            className: `layer-item ${selectedObject && selectedObject.data.id === obj.id ? 'selected' : ''} ${obj.data.warnings && obj.data.warnings.length > 0 ? 'warning' : ''}`,
                            onClick: () => {
                                const sceneObj = sceneManagerRef.current.getSelectedObject();
                                if (sceneObj && sceneObj.data.id === obj.id) {
                                    setSelectedObject(null);
                                    sceneManagerRef.current.selectObject(null);
                                } else {
                                    const objData = sceneManagerRef.current.getAllObjects().find(o => o.id === obj.id);
                                    if (objData) {
                                        setSelectedObject({ type: objData.type, data: objData.data });
                                        sceneManagerRef.current.selectObject(obj.id);
                                    }
                                }
                            }
                        },
                        React.createElement('i', { className: getObjectIcon(obj.type) }),
                        React.createElement('span', { className: 'layer-name' }, obj.id),
                        obj.data.warnings && obj.data.warnings.length > 0 &&
                            React.createElement('span', {
                                className: 'warning-icon tooltip',
                                'data-tooltip': obj.data.warnings.join('\n')
                            }, React.createElement('i', { className: 'fas fa-exclamation-circle' })),
                        React.createElement(
                            'div',
                            { className: 'layer-controls' },
                            obj.type === 'mesh' && React.createElement(
                                'button',
                                {
                                    className: 'export-button tooltip',
                                    'data-tooltip': 'Export as OBJ',
                                    onClick: (e) => {
                                        e.stopPropagation();
                                        exportObject(obj.id);
                                    }
                                },
                                React.createElement('i', { className: 'fas fa-download' })
                            ),
                            obj.type === 'animated_mesh' && React.createElement(
                                'button',
                                {
                                    className: 'play-pause-button tooltip',
                                    'data-tooltip': obj.data.is_playing ? 'Pause Animation' : 'Play Animation',
                                    onClick: (e) => {
                                        e.stopPropagation();
                                        toggleAnimatedMeshPlayback(sceneManagerRef, obj.id, updateSceneObjectsList);
                                    }
                                },
                                React.createElement('i', { className: obj.data.is_playing ? 'fas fa-pause' : 'fas fa-play' })
                            ),
                            (obj.type === 'animated_mesh' || obj.type === 'points') && React.createElement(
                                'button',
                                {
                                    className: 'export-button tooltip',
                                    'data-tooltip': 'Export as NPZ',
                                    onClick: (e) => {
                                        e.stopPropagation();
                                        exportObject(obj.id);
                                    }
                                },
                                React.createElement('i', { className: 'fas fa-download' })
                            ),
                            React.createElement(
                                'button',
                                {
                                    className: 'visibility-toggle',
                                    onClick: (e) => {
                                        e.stopPropagation();
                                        toggleObjectVisibility(sceneManagerRef, sceneObjects, obj.id, updateSceneObjectsList);
                                    }
                                },
                                React.createElement('i', { className: getVisibilityIconClass(obj) })
                            )
                        )
                    )
                )
                : React.createElement('p', { className: 'no-layers' }, 'No objects in scene')
        )
    );
}
