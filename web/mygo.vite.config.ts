import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
export default defineConfig({root:fileURLToPath(new URL('.',import.meta.url)),plugins:[react()],base:'./',build:{outDir:'../.local/mygo-web',emptyOutDir:true,assetsDir:'web-assets',rollupOptions:{input:fileURLToPath(new URL('pilot.html',import.meta.url))}},server:{host:'127.0.0.1',port:46300,strictPort:true}});
