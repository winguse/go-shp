import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync, writeFileSync } from 'fs';

// Vite plugin: converts SVGs from resources/ to PNGs in dist/
function svgToPngPlugin(): import('vite').Plugin {
  return {
    name: 'svg-to-png',
    apply: 'build',
    async closeBundle() {
      const sharp = (await import('sharp')).default;
      const icons: Array<{ src: string; dest: string; size: number }> = [
        { src: 'resources/icon.svg',     dest: 'dist/icon.png',     size: 128 },
        { src: 'resources/icon_off.svg', dest: 'dist/icon_off.png', size: 128 },
        { src: 'resources/icon_on.svg',  dest: 'dist/icon_on.png',  size: 128 },
      ];

      for (const { src, dest, size } of icons) {
        const svgBuffer = readFileSync(resolve(__dirname, src));
        const pngBuffer = await sharp(svgBuffer)
          .resize(size, size)
          .png()
          .toBuffer();
        writeFileSync(resolve(__dirname, dest), pngBuffer);
        console.log(`[svg-to-png] ${src} → ${dest}`);
      }
    },
  };
}

export default defineConfig({
  // No @vitejs/plugin-react — we no longer use JSX/TSX in UI files.
  plugins: [svgToPngPlugin()],


  build: {
    outDir: 'dist',

    // Disable minification to keep source code readable and transparent.
    minify: false,

    // Emit inline source maps so the original TypeScript source is embedded
    // directly in each output file for full auditability.
    sourcemap: 'inline',

    rollupOptions: {
      input: {
        popup:      resolve(__dirname, 'popup.html'),
        options:    resolve(__dirname, 'options.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: (assetInfo) => {
          if (assetInfo.name === 'background') {
            return 'background.js';
          }
          return 'assets/[name]-[hash].js';
        },

        // Preserve comments (including legal / licence blocks) in the output.
        // Rollup strips comments by default; preset:'es2015' keeps them.
        generatedCode: {
          preset: 'es2015',
        },
      },
    },
  },
});
