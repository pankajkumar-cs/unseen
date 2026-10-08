import { Component, type ErrorInfo, type ReactNode } from 'react';

interface AppErrorBoundaryProps { children: ReactNode }
interface AppErrorBoundaryState { hasError: boolean }

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UNSEEN encountered a screen error.', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-5 text-[var(--text)]">
          <section className="card w-full max-w-lg p-7 text-center sm:p-9" role="alert">
            <div className="text-4xl" aria-hidden="true">👻</div>
            <h1 className="mt-3 font-grotesk text-2xl font-bold">This screen ran into a problem.</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">Your campus data is safe. Reload the page to try again.</p>
            <button type="button" onClick={() => window.location.reload()} className="btn-primary mt-6 min-h-11 rounded-full px-6 py-3 text-sm font-bold">Reload UNSEEN</button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}
