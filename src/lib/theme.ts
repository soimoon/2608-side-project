import { createContext, useContext } from 'react';
import type { Theme } from '../types';

export const ThemeContext = createContext<Theme>('blue');
export const useTheme = () => useContext(ThemeContext);
