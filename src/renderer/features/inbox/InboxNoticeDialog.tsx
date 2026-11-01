// AI 提取默认关闭：第一次发送前必须学生点「开启」；按 Esc 或点外部都算暂不开启。
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
    <Dialog.Root onOpenChange={(open) => !open && answer(false)} open>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className={cn(dialogPanel, 'max-w-md')}>
          <Dialog.Title className="text-base font-semibold">
            是否开启重要事项 AI 提取？
          </Dialog.Title>
          <Dialog.Description asChild>
            <div className="mt-3 grid gap-2 text-13 leading-relaxed text-ink-2">
              <p>
                开启后，DTQD 每 30 分钟把新内容发给你在「模型供应商」里配置的模型服务（当前：
                {state.model ?? '尚未配置'}
                ），由它挑出截止日期、等你回复的消息和重要通知。发送的内容包括：
              </p>
              <ul className="list-disc pl-5">
                <li>Teams 频道和群聊消息（私聊需另外开启）</li>
                <li>Outlook 收件箱的发件人、主题和预览（IMAP 邮箱为正文）</li>
                <li>myDundee 公告、校园通知</li>
                <li>QQ 接收文件的文件名</li>
                <li>你的在读课程和关心方向</li>
              </ul>
              <p>
                <strong className="text-ink">
                  这些内容会含老师和同学的姓名与发言，发出后由该模型服务按其规则处理，DTQD
                  无法控制或撤回。
                </strong>
                DTQD 自己不接收这些内容。
              </p>
              <p className="text-ink-3">
                不开启也可以正常使用其他功能。你可以随时在 设置 › 重要事项 里更改。
              </p>
            </div>
          </Dialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => answer(false)} variant="outline">
              暂不开启
            </Button>
            <Button onClick={() => answer(true)}>开启</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
