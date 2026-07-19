import React, { createContext, useContext, useState, useRef, useCallback } from 'react';
import { locales, type LanguageType } from '../locales';

let activeLanguage: LanguageType = 'en';

const translate = (
  lang: LanguageType,
  key: string,
  replacements?: Record<string, string | number>,
) => {
  const dict = locales[lang] || locales['en'];
  // @ts-ignore
  let text = dict[key] || locales['en'][key] || key;
  if (replacements) {
    Object.entries(replacements).forEach(([k, v]) => {
      text = text.replace(new RegExp(`{${k}}`, 'g'), String(v));
    });
  }
  return text;
};

export const tStatic = (key: string, replacements?: Record<string, string | number>) =>
  translate(activeLanguage, key, replacements);

interface LanguageContextProps {
  language: LanguageType;
  setLanguage: (lang: LanguageType) => void;
  t: (key: string, replacements?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextProps | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<LanguageType>('en');
  // Ref mirrors the current language so the stable `t` below always reads the
  // latest value — without this, handlers captured in useCallback([]) freeze the
  // first-render language and render in English regardless of the user's choice.
  const languageRef = useRef<LanguageType>('en');

  const setLanguage = useCallback((lang: LanguageType) => {
    languageRef.current = lang;
    activeLanguage = lang;
    setLanguageState(lang);
  }, []);

  const t = useCallback(
    (key: string, replacements?: Record<string, string | number>) =>
      translate(languageRef.current, key, replacements),
    [],
  );

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
