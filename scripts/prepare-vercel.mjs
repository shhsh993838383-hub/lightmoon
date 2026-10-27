import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('vercel-public', { recursive: true });
writeFileSync('vercel-public/index.html', '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>光幕 API</title><p>光幕电影服务</p><a href="https://shhsh993838383-hub.github.io/lightmoon/">打开光幕</a></html>');
