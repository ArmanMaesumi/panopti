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
        React.createElement('div', {
        className: 'color-preview',
        style: {
            backgroundColor: `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${rgba.a})`,
        },
        onClick: () => setShow((v) => !v),
        }),
        React.createElement(
            'label',
            { className: 'checkbox-label', onClick: () => setShow((v) => !v) },
            control.name
        )
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

export function renderControl(control, handlers) {
    const h = handlers;
    switch (control.type) {
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
