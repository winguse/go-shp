import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync, writeFileSync } from 'fs';

const target = process.env.BUILD_TARGET || 'chrome';
const outDir = `dist/${target}`;

function svgToPngPlugin(): import('vite').Plugin {
  return {
    name: 'svg-to-png',
    apply: 'build',
    async closeBundle() {
      const sharp = (await import('sharp')).default;
      const icons: Array<{ src: string; dest: string; size: number }> = [
        { src: 'resources/icon.svg',     dest: `${outDir}/icon.png`,     size: 128 },
        { src: 'resources/icon_off.svg', dest: `${outDir}/icon_off.png`, size: 128 },
        { src: 'resources/icon_on.svg',  dest: `${outDir}/icon_on.png`,  size: 128 },
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

      // Copy target-specific manifest
      const manifestSrc = resolve(__dirname, `manifests/manifest.${target}.json`);
      const manifestDest = resolve(__dirname, `${outDir}/manifest.json`);
      const manifestContent = readFileSync(manifestSrc, 'utf-8');
      writeFileSync(manifestDest, manifestContent);
      console.log(`[manifest] Copied manifests/manifest.${target}.json → ${outDir}/manifest.json`);
    },
  };
}

export default defineConfig({
  plugins: [svgToPngPlugin()],

  build: {
    outDir,
    minify: false,
    sourcemap: 'inline',
    emptyOutDir: true,

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
        generatedCode: {
          preset: 'es2015',
        },
      },
    },
  },
});
