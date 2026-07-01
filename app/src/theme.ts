import { createTheme, type MantineColorsTuple } from '@mantine/core';

/** Paleta de marca Segunda Opinión Médica: tono 6 (#007ce8) es el color principal. */
const somAzul: MantineColorsTuple = [
  '#e6f3ff',
  '#cde5ff',
  '#9cc9ff',
  '#68acff',
  '#3d93fa',
  '#1c82f2',
  '#007ce8',
  '#0068c7',
  '#0057a6',
  '#004585',
];

/** Tema simple y amable: tipografía grande, botones cómodos. Para recepción, no para programadores. */
export const theme = createTheme({
  primaryColor: 'somAzul',
  colors: { somAzul },
  defaultRadius: 'md',
  fontSizes: {
    md: '1rem',
    lg: '1.125rem',
  },
  components: {
    Button: {
      defaultProps: { size: 'md' },
    },
  },
});
