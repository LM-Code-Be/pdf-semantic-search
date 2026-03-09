/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        app: {
          lightBg: '#F7F7FB',
          darkBg: '#0B1020',
          darkCard: '#111A33'
        }
      }
    }
  },
  plugins: []
}
