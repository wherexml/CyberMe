import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
export default defineConfig({root:fileURLToPath(new URL('.',import.meta.url)),plugins:[react()],server:{host:'127.0.0.1',port:46100,strictPort:true,fs:{allow:[fileURLToPath(new URL('..',import.meta.url))]},proxy:{'/api':'http://127.0.0.1:46110','/files':'http://127.0.0.1:46110'}},build:{outDir:'../dist',emptyOutDir:true}});
