import { execSync } from 'child_process';
import path from 'path';
import fileUrl from 'url';

const __dirname = path.dirname(fileUrl.fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
let targets = ['chrome', 'firefox', 'edge'];

const targetArg = args.find(arg => arg.startsWith('--target='));
if (targetArg) {
  const t = targetArg.split('=')[1];
  if (['chrome', 'firefox', 'edge'].includes(t)) {
    targets = [t];
  }
}

console.log(`🚀 Building extension targets: ${targets.join(', ')}...`);

for (const target of targets) {
  console.log(`\n📦 Building [${target}] extension...`);
  try {
    execSync('npx vite build', {
      cwd: __dirname,
      stdio: 'inherit',
      env: {
        ...process.env,
        BUILD_TARGET: target,
      },
    });
    console.log(`✅ ${target} extension built successfully -> dist/${target}`);
  } catch (err) {
    console.error(`❌ Failed to build ${target} extension:`, err);
    process.exit(1);
  }
}

console.log('\n🎉 All requested extension targets built successfully!');
