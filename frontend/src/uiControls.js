import React from 'react';
import convert from 'color-convert';
import { marked } from 'marked';
import { Chrome } from '@uiw/react-color';
import DOMPurify from 'dompurify';
import { evaluate } from 'mathjs';

import { colorListToDict, colorDictToList, pythonRGBAToJS } from './utils.js';
import { debounce, throttle } from './utils.js';
import * as CONSTANTS from './constants.js';

function escapeCSS(str) {
    return str.replace(/[!"#$%&'()*+,.\/:;<=>?@\[\\\]^`{|}~\s]/g, '\\$&');
}

export function handleSliderChange(controls, socketRef, debouncedRef, controlId, value) {
    const control = controls.find(c => c.id === controlId);
    if (control) {
        const valueElem = document.querySelector(`#slider-value-${escapeCSS(controlId)}`);
        if (valueElem) valueElem.value = value;
        const rangeElem = document.querySelector(`#slider-range-${escapeCSS(controlId)}`);
        if (rangeElem && rangeElem.value !== String(value)) rangeElem.value = value;
    }

    // Create or reuse throttled function for this control
    if (!debouncedRef.current[controlId]) {
        debouncedRef.current[controlId] = throttle((currentValue) => {
            const eventData = {
                eventType: 'sliderChange',
                controlId: controlId,
                value: parseFloat(currentValue)
            };
            if (window.viewerId) {
                eventData.viewer_id = window.viewerId;
            }
            socketRef.current.emit('ui_event', eventData);
        }, CONSTANTS.DEBOUNCE_SLIDER);
    }

    debouncedRef.current[controlId](value);
}

export function handleSliderInputCommit(controls, socketRef, debouncedRef, controlId, value) {
    const control = controls.find(c => c.id === controlId);
    if (!control) return;
    let num;
    try {
        if (typeof value === 'string' && value.trim() !== '') {
            num = evaluate(value);
        }
    } catch (err) {
        num = NaN;
    }
    if (typeof num !== 'number' || isNaN(num)) {
        const rangeElem = document.querySelector(`#slider-range-${escapeCSS(controlId)}`);
        if (rangeElem) num = parseFloat(rangeElem.value);
        else num = control.initial;
    }
    if (num < control.min) num = control.min;
    if (num > control.max) num = control.max;

    handleSliderChange(controls, socketRef, debouncedRef, controlId, num);
}

export function handleSliderArrow(controls, socketRef, debouncedRef, controlId, direction) {
    const control = controls.find(c => c.id === controlId);
    if (!control) return;
    const rangeElem = document.querySelector(`#slider-range-${escapeCSS(controlId)}`);
    let current = rangeElem ? parseFloat(rangeElem.value) : control.initial;
    const step = control.step || 1;
    let next = current + direction * step;
    if (next < control.min) next = control.min;
    if (next > control.max) next = control.max;
    handleSliderChange(controls, socketRef, debouncedRef, controlId, next);
}

export function handleButtonClick(socketRef, controlId) {
    const eventData = { eventType: 'buttonClick', controlId };
    if (window.viewerId) {
        eventData.viewer_id = window.viewerId;
    }
    socketRef.current.emit('ui_event', eventData);
    console.log('button clicked', controlId);
}

export function handleCheckboxChange(socketRef, controlId, checked) {
    const eventData = { eventType: 'checkboxChange', controlId, value: checked };
    if (window.viewerId) {
        eventData.viewer_id = window.viewerId;
    }
    socketRef.current.emit('ui_event', eventData);
}

export function handleDropdownChange(socketRef, controlId, value) {
    const eventData = { eventType: 'dropdownChange', controlId, value };
    if (window.viewerId) {
        eventData.viewer_id = window.viewerId;
    }
    socketRef.current.emit('ui_event', eventData);
}

export function handleColorChange(socketRef, controlId, color) {
    const eventData = { eventType: 'colorChange', controlId, value: color };
    if (window.viewerId) {
        eventData.viewer_id = window.viewerId;
    }
    socketRef.current.emit('ui_event', eventData);
}

export function handleImageClick(socketRef, controlId, index) {
    const eventData = {
        eventType: 'imageGalleryEvent',
        controlId,
        value: { type: 'imageClick', index }
    };
    if (window.viewerId) {
        eventData.viewer_id = window.viewerId;
    }
    socketRef.current.emit('ui_event', eventData);
}

export function ColorPickerControl({ control, handlers }) {
    // This function has been a nightmare -- we have to use HSVA internally to get correct alpha support in the modal
    // and unfortunately the `Sketch` component has a bug where it doesn't handle alpha correctly in HSVA mode, so we use `Chrome` for now.
    const initialColorRGBA = pythonRGBAToJS(control.initial);
    const initialColorHSVA = colorListToDict(convert.rgb.hsv(colorDictToList(initialColorRGBA)), 'hsv');
    const [show, setShow] = React.useState(false)
    const [hsva, setHsva] = React.useState(initialColorHSVA);
    const [rgba, setRgba] = React.useState(initialColorRGBA);
    const pickerRef = React.useRef(null);

    // Store the throttled function in a ref, only recreate if control.id changes
    const debouncedColorChangeRef = React.useRef();
    React.useEffect(() => {
        debouncedColorChangeRef.current = throttle((rgba) => {
            handlers.handleColorChange(control.id, [rgba.r / 255, rgba.g / 255, rgba.b / 255, rgba.a]);
        }, CONSTANTS.DEBOUNCE_SLIDER);
    }, [control.id]);

    const handleChangeComplete = (c) => {
        setHsva(c.hsva);
        const rgba = c.rgba;
        setRgba(rgba);
        if (debouncedColorChangeRef.current) {
            debouncedColorChangeRef.current(rgba);
        }
    }

    React.useEffect(() => {
        if (!show) return;
        const handleClickOutside = e => {
            // if click target is inside the color preview or checkbox label, do nothing
            if (e.target.closest('.color-preview') || e.target.closest('.checkbox-label')) {
                return;
            }
            // if click target is not inside the picker or the preview/label, close it
            if (pickerRef.current && !pickerRef.current.contains(e.target)) {
                setShow(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
        }, [show]);


    return React.createElement(
    'div',
    { className: 'control-group color-picker-group' },
    React.createElement(
        'div',
        { className: 'color-picker-container' },
        React.createElement(
        'label',
        { className: 'checkbox-label', onClick: () => setShow((v) => !v) },
        control.name
        ),
        React.createElement('div', {
        className: 'color-preview',
        style: {
            backgroundColor: `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${rgba.a})`,
        },
        onClick: () => setShow((v) => !v),
        })
    ),
    show &&
        React.createElement(
        'div',
        { ref: pickerRef, className: 'color-picker-popup' },
        React.createElement(Chrome, {
            color: hsva,
            onChange: handleChangeComplete,
        })
        )
    );
}

export function ImageGalleryControl({ control, handlers }) {
    const [selectedIndex, setSelectedIndex] = React.useState(null);
    const [currentPage, setCurrentPage] = React.useState(0);

    const handleImageClick = (index) => {
        setSelectedIndex(index);
        handlers.handleImageClick(control.id, index);
    };

    const images = control.images || [];
    const thumbnailSize = control.thumbnail_size || 150;
    const columns = control.columns || 3;
    const rowsPerPage = control.rows_per_page;

    // Calculate pagination
    const itemsPerPage = rowsPerPage ? rowsPerPage * columns : null;
    const totalPages = itemsPerPage ? Math.ceil(images.length / itemsPerPage) : 1;
    const isPaginated = rowsPerPage !== null && rowsPerPage !== undefined;

    // Get images for current page
    const startIndex = isPaginated ? currentPage * itemsPerPage : 0;
    const endIndex = isPaginated ? Math.min(startIndex + itemsPerPage, images.length) : images.length;
    const visibleImages = images.slice(startIndex, endIndex);

    const handlePageChange = (newPage) => {
        if (newPage >= 0 && newPage < totalPages) {
            setCurrentPage(newPage);
            // Emit page change event to backend
            const eventData = {
                eventType: 'imageGalleryEvent',
                controlId: control.id,
                value: { type: 'pageChange', page: newPage }
            };
            if (window.viewerId) {
                eventData.viewer_id = window.viewerId;
            }
            handlers.socketRef.current.emit('ui_event', eventData);
        }
    };

    return React.createElement(
        'div',
        { className: 'control-group image-gallery-group', key: control.id },
        React.createElement('label', { className: 'control-label' }, control.name),

        // Pagination controls (top)
        isPaginated && React.createElement(
            'div',
            {
                className: 'image-gallery-pagination',
                style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: '8px',
                    marginBottom: '8px',
                    padding: '4px 8px',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    borderRadius: '4px'
                }
            },
            React.createElement('button', {
                onClick: () => handlePageChange(currentPage - 1),
                disabled: currentPage === 0,
                style: {
                    padding: '4px 12px',
                    cursor: currentPage === 0 ? 'not-allowed' : 'pointer',
                    opacity: currentPage === 0 ? 0.5 : 1,
                    backgroundColor: '#444',
                    color: '#fff',
                    border: '1px solid #666',
                    borderRadius: '3px'
                }
            }, '◀ Previous'),
            React.createElement('span', {
                style: {
                    fontSize: '13px',
                    color: '#ccc'
                }
            }, `Page ${currentPage + 1} of ${totalPages} (${startIndex + 1}-${endIndex} of ${images.length})`),
            React.createElement('button', {
                onClick: () => handlePageChange(currentPage + 1),
                disabled: currentPage >= totalPages - 1,
                style: {
                    padding: '4px 12px',
                    cursor: currentPage >= totalPages - 1 ? 'not-allowed' : 'pointer',
                    opacity: currentPage >= totalPages - 1 ? 0.5 : 1,
                    backgroundColor: '#444',
                    color: '#fff',
                    border: '1px solid #666',
                    borderRadius: '3px'
                }
            }, 'Next ▶')
        ),

        // Image grid
        React.createElement(
            'div',
            {
                className: 'image-gallery-container',
                style: {
                    display: 'grid',
                    gridTemplateColumns: `repeat(${columns}, 1fr)`,
                    gap: '8px',
                    marginTop: '8px'
                }
            },
            visibleImages.map((imgSrc, pageIndex) => {
                const globalIndex = startIndex + pageIndex;
                return React.createElement('img', {
                    key: `${control.id}-img-${globalIndex}`,
                    src: imgSrc,
                    alt: `Image ${globalIndex + 1}`,
                    className: `gallery-thumbnail ${selectedIndex === globalIndex ? 'selected' : ''}`,
                    style: {
                        width: '100%',
                        height: `${thumbnailSize}px`,
                        objectFit: 'cover',
                        cursor: 'pointer',
                        borderRadius: '4px',
                        border: selectedIndex === globalIndex ? '2px solid #4CAF50' : '2px solid transparent',
                        transition: 'border 0.2s'
                    },
                    onClick: () => handleImageClick(globalIndex),
                    onMouseEnter: (e) => {
                        if (selectedIndex !== globalIndex) {
                            e.target.style.border = '2px solid #888';
                        }
                    },
                    onMouseLeave: (e) => {
                        if (selectedIndex !== globalIndex) {
                            e.target.style.border = '2px solid transparent';
                        }
                    }
                });
            })
        )
    );
}

export function GroupControl({ control, handlers, allControls }) {
    const [collapsed, setCollapsed] = React.useState(control.collapsed || false);

    // Get controls that belong to this group
    const groupControls = allControls.filter(c => c.group === control.id);

    const toggleCollapsed = () => {
        setCollapsed(!collapsed);
    };

    return React.createElement(
        'div',
        { className: 'control-group-container', key: control.id },
        React.createElement(
            'div',
            {
                className: 'control-group-header',
                onClick: toggleCollapsed
            },
            React.createElement('i', {
                className: `fas fa-chevron-${collapsed ? 'right' : 'down'} group-chevron`
            }),
            React.createElement('span', { className: 'group-label' }, control.name)
        ),
        !collapsed && React.createElement(
            'div',
            { className: 'control-group-content' },
            groupControls.map(c => renderControl(c, handlers, allControls))
        )
    );
}

export function renderControl(control, handlers, allControls = []) {
    const h = handlers;
    switch (control.type) {
        case 'group':
            return React.createElement(GroupControl, { key: control.id, control, handlers: h, allControls });
        case 'slider':
            return React.createElement(
                'div',
                { className: 'control-group', key: control.id },
                React.createElement('label', { className: 'control-label' }, control.name),
                control.description &&
                    React.createElement('div', { className: 'control-description' }, control.description),
                React.createElement(
                    'div',
                    { className: 'slider-container' },
                    React.createElement('input', {
                        type: 'range',
                        className: 'slider',
                        id: `slider-range-${control.id}`,
                        min: control.min,
                        max: control.max,
                        step: control.step,
                        defaultValue: control.initial,
                        onChange: (e) => h.handleSliderChange(control.id, e.target.value)
                    }),
                    React.createElement(
                        'div',
                        { className: 'slider-value-container' },
                        React.createElement('i', {
                            className: 'fas fa-chevron-left slider-btn',
                            onClick: () => h.handleSliderArrow(control.id, -1)
                        }),
                        React.createElement('input', {
                            type: 'text',
                            className: 'slider-value',
                            id: `slider-value-${control.id}`,
                            defaultValue: control.initial,
                            onBlur: (e) => h.handleSliderInputCommit(control.id, e.target.value),
                            onKeyDown: (e) => { if (e.key === 'Enter') { e.target.blur(); } }
                        }),
                        React.createElement('i', {
                            className: 'fas fa-chevron-right slider-btn',
                            onClick: () => h.handleSliderArrow(control.id, 1)
                        })
                    )
                )
            );
        case 'button':
            return React.createElement(
                'div',
                { className: 'control-group', key: control.id },
                React.createElement(
                    'button',
                    { onClick: () => h.handleButtonClick(control.id) },
                    control.name
                )
            );
        case 'download_button':
            return React.createElement(
                'div',
                { className: 'control-group', key: control.id },
                React.createElement(
                    'button',
                    { onClick: () => h.handleButtonClick(control.id) },
                    control.name
                )
            );
        case 'label':
            return React.createElement(
                'div',
                { className: 'control-group', key: control.id },
                React.createElement(
                    'div',
                    { className: 'label-container', dangerouslySetInnerHTML: { __html: DOMPurify.sanitize(marked.parse(control.text)) } }
                )
            );
        case 'checkbox':
            return React.createElement(
                'div',
                { className: 'control-group', key: control.id },
                React.createElement('label', { className: 'control-label checkbox-label' },
                    React.createElement('input', {
                        type: 'checkbox',
                        className: 'checkbox',
                        defaultChecked: control.initial,
                        onChange: (e) => h.handleCheckboxChange(control.id, e.target.checked)
                    }),
                    React.createElement('span', null, control.name)
                ),
                control.description &&
                    React.createElement('div', { className: 'control-description' }, control.description)
            );
        case 'dropdown':
            return React.createElement(
                'div',
                { className: 'control-group', key: control.id },
                React.createElement('label', { className: 'control-label' }, control.name),
                control.description &&
                    React.createElement('div', { className: 'control-description' }, control.description),
                React.createElement('select', {
                    className: 'dropdown',
                    defaultValue: control.initial,
                    onChange: (e) => h.handleDropdownChange(control.id, e.target.value)
                },
                    control.options.map(option =>
                        React.createElement('option', { key: option, value: option }, option)
                    )
                )
            );
        case 'color_picker':
            return React.createElement(ColorPickerControl, { key: control.id, control, handlers: h });
        case 'image_gallery':
            return React.createElement(ImageGalleryControl, { key: control.id, control, handlers: h });
        case 'plotly':
            return React.createElement(
                'div',
                { className: 'control-group', key: control.id },
                React.createElement('div', {
                    id: `plotly-${control.id}`,
                    style: { width: '100%', height: '300px' }
                })
            );
        default:
            return null;
    }
}
