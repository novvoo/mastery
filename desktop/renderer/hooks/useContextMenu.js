import { useState, useEffect, useCallback } from 'react';

export function useContextMenu() {
  const [globalContextMenu, setGlobalContextMenu] = useState(null);

  useEffect(() => {
    const handleContextMenu = (e) => {
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim();
      if (selectedText) {
        e.preventDefault();
        setGlobalContextMenu({ x: e.clientX, y: e.clientY, text: selectedText });
      }
    };

    const handleClick = () => {
      setGlobalContextMenu(null);
    };

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('click', handleClick);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('click', handleClick);
    };
  }, []);

  const closeContextMenu = useCallback(() => {
    setGlobalContextMenu(null);
  }, []);

  return {
    globalContextMenu,
    setGlobalContextMenu,
    closeContextMenu,
  };
}
