import { useState } from 'react';
import { DesktopOnlyNotice } from '../../../components/ui/desktop-only-notice';
import { connectBlackboard, connectCanvas } from '../../settings/connections/canvas-connect';
import { errorText } from '../../../workspace/store';
import { StepButton, StepInput, type StepButtonState } from './step-controls';
import { StepGuide } from './step-guide';

/** 向导 · myDundee 步骤：弹出登录窗由学生自行完成 Dundee Microsoft 登录，再同步课程，按钮转为「下一步」。 */
export function CanvasStep({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<StepButtonState>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!window.dela) {
    return (
      <DesktopOnlyNotice
        description="myDundee 登录会话与课程缓存不会暴露给浏览器。"
        title="myDundee 仅在 DTQD 桌面端可用"
      />
    );
  }

  const submit = async () => {
    if (state === 'success') return onDone();
    if (state === 'busy') return;
    setState('busy');
    setError(null);
    try {
      await connectBlackboard();
      setState('success');
    } catch (cause) {
      setError(errorText(cause));
      setState('idle');
    }
  };

  return (
    <div className="grid gap-7">
      <header className="grid gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">连接 myDundee</h2>
        <p className="text-13 leading-relaxed text-ink-3">
          同步 Blackboard 课件、作业截止与课程公告；登录会话加密保存在本机，DTQD 不保存你的密码。
        </p>
      </header>
      <StepGuide
        steps={[
          {
            title: '用 Dundee 账号登录',
            content: (
              <form
                className="grid gap-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <ol className="list-decimal space-y-1.5 ps-4 text-13 leading-relaxed text-ink-3">
                  <li>点下方按钮，弹出 myDundee 登录窗</li>
                  <li>输入 studentID@dundee.ac.uk 和密码，完成 MFA 验证</li>
                  <li>看到课程页后窗口会自动关闭并开始同步</li>
                </ol>
                {error && (
                  <p className="text-13 [overflow-wrap:anywhere] text-red-600" role="alert">
                    {error}
                  </p>
                )}
                <StepButton
                  busyLabel="正在登录并同步课程…"
                  idleLabel="登录 myDundee"
                  state={state}
                  successLabel="连接成功，下一步"
                />
              </form>
            ),
          },
        ]}
      />
    </div>
  );
}

/** 上游交大流程：Canvas Access Token 步骤，DIICSU 版向导不再使用，保留以便同步上游。 */
export function CanvasTokenStep({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState('');
  const [state, setState] = useState<StepButtonState>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!window.dela) {
    return (
      <DesktopOnlyNotice
        description="Canvas Token 与课程缓存不会暴露给浏览器。"
        title="Canvas 仅在 DTQD 桌面端可用"
      />
    );
  }

  const submit = async () => {
    if (state === 'success') return onDone();
    if (state === 'busy') return;
    setState('busy');
    setError(null);
    try {
      await connectCanvas(token);
      setState('success');
    } catch (cause) {
      setError(errorText(cause));
      setState('idle');
    }
  };

  return (
    <div className="grid gap-7">
      <header className="grid gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">连接 Canvas</h2>
        <p className="text-13 leading-relaxed text-ink-3">同步课程与作业，凭据加密保存在本机。</p>
      </header>
      <StepGuide
        steps={[
          {
            title: '获取 Access Token',
            content: (
              <ol className="list-decimal space-y-1.5 ps-4 text-13 leading-relaxed text-ink-3">
                <li>浏览器打开 Canvas（oc.sjtu.edu.cn）并登录</li>
                <li>点击头像，进入「设置」</li>
                <li>在「允许融入使用的外部软件」处点「+ 创建新的访问许可证」</li>
                <li>用途自己取名，过期时间留空</li>
                <li>复制生成的字符串密钥</li>
              </ol>
            ),
          },
          {
            title: '粘贴并绑定 Access Token',
            content: (
              <form
                className="grid gap-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <StepInput
                  aria-label="Access Token"
                  autoComplete="off"
                  autoFocus
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="Access Token"
                  required
                  type="password"
                  value={token}
                />
                {error && (
                  <p className="text-13 [overflow-wrap:anywhere] text-red-600" role="alert">
                    {error}
                  </p>
                )}
                <StepButton
                  busyLabel="正在同步课程…"
                  idleLabel="保存并连接"
                  state={state}
                  successLabel="连接成功，下一步"
                />
              </form>
            ),
          },
        ]}
      />
    </div>
  );
}
