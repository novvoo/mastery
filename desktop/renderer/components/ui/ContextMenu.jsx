import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * 通用上下文菜单组件
 */

export function ContextMenu({ x, y, items, onClose }) {
  const menuRef = useRef(null);
  const [position, setPosition] = useState({ x, y });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu || typeof window === 'undefined') {
      setPosition({ x, y });
      return;
    }

    const margin = 8;
    const rect = menu.getBoundingClientRect();
    const maxX = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxY = Math.max(margin, window.innerHeight - rect.height - margin);
    const nextX = Math.min(Math.max(margin, x), maxX);
    const nextY = Math.min(Math.max(margin, y), maxY);
    setPosition({ x: nextX, y: nextY });
  }, [x, y, items]);

  const menuStyle = {
    position: 'fixed',
    left: `${position.x}px`,
    top: `${position.y}px`,
    backgroundColor: 'var(--surface-color)',
    borderRadius: '8px',
    boxShadow: '0 4px 24px rgba(0, 0, 0, 0.2)',
    border: '1px solid var(--border-subtle)',
    padding: '4px 0',
    minWidth: '160px',
    zIndex: 1001,
  };

  const overlayStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
  };

  const itemStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    cursor: 'pointer',
    fontSize: '13px',
    color: 'var(--text-color)',
    userSelect: 'text',
  };

  const dividerStyle = {
    height: '1px',
    backgroundColor: 'var(--border-subtle)',
    margin: '4px 0',
  };

  const iconStyle = {
    width: '16px',
    height: '16px',
    flexShrink: 0,
  };

  const menu = (
    <>
      <div style={overlayStyle} onClick={onClose} />
      <div ref={menuRef} style={menuStyle}>
        {items.map((item, index) => {
          if (item.type === 'divider') {
            return <div key={index} style={dividerStyle} />;
          }
          return (
            <div
              key={item.id || index}
              style={{
                ...itemStyle,
                ...(item.danger ? { color: 'var(--error-color)' } : {}),
              }}
              onClick={() => {
                item.onClick?.();
                onClose();
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--hover-color)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              {item.icon && <span style={iconStyle}>{item.icon}</span>}
              <span>{item.label}</span>
            </div>
          );
        })}
      </div>
    </>
  );

  if (typeof document === 'undefined') {
    return menu;
  }

  return createPortal(menu, document.body);
}

export default ContextMenu;
