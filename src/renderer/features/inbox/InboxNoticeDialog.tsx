// AI 提取默认开启：第一次运行时说明一次「新消息会发给你配置的模型」，学生可当场关掉。
import { Dialog } from 'radix-ui';
import { Button } from '../../components/ui/button';
import { dialogOverlay, dialogPanel } from '../../components/ui/motion';
import { cn } from '../../lib/utils';
import { isSmokeTest } from '../onboarding/onboarding-state';
import { useInboxState } from './use-inbox';

export function InboxNoticeDialog() {
  const state = useInboxState();
  if (isSmokeTest || !state || state.prefs.noticeAcknowledged) return null;

  const answer = (aiExtract: boolean) =>
    void window.dela?.inbox.setPrefs({ aiExtract, noticeAcknowledged: true });

  return (
    <Dialog.Root onOpenChange={(open) => !open && answer(true)} open>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className={cn(dialogPanel, 'max-w-md')}>
          <Dialog.Title className="text-base font-semibold">重要事项自动提取已开启</Dialog.Title>
          <Dialog.Description asChild>
            <div className="mt-3 grid gap-2 text-13 leading-relaxed text-ink-2">
              <p>
                DTQD 每 30 分钟读一遍 Teams、Outlook、myDundee 公告和 QQ
                收到的文件，只把截止日期、等你回复的消息和不看会吃亏的通知放进待办并提醒你。
              </p>
              <p>
                挑选由你在「模型供应商」里配置的模型完成：
                <strong className="text-ink">新消息的正文会发给该模型服务</strong>
                ，不经过 DTQD 的服务器（DTQD 没有服务器）。
              </p>
              <p className="text-ink-3">随时可在 设置 › 重要事项 里关闭或调整关心的方向。</p>
            </div>
          </Dialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => answer(false)} variant="outline">
              关闭 AI 提取
            </Button>
            <Button autoFocus onClick={() => answer(true)}>
              好的
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
