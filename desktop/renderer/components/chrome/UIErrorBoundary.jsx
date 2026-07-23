import React from 'react';

export function createUIErrorReport(error, componentStack = '') {
  return {
    message: error?.message || String(error || 'Unknown UI error'),
    name: error?.name || 'Error',
    stack: error?.stack || '',
    componentStack: String(componentStack || '').trim(),
    timestamp: new Date().toISOString(),
  };
}

export class UIErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, report: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    const report = createUIErrorReport(error, info?.componentStack);
    this.setState({ report });
    console.error('[Renderer] UI render failure', report);
    this.props.onError?.(report);
  }

  handleRetry = () => {
    this.setState({ error: null, report: null });
    this.props.onRetry?.();
  };

  handleReload = () => {
    if (this.props.onReload) {
      this.props.onReload();
      return;
    }
    window.location.reload();
  };

  render() {
    const { error, report } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="mastery-ui-failure" role="alert" aria-live="assertive">
        <section className="mastery-ui-failure-card">
          <p className="mastery-ui-failure-eyebrow">Renderer recovery</p>
          <h1>工作台遇到错误</h1>
          <p>当前界面已被安全隔离，Agent 主进程和工作区数据不会因此被清除。</p>
          <pre>{report?.message || error.message || 'Unknown UI error'}</pre>
          <div className="mastery-ui-failure-actions">
            <button type="button" onClick={this.handleRetry}>重试界面</button>
            <button type="button" onClick={this.handleReload}>重新加载应用</button>
          </div>
        </section>
      </main>
    );
  }
}
