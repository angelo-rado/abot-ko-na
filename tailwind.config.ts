// tailwind.config.ts
import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    'src/app/**/*.{ts,tsx}',
    'src/components/**/*.{ts,tsx}',
    'src/lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#f59e0b', // Warm Filipino yellow
        background: '#fffbf3',
        muted: '#a8a29e',
        accent: '#b91c1c',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
export default config
