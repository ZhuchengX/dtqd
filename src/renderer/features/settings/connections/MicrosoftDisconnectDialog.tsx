import { useState } from 'react';
import { Dialog } from 'radix-ui';
import { showToast } from '../../../app/toasts';
import { Button } from '../../../components/ui/button';
import { dialogOverlay, dialogPanel } from '../../../components/ui/motion';
import { cn } from '../../../lib/utils';
import { errorText } from '../../../workspace/store';
import type { MicrosoftWebConnection } from '../../../../shared/teams';

type MicrosoftDisconnectDialogProps = {
  open: boolean;
  /** 已连接时断开账号；已断开时只删除保留的存档。 */
  connected: boolean;
  onClose: () => void;
  onDisconnected: (connection: MicrosoftWebConnection) => void;
};

/** 断开 Teams 与 Dundee 邮箱：两者共用微软登录，只能一起退出；存档由学生决定留不留。 */
export function MicrosoftDisconnectDialog({
  open,
  connected,
  onClose,
  onDisconnected,
}: MicrosoftDisconnectDialogProps) {
  const [busy, setBusy] = useState(false);

  const disconnect = async (deleteData: boolean) => {
    if (!window.dela || busy) return;
    setBusy(true);
    try {
      onDisconnected(await window.dela.teams.disconnect(deleteData));
      onClose();
      const done = connected ? '已断开，' : '';
      showToast({
        title: `${done}${deleteData ? '本机存档已删除' : '本机存档已保留'}`,
        variant: 'neutral',
      });
    } catch (cause) {
      showToast({ variant: 'error', title: '断开失败', description: errorText(cause) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      open={open}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className={cn(dialogPanel, 'max-w-md')}>
          <Dialog.Title className="text-base font-semibold">
            {connected ? '断开 Teams 与 Dundee 邮箱' : '删除本机存档'}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-xs leading-relaxed text-ink-3">
            {connected && '两者共用一个微软登录，会一起退出，后台不再同步。'}
            本机存档是已同步的 Teams
            消息和读到的邮件列表；删除后无法恢复，已发给模型服务的内容不受影响。
          </Dialog.Description>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button disabled={busy} onClick={onClose} variant="ghost">
              取消
            </Button>
            {connected && (
              <Button disabled={busy} onClick={() => void disconnect(false)} variant="secondary">
                只断开，保留存档
              </Button>
            )}
            <Button disabled={busy} onClick={() => void disconnect(true)} variant="destructive">
              {connected ? '断开并删除存档' : '删除存档'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
