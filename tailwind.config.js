/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        milk: '#FDFCF9',
        taupe: '#F3F1ED',
        ink: '#202020',
        matcha: '#D5E2D4',
        rose: '#DAB0A3',
        graphite: '#2E2E2E',
        mist: '#8A8A8A',
        creamline: '#EDEAE4'
      },
      fontFamily: {
        body: ['"Courier Prime"', 'Courier', 'monospace'],
        heading: ['"Satoshi"', 'Inter', 'sans-serif'],
      }
    },
  },
  plugins: [],
} 