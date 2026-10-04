export const themes = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'ghost-white', label: 'Ghost White' },
  { id: 'blizzard-blue', label: 'Blizzard Blue' },
] as const;
export type Theme = (typeof themes)[number]['id'];
export function isTheme(value: string | null): value is Theme {
  return themes.some((theme) => theme.id === value);
}
export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem('aib-theme');
    return isTheme(stored) ? stored : 'dark';
  } catch {
    return 'dark';
  }
}
export function oppositeTheme(theme: Theme): Theme {
  return {
    dark: 'light',
    light: 'dark',
    'ghost-white': 'blizzard-blue',
    'blizzard-blue': 'ghost-white',
  }[theme] as Theme;
}
export function themeLabel(theme: Theme): string {
  return themes.find((entry) => entry.id === theme)!.label;
}
