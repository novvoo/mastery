import { useState, useCallback, useEffect } from 'react';
import { getI18n } from '../i18n.js';

const DESKTOP_THEME_STORAGE_KEY = 'ai-agent-desktop-theme';

export function useTheme() {
  const [theme, setTheme] = useState(() => {
    const stored =
      typeof localStorage !== 'undefined' ? localStorage.getItem(DESKTOP_THEME_STORAGE_KEY) : null;
    return stored || 'light';
  });

  const [language, setLanguage] = useState(() => getI18n().getLanguage());
  const [, forceUpdate] = useState(0);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  const handleLanguageChange = useCallback((lang) => {
    const i18n = getI18n();
    i18n.setLanguage(lang);
    setLanguage(lang);
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem(DESKTOP_THEME_STORAGE_KEY, theme);
    }
  }, [theme]);

  useEffect(() => {
    const i18n = getI18n();
    const unsub = i18n.subscribe((lang) => {
      setLanguage(lang);
      forceUpdate((n) => n + 1);
    });
    return unsub;
  }, []);

  return {
    theme,
    setTheme,
    toggleTheme,
    language,
    setLanguage,
    handleLanguageChange,
    forceUpdate,
  };
}
