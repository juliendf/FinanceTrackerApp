import { useEffect, useState } from "react";
import { currentTheme, type ThemeName } from "./theme";

/** Current resolved theme, re-rendering the caller on every theme change. */
export function useThemeName(): ThemeName {
  const [theme, setTheme] = useState<ThemeName>(currentTheme);

  useEffect(() => {
    const onChange = () => setTheme(currentTheme());
    document.addEventListener("themechange", onChange);
    return () => document.removeEventListener("themechange", onChange);
  }, []);

  return theme;
}
