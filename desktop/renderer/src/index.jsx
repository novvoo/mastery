import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App.jsx';
import { UIErrorBoundary } from '../components/chrome/UIErrorBoundary.jsx';

// 获取根元素
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Renderer root element #root was not found');
}

// 创建根并渲染应用
const root = createRoot(rootElement);
root.render(
  <React.StrictMode>
    <UIErrorBoundary>
      <App />
    </UIErrorBoundary>
  </React.StrictMode>
);

// 开发模式下的热更新支持
if (import.meta.hot) {
  import.meta.hot.accept();
}
