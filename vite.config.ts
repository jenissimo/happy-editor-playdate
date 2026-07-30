import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { playdateProjectBridge } from './vite/projectBridge.ts'

export default defineConfig({
  plugins: [react(), playdateProjectBridge()],
  server: {
    watch: {
      ignored: ['**/playdate/**/*.pdx/**', '**/node_modules/**'],
    },
  },
})
