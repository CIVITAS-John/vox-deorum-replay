import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';

export default {
  input: 'src/main.ts',
  output: {
    file: 'dist/bundle.js',
    format: 'iife',
    name: 'VoxDeorumReplay',
    sourcemap: true,
    globals: {
      // External libraries will be accessed as globals
    }
  },
  plugins: [
    typescript({
      tsconfig: './tsconfig.json'
    }),
    nodeResolve({
      browser: true
    })
  ],
  external: [], // All dependencies will be bundled
};