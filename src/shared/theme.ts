export type Appearance = 'light' | 'dark';
export type ThemeDef = { id: string; name: string; appearance: Appearance; tokens: Record<string, string> };
