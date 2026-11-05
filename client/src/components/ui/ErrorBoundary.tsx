import { Component, type ReactNode } from 'react'
import { Brand } from '../branding/BrandMarks'

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return <main className="auth-status"><Brand /><section className="panel recovery-panel" role="alert">
      <h1>Something went wrong</h1><p>This screen could not be displayed. Unsaved changes may have been lost.</p>
      <p>If you had just saved a record, check its latest history before submitting again.</p>
      <div className="recovery-actions"><button className="button button-primary" onClick={() => this.setState({ failed: false })}>Try again</button>
        <button className="button button-ghost" onClick={() => window.location.reload()}>Reload application</button></div>
    </section></main>
  }
}
