import React from 'react';

const colorPalette = {
    red: '#e63946',
    orange: '#ff9500',
    green: '#38b000',
    yellow: '#ff9500',
    grey: '#6c757d',
};

export function renderStatusIndicator(connectionStatus, scriptStatus, ping) {
    const getServerStatusInfo = () => {
        if (connectionStatus === 'disconnected') {
            return {
                color: colorPalette.red,
                message: 'Disconnected',
                tooltip: 'No connection to Pantopti server'
            };
        } else if (connectionStatus === 'connected' || connectionStatus === 'ok') {
            return {
                color: colorPalette.green,
                message: 'OK',
                tooltip: 'Connected to Pantopti server'
            };
        } else if (connectionStatus === 'connecting') {
            return {
                color: colorPalette.yellow,
                message: 'Connecting...',
                tooltip: 'Attempting to connect to Panopti server'
            };
        } else if (connectionStatus === 'warning') {
            return {
                color: colorPalette.orange,
                message: 'Warning',
                tooltip: 'Panopti server is running but may have issues'
            };
        }
    };

    const getScriptStatusInfo = () => {
        if (connectionStatus === 'disconnected' || scriptStatus === 'unknown') {
            return {
                color: colorPalette.grey,
                message: 'Unknown',
                tooltip: 'User script status unknown'
            };
        }
        if (scriptStatus === 'terminated') {
            return {
                color: colorPalette.red,
                message: 'Stopped',
                tooltip: 'User script has been terminated'
            };
        } else if (scriptStatus === 'running') {
            return {
                color: colorPalette.green,
                message: 'Running',
                tooltip: 'User script is running'
            };
        } else if (scriptStatus === 'restarting') {
            return {
                color: colorPalette.orange,
                message: 'Starting...',
                tooltip: 'User script is restarting'
            };
        }
    };

    const serverStatusInfo = getServerStatusInfo();
    const scriptStatusInfo = getScriptStatusInfo();

    return React.createElement(
        'div',
        { className: 'status-indicators-container' },
        React.createElement(
            'div',
            { 
                className: 'status-indicator tooltip',
                'data-tooltip': serverStatusInfo.tooltip
            },
            React.createElement(
                'div',
                { className: 'status-label' },
                'server'
            ),
            React.createElement(
                'div',
                { className: 'status-content' },
                React.createElement(
                    'div',
                    { 
                        className: 'status-dot',
                        style: { backgroundColor: serverStatusInfo.color }
                    }
                ),
                React.createElement(
                    'span',
                    { className: 'status-message' },
                    serverStatusInfo.message
                ),
                ping != null && React.createElement(
                    'span',
                    { className: 'status-ping' },
                    `${ping} ms`
                )
            )
        ),
        React.createElement(
            'div',
            { 
                className: 'status-indicator tooltip',
                'data-tooltip': scriptStatusInfo.tooltip
            },
            React.createElement(
                'div',
                { className: 'status-label' },
                'script'
            ),
            React.createElement(
                'div',
                { className: 'status-content' },
                React.createElement(
                    'div',
                    { 
                        className: 'status-dot',
                        style: { backgroundColor: scriptStatusInfo.color }
                    }
                ),
                React.createElement(
                    'span',
                    { className: 'status-message' },
                    scriptStatusInfo.message
                )
            )
        )
    );
}

export function renderInfoBar(selectedObject, connectionStatus, scriptStatus, ping, widgets, onToggleWidget) {
    const renderWidgetButtons = () => {
        if (!widgets || widgets.length === 0) return null;
        
        return React.createElement(
            'div',
            { className: 'widget-buttons' },
            widgets.map(widget => 
                React.createElement(
                    'button',
                    {
                        key: widget.id,
                        className: `widget-button ${widget.isOpen ? 'active' : ''}`,
                        onClick: () => onToggleWidget(widget.id),
                        title: widget.title,
                        style: {
                            width: 'auto',
                            padding: '0 12px'
                        }
                    },
                    widget.title
                )
            )
        );
    };

    if (!selectedObject) {
        return React.createElement(
            'div',
            { className: 'info-bar' },
            React.createElement(
                'div',
                { className: 'info-details' },
                React.createElement('span', null, 'No object selected. Click on an object to view details.')
            ),
            React.createElement(
                'div',
                { className: 'info-bar-right' },
                renderWidgetButtons(),
                renderStatusIndicator(connectionStatus, scriptStatus, ping)
            )
        );
    }
    const { type, data } = selectedObject;
    let details = [];
    details.push(`Name: ${data.id}`);
    details.push(`Type: ${type}`);
    if (type === 'mesh') {
        const vertexCount = data.vertices ? data.vertices.length : 0;
        const faceCount = data.faces ? data.faces.length : 0;
        details.push(`Vertices: ${vertexCount}`);
        details.push(`Faces: ${faceCount}`);
    } else if (type === 'animated_mesh') {
        const frameCount = data.vertices ? data.vertices.length : 0;
        const vertexCount = data.vertices && data.vertices[0] ? data.vertices[0].length : 0;
        const faceCount = data.faces ? data.faces.length : 0;
        details.push(`Frames: ${frameCount}`);
        details.push(`Vertices: ${vertexCount}`);
        details.push(`Faces: ${faceCount}`);
        details.push(`Framerate: ${data.framerate} fps`);
    } else if (type === 'points') {
        const pointCount = data.points ? data.points.length : 0;
        details.push(`Points: ${pointCount}`);
    } else if (type === 'arrows') {
        const arrowCount = data.starts ? data.starts.length : 0;
        details.push(`Arrows: ${arrowCount}`);
    }
    return React.createElement(
        'div',
        { className: 'info-bar' },
        React.createElement(
            'div',
            { className: 'info-details' },
            details.map((detail, index) => 
                React.createElement('span', { key: index, className: 'info-item' }, detail)
            )
        ),
        React.createElement(
            'div',
            { className: 'info-bar-right' },
            renderWidgetButtons(),
            renderStatusIndicator(connectionStatus, scriptStatus, ping)
        )
    );
}
