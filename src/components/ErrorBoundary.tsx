import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#050505] flex items-center justify-center p-8 text-center">
          <div className="max-w-md space-y-6">
            <div className="w-20 h-20 bg-red-500/10 border border-red-500/20 rounded-3xl flex items-center justify-center mx-auto text-red-500">
              <span className="text-4xl">!</span>
            </div>
            <h1 className="text-3xl font-black tracking-tighter uppercase text-white">System Failure</h1>
            <p className="text-[#8E9299]">
              An unexpected error occurred during the workflow execution.
            </p>
            <div className="p-4 bg-[#151619] border border-[#141414] rounded-xl text-left font-mono text-xs text-red-400 overflow-auto max-h-48">
              {this.state.error?.message}
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-[#00FF00] text-black rounded-lg font-bold uppercase tracking-tighter hover:bg-[#00CC00] transition-all"
            >
              Restart System
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
