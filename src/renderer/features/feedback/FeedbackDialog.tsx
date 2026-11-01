// 随手反馈：一个输入框，写完就发，不用填别的。
import { useState } from 'react';
import { Dialog } from 'radix-ui';
import { FEEDBACK_MAX_CHARS } from '../../../shared/feedback';
import { showToast } from '../../app/toasts';
import { Button } from '../../components/ui/button';
import { dialogOverlay, dialogPanel } from '../../components/ui/motion';
import { Textarea } from '../../components/ui/textarea';
import { errorText } from '../../workspace/store';

type FeedbackDialogProps = {
  open: boolean;
  page: string;
  onOpenChange: (open: boolean) => void;
};

export function FeedbackDialog({ open, page, onOpenChange }: FeedbackDialogProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!window.dela || !text.trim()) return;
    setSending(true);
    try {
      const { status } = await window.dela.feedback.send({ text, page });
      showToast(
        status === 'sent'
          ? { variant: 'success', title: '收到了，谢谢你' }
          : { variant: 'neutral', title: '已存在本机，联网后下次发送时一起发出' },
      );
      setText('');
      onOpenChange(false);
    } catch (cause) {
      showToast({ variant: 'error', title: '没有发出去', description: errorText(cause) });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className={`${dialogPanel} grid max-w-[440px] gap-3 p-5`}>
          <Dialog.Title className="text-15 font-semibold text-ink">反馈</Dialog.Title>
          <Dialog.Description className="text-13 text-ink-2">
            哪里不好用、想要什么，直接写。团队会在飞书群看到这段话、你所在的页面、软件版本和时间，不会收到其他内容。请不要写姓名、学号、账号或他人信息。
          </Dialog.Description>
          <Textarea
            autoFocus
            maxLength={FEEDBACK_MAX_CHARS}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void send();
            }}
            placeholder="比如：课表少了一节课"
            rows={5}
            value={text}
          />
          <div className="flex justify-end gap-2">
            <Button onClick={() => onOpenChange(false)} variant="ghost">
              取消
            </Button>
            <Button disabled={sending || !text.trim()} onClick={() => void send()}>
              发送
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
