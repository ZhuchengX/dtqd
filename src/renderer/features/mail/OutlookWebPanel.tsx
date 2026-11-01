import { useCallback, useEffect, useState } from 'react';
import type { OutlookWebState } from '../../../shared/outlook-web';
import { Button } from '../../components/ui/button';
import { showToast } from '../../app/toasts';
import { errorText } from '../../workspace/store';

const STATUS_TEXT: Record<string, string> = {
  'needs-login': '邮箱登录已过期，请重新连接',
  'not-ready': '这次没读到收件箱，稍后自动重试；一直这样请点「反馈」告诉我们',
};

/** 一键连接按钮，邮箱页和新手向导共用。 */
export function OutlookWebConnect({ onConnected }: { onConnected: () => void }) {
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    const dela = window.dela;
    if (!dela || busy) return;
    setBusy(true);
    try {
      if (await dela.outlookWeb.connect()) onConnected();
    } catch (cause) {
      showToast({ title: errorText(cause), variant: 'neutral' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3">
      <p className="text-13 leading-relaxed text-ink-3">
        在弹出的微软页面登录 Dundee 账号，DTQD
        不保存密码。之后会在后台读收件箱列表（发件人、主题、预览）存到本机；开启重要事项提取时，这些内容会发给你配置的
        AI。
      </p>
      <Button disabled={busy} onClick={() => void connect()} type="button">
        {busy ? '请在弹出的窗口里登录…' : '连接 Dundee 邮箱'}
      </Button>
    </div>
  );
}

/** Dundee 邮箱的收件箱列表；读正文和回信在完整的 Outlook 窗口里。 */
export function OutlookWebPanel({ onDisconnected }: { onDisconnected?: () => void }) {
  const [state, setState] = useState<OutlookWebState | null>(null);
  const [syncing, setSyncing] = useState(false);
  const dela = window.dela;
  const load = useCallback(async () => {
    if (dela) setState(await dela.outlookWeb.getState());
  }, [dela]);
  useEffect(() => {
    void load();
  }, [load]);
  const sync = async () => {
    if (!dela || syncing) return;
    setSyncing(true);
    try {
      setState(await dela.outlookWeb.sync());
    } catch (cause) {
      showToast({ title: errorText(cause), variant: 'neutral' });
    } finally {
      setSyncing(false);
    }
  };
  if (!state || !dela) return null;
  const problem = state.lastStatus ? STATUS_TEXT[state.lastStatus] : undefined;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="flex-1 text-sm font-semibold">Dundee 邮箱</h2>
        <Button disabled={syncing} onClick={() => void sync()} size="sm" variant="outline">
          {syncing ? '正在读取…' : '刷新'}
        </Button>
        <Button onClick={() => void dela.outlookWeb.open()} size="sm">
          打开 Outlook
        </Button>
      </div>
      {problem && (
        <div
          className="mx-4 mt-3 flex items-center gap-3 rounded-card bg-red-tint px-3 py-2 text-xs text-red"
          role="alert"
        >
          <span className="flex-1">{problem}</span>
          {state.lastStatus === 'needs-login' && (
            <button
              className="underline"
              onClick={() => void dela.outlookWeb.connect().then(load).then(onDisconnected)}
              type="button"
            >
              重新连接
            </button>
          )}
        </div>
      )}
      <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
        {state.rows.map((row) => (
          <li className="px-4 py-3 text-13 leading-relaxed text-ink-2" key={row.id}>
            {row.label}
          </li>
        ))}
        {state.rows.length === 0 && (
          <li className="px-4 py-10 text-center text-13 text-ink-3">
            {syncing ? '正在读取收件箱…' : '还没有邮件，点「刷新」读取一次'}
          </li>
        )}
      </ul>
    </div>
  );
}
