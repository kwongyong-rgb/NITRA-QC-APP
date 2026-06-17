import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

// Catches render-time crashes anywhere below it and shows the error text
// instead of a blank white screen, so issues are reportable at a glance.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State { return { error } }
  componentDidCatch(error: Error) { console.error('App error boundary caught:', error) }

  render() {
    if (this.state.error) {
      return (
        <div className="page" style={{ paddingTop: 24 }}>
          <div className="card" style={{ border: '2px solid var(--fail)' }}>
            <h2 style={{ color: 'var(--fail)' }}>Something went wrong / 出现错误</h2>
            <p className="muted">This screen failed to load. Please screenshot this message and send it for support.<br />此页面加载失败，请截图发送以便排查。</p>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#F7F9FB', padding: 12, borderRadius: 8, fontSize: 12, color: 'var(--ink)' }}>{this.state.error.message}</pre>
            <button className="btn" style={{ marginTop: 12 }}
              onClick={() => { this.setState({ error: null }); window.location.assign('/') }}>
              Back to home / 返回主页
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
