import { Component, type ReactNode } from 'react';
import { CRASH } from '../strings/ui';
import { useAppStore } from '../store/appStore';

interface Props {
  children: ReactNode;
}

interface State {
  error: unknown;
}

/**
 * 全域錯誤邊界（移植自 sr2）：渲染 throw 不再白屏——宣紙錯誤卡給出路（回帳本/重新整理）。
 * class component 是 React 錯誤邊界唯一合法形態。
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  private backToLedger = (): void => {
    // 先重設畫面再重掛；store 本身若也壞了就退而重整
    try {
      useAppStore.getState().setScreen('ledger');
      this.setState({ error: null });
    } catch {
      window.location.reload();
    }
  };

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    const digest = String(
      this.state.error instanceof Error ? this.state.error.message : this.state.error,
    ).slice(0, 200);
    return (
      <div className="crash-screen">
        <div className="modal-card crash-card">
          <div className="modal-title">{CRASH.title}</div>
          <div className="modal-body">{CRASH.body}</div>
          {digest && <div className="crash-digest">{digest}</div>}
          <div className="modal-actions">
            <button className="primary-btn" onClick={this.backToLedger}>{CRASH.menu}</button>
            <button className="ghost-btn" onClick={() => window.location.reload()}>
              {CRASH.reload}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
