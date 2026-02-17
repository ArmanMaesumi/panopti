import React, { useEffect, useRef, useCallback, useState } from 'react';

const ConsoleWindow = ({
    consoleLines,
    setConsoleLines,
    consolePos,
    setConsolePos,
    consoleSize,
    setConsoleSize,
    toggleConsole,
    showConsole,
    consoleRef,
    interactiveEnabled,
    onSubmitCommand,
    onRequestCompletions,
    scriptName
}) => {
    const resizeObserverRef = useRef(null);
    const windowRef = useRef(null);
    const isDragging = useRef(false);
    const dragOffset = useRef({ x: 0, y: 0 });
    const [command, setCommand] = useState('');
    const [history, setHistory] = useState([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const draftCommandRef = useRef('');
    const lastTabRef = useRef({ at: 0, command: '' });
    const MIN_WIDTH = 300;
    const MIN_HEIGHT = 150;
    const DOUBLE_TAB_MS = 400;

    const renderConsoleLines = () => {
        return consoleLines.map((line, index) => {
            // line.segments is an array of {text, color}
            if (!line.segments) {
                // backward compatibility
                const className = line.color ? `console-line console-${line.color}` : 'console-line';
                return React.createElement('span', { key: index, className: className }, line.text);
            }
            const inner = line.segments.map((seg, idx) => {
                let text = seg.text;
                // Remove single trailing newline at end of line
                if (idx === line.segments.length - 1) {
                    text = text.replace(/\n$/, '');
                }
                const cls = seg.color ? `console-seg console-${seg.color}` : 'console-seg';
                return React.createElement('span', { key: idx, className: cls }, text);
            });
            return React.createElement('div', { key: index, className: 'console-line' }, ...inner);
        });
    };

    const handleClearConsole = () => setConsoleLines([]);

    const handleSubmitCommand = (e) => {
        e.preventDefault();
        if (!onSubmitCommand || !interactiveEnabled) return;
        const trimmed = command.trim();
        if (!trimmed) return;
        onSubmitCommand(command);
        setHistory((prev) => [...prev, command]);
        setHistoryIndex(-1);
        draftCommandRef.current = '';
        setCommand('');
    };

    const handleInputKeyDown = (e) => {
        if (!interactiveEnabled) return;

        if (e.key === 'ArrowUp') {
            if (history.length === 0) return;
            e.preventDefault();
            if (historyIndex === -1) {
                draftCommandRef.current = command;
            }
            const nextIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
            setHistoryIndex(nextIndex);
            setCommand(history[nextIndex]);
            return;
        }

        if (e.key === 'ArrowDown') {
            if (history.length === 0 || historyIndex === -1) return;
            e.preventDefault();
            const nextIndex = historyIndex + 1;
            if (nextIndex >= history.length) {
                setHistoryIndex(-1);
                setCommand(draftCommandRef.current);
                return;
            }
            setHistoryIndex(nextIndex);
            setCommand(history[nextIndex]);
            return;
        }

        if (e.key === 'Tab') {
            e.preventDefault();
            const now = Date.now();
            const isDoubleTab = (
                now - lastTabRef.current.at <= DOUBLE_TAB_MS &&
                lastTabRef.current.command === command
            );
            lastTabRef.current = { at: now, command };

            if (isDoubleTab && onRequestCompletions && command.trim()) {
                onRequestCompletions(command);
            }
            return;
        }

        lastTabRef.current = { at: 0, command: '' };
    };


    // Constrain position to screen boundaries
    const constrainPosition = useCallback((x, y) => {
        const maxX = window.innerWidth  - consoleSize.width;
        const maxY = window.innerHeight - consoleSize.height;
        
        return {
            x: Math.max(0, Math.min(x, maxX)),
            y: Math.max(0, Math.min(y, maxY))
        };
    }, [consoleSize.width, consoleSize.height]);

    // Constrain size to minimum and maximum bounds
    const constrainSize = useCallback((width, height) => {
        return {
            width: Math.min(Math.max(width, MIN_WIDTH), window.innerWidth),
            height: Math.min(Math.max(height, MIN_HEIGHT), window.innerHeight)
        };
    }, []);

    const handleMouseMove = useCallback((e) => {
        if (!isDragging.current) return;
        
        const newX = e.clientX - dragOffset.current.x;
        const newY = e.clientY - dragOffset.current.y;
        
        const constrained = constrainPosition(newX, newY);
        setConsolePos(constrained);
    }, [constrainPosition, consoleSize.width, consoleSize.height, setConsolePos]);

    const handleMouseUp = useCallback(() => {
        isDragging.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
    }, [handleMouseMove]);

    const handleConsoleMouseDown = (e) => {
        // Only allow dragging from header, not from buttons
        if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
            return;
        }
        
        isDragging.current = true;
        dragOffset.current = {
            x: e.clientX - consolePos.x,
            y: e.clientY - consolePos.y
        };
        
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        e.preventDefault();
    };

    // Handle window resize to keep console within bounds
    useEffect(() => {
        const handleWindowResize = () => {
            // Constrain position when window is resized
            const constrainedPos = constrainPosition(consolePos.x, consolePos.y, consoleSize.width, consoleSize.height);
            if (constrainedPos.x !== consolePos.x || constrainedPos.y !== consolePos.y) {
                setConsolePos(constrainedPos);
            }
            
            // Constrain size when window is resized
            const constrainedSize = constrainSize(consoleSize.width, consoleSize.height);
            if (constrainedSize.width !== consoleSize.width || constrainedSize.height !== consoleSize.height) {
                setConsoleSize(constrainedSize);
            }
        };

        window.addEventListener('resize', handleWindowResize);
        return () => window.removeEventListener('resize', handleWindowResize);
    }, [consolePos.x, consolePos.y, consoleSize.width, consoleSize.height, constrainPosition, constrainSize, setConsolePos, setConsoleSize]);

    // Observe console element resize for user-initiated resizing
    useEffect(() => {
        const consoleElement = windowRef.current;
        if (!consoleElement) return;

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                const constrainedSize = constrainSize(width, height);
                
                if (constrainedSize.width !== width || constrainedSize.height !== height) {
                    setConsoleSize(constrainedSize);
                }
            }
        });

        resizeObserver.observe(consoleElement);
        resizeObserverRef.current = resizeObserver;

        return () => {
            resizeObserver.disconnect();
            resizeObserverRef.current = null;
        };
    }, [constrainSize, setConsoleSize]);

    return React.createElement(
        'div',
        {
            ref: windowRef,
            className: 'console-window',
            style: {
                visibility: showConsole ? 'visible' : 'hidden',
                position: 'fixed',
                left: consolePos.x,
                top: consolePos.y,
                width: consoleSize.width,
                height: consoleSize.height,
                minWidth: MIN_WIDTH,
                minHeight: MIN_HEIGHT,
                resize: 'both',
                overflow: 'auto',
            },
        },
        React.createElement(
            'div',
            { className: 'console-header', onMouseDown: handleConsoleMouseDown },
            React.createElement('span', null, 'Console'),
            React.createElement('div', { className: 'console-header-buttons' },
                React.createElement(
                    'button',
                    { className: 'console-clear', onClick: (e) => { e.stopPropagation(); handleClearConsole(); }, title: 'Clear console' },
                    'Clear'
                ),
                React.createElement(
                    'button',
                    { className: 'console-close', onClick: toggleConsole },
                    '×'
                )
            ),
        ),
        React.createElement('pre', { className: 'console-content', ref: consoleRef }, renderConsoleLines()),
        React.createElement(
            'form',
            { className: 'console-input-row', onSubmit: handleSubmitCommand },
            React.createElement('span', { className: 'console-prompt' }, '>>>'),
            React.createElement('input', {
                className: 'console-input',
                type: 'text',
                value: command,
                onChange: (e) => {
                    if (historyIndex !== -1) setHistoryIndex(-1);
                    setCommand(e.target.value);
                },
                onKeyDown: handleInputKeyDown,
                placeholder: interactiveEnabled
                    ? `Executing in ${scriptName} global scope...`
                    : 'Use panopti.connect(interactive_console=True) to execute Python code here',
                autoComplete: 'off',
                spellCheck: false,
                disabled: !interactiveEnabled,
            }),
            React.createElement(
                'button',
                {
                    className: 'console-submit',
                    type: 'submit',
                    title: interactiveEnabled ? 'Run command' : 'Interactive console disabled',
                    disabled: !interactiveEnabled
                },
                'Run'
            )
        )
    );
};

export default ConsoleWindow;
