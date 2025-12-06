import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        background: '#f4f7fb',
        surface: '#ffffff',
        'surface-muted': '#f9fbff',
        border: '#d7e1ed',
        'border-strong': '#b9c8d9',
        'brand-text': '#1f2a37',
        'brand-muted': '#4c5d73',
        primary: '#0573bb',
        'primary-hover': '#0a8bdf',
        'primary-disabled': '#89c6e9',
        success: '#1b9e5f',
        warning: '#f2a141',
        error: '#c23a3a',
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
        serif: ['Georgia', 'Times New Roman', 'serif'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(15, 23, 42, 0.08)',
        card: '0 8px 26px rgba(15, 23, 42, 0.08)',
        'card-strong': '0 12px 35px rgba(15, 23, 42, 0.12)',
      },
    },
  },
  plugins: [],
}

export default config
