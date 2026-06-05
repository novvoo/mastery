import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App.jsx';

// 获取根元素
const rootElement = document.getElementById('root');

// 创建根并渲染应用
const root = createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// 开发模式下的热更新支持
if (import.meta.hot) {
  import.meta.hot.accept();
}