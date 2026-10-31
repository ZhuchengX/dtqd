import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { MailConfigureInput } from '../../../shared/mail';
import { SegmentedControl } from '../../components/ui/beautifului/atoms/SegmentedControl';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/utils';

const modes = ['交大邮箱', 'Dundee Outlook', '第三方 IMAP'] as const;

/** 向导页与邮箱空态共用的连接表单：交大邮箱走预设，第三方 IMAP 自填服务器参数。 */
export function MailAccountForm({
  error,
  onSubmit,
  submit,
  variant = 'app',
}: {
  error: string | null;
  onSubmit: (input: MailConfigureInput) => void;
  /** 提交按钮由调用方传入：向导要带成功态的 StepButton，应用内用 Button。 */
  submit: ReactNode;
  /** wizard：向导画布上的 40px 控件；app：应用内的 32px 控件。 */
  variant?: 'app' | 'wizard';
}) {
  const [mode, setMode] = useState<(typeof modes)[number]>('交大邮箱');
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState('993');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('465');
  const custom = mode === '第三方 IMAP';
  const microsoft = mode === 'Dundee Outlook';
  // Dundee Outlook（Microsoft 365）：只填 Azure 应用 ID，登录在微软页面完成（含 MFA）。
  const [clientId, setClientId] = useState('');
  const [tenant, setTenant] = useState('organizations');
  const [channels, setChannels] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = window.dela?.mail.getMicrosoftConfig;
    if (!load) return;
    void load()
      .then((config) => {
        if (cancelled) return;
        setClientId((current) => current || config.clientId);
        setTenant((current) => (current === 'organizations' ? config.tenant : current));
        setChannels(config.channels);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const wizard = variant === 'wizard';
  const field = wizard ? 'h-10 rounded-card' : '';
  const label = wizard ? 'text-13 font-medium text-ink-2' : 'text-xs font-medium text-ink-3';

  return (
    <form
      className={wizard ? 'grid gap-5' : 'grid gap-4'}
      onSubmit={(event) => {
        event.preventDefault();
        if (microsoft) {
          onSubmit({
            address: address.trim(),
            password: '',
            microsoft: { clientId: clientId.trim(), tenant: tenant.trim(), channels },
          });
          return;
        }
        onSubmit({
          address: address.trim(),
          password,
          ...(custom
            ? {
                server: {
                  imapHost: imapHost.trim(),
                  imapPort: Number(imapPort),
                  smtpHost: smtpHost.trim(),
                  smtpPort: Number(smtpPort),
                },
              }
            : {}),
        });
      }}
    >
      <SegmentedControl className="w-full" onChange={setMode} options={modes} value={mode} />
      <label className="grid gap-2">
        <span className={label}>邮箱地址</span>
        <Input
          autoComplete="off"
          className={field}
          onChange={(event) => setAddress(event.target.value)}
          placeholder={
            microsoft ? 'studentID@dundee.ac.uk' : custom ? 'name@example.com' : 'name@sjtu.edu.cn'
          }
          required={!microsoft}
          type="email"
          value={address}
        />
      </label>
      {microsoft ? (
        <div className="grid gap-4">
          <label className="grid gap-2">
            <span className={label}>Azure 应用（客户端）ID</span>
            <Input
              autoComplete="off"
              className={field}
              onChange={(event) => setClientId(event.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              value={clientId}
            />
          </label>
          <label className="grid gap-2">
            <span className={label}>租户（tenant）</span>
            <Input
              autoComplete="off"
              className={field}
              onChange={(event) => setTenant(event.target.value)}
              placeholder="organizations"
              value={tenant}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-ink-3">
            <input
              checked={channels}
              onChange={(event) => setChannels(event.target.checked)}
              type="checkbox"
            />
            同时读取 Teams 团队频道消息（需学校管理员同意，不确定就别勾）
          </label>
          <p className="text-xs leading-relaxed text-ink-3">
            {clientId.trim()
              ? '点击登录后在微软页面完成账号与 MFA 验证；邮件经 IMAP/SMTP OAuth2 收发，Teams 聊天只读。'
              : '需先在 Azure 注册应用，并把「应用程序（客户端）ID」填到上面（步骤见 docs/microsoft365-setup.md）。'}
          </p>
        </div>
      ) : (
        <label className="grid gap-2">
          <span className={label}>密码</span>
          <Input
            autoComplete="current-password"
            className={field}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={custom ? '邮箱密码或授权码' : 'jAccount 密码'}
            required
            type="password"
            value={password}
          />
        </label>
      )}
      <AnimatePresence initial={false}>
        {custom && (
          <motion.div
            animate={{ height: 'auto', opacity: 1 }}
            className="overflow-hidden"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            key="custom-server"
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            <div className="grid gap-4">
              <ServerRow
                field={field}
                host={imapHost}
                label={label}
                name="IMAP 服务器"
                onHost={setImapHost}
                onPort={setImapPort}
                placeholder="imap.example.com"
                port={imapPort}
              />
              <ServerRow
                field={field}
                host={smtpHost}
                label={label}
                name="SMTP 服务器"
                onHost={setSmtpHost}
                onPort={setSmtpPort}
                placeholder="smtp.example.com"
                port={smtpPort}
              />
              <p className="text-xs leading-relaxed text-ink-3">
                固定使用 SSL/TLS 加密；用户名即邮箱地址。发信走 SMTP，收信走 IMAP。
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {error && (
        <p
          className={wizard ? 'text-13 [overflow-wrap:anywhere] text-red-600' : 'text-13 text-red'}
          role="alert"
        >
          {error}
        </p>
      )}
      {submit}
    </form>
  );
}

/** 服务器地址 + 端口一行：端口固定窄列，地址占满剩余宽度。 */
function ServerRow({
  field,
  host,
  label,
  name,
  onHost,
  onPort,
  placeholder,
  port,
}: {
  field: string;
  host: string;
  label: string;
  name: string;
  onHost: (value: string) => void;
  onPort: (value: string) => void;
  placeholder: string;
  port: string;
}) {
  return (
    <div className="grid gap-2">
      <span className={label}>{name}</span>
      <div className="flex gap-2">
        <Input
          aria-label={`${name}地址`}
          autoComplete="off"
          className={cn('flex-1', field)}
          onChange={(event) => onHost(event.target.value)}
          placeholder={placeholder}
          required
          value={host}
        />
        <Input
          aria-label={`${name}端口`}
          className={cn('w-20', field)}
          inputMode="numeric"
          max={65535}
          min={1}
          onChange={(event) => onPort(event.target.value)}
          required
          type="number"
          value={port}
        />
      </div>
    </div>
  );
}
