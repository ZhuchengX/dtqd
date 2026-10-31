// 设置 › 重要事项：AI 提取开关、关心的方向、各来源同步状态与「立即同步」。
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { inboxInterestOptions, inboxSourceLabels, type InboxPrefs } from '../../../shared/api';
import { Button } from '../../components/ui/button';
import { Switch } from '@/components/ui/beautifului/atoms/Switch';
import { showToast } from '../../app/toasts';
import { errorText } from '../../workspace/store';
import { cn } from '../../lib/utils';
import { useNavigationStore } from '../../navigation/view';
import { SettingRow } from '../settings/SettingRow';
import { SettingsGroup } from '../settings/SettingsGroup';
import { SectionHeader } from '../settings/SectionHeader';
import {
  relativeTime,
  runStatusLabels,
  sourceStatusLabels,
  usageLabel,
  useInboxState,
} from './use-inbox';

export function InboxSection() {
  const state = useInboxState();
  const [busy, setBusy] = useState(false);

  const save = async (patch: Partial<InboxPrefs>) => {
    if (!window.dela) return;
    try {
      await window.dela.inbox.setPrefs(patch);
    } catch (cause) {
      showToast({ variant: 'error', title: '保存失败', description: errorText(cause) });
    }
  };

  const syncNow = async () => {
    if (!window.dela) return;
    setBusy(true);
    try {
      await window.dela.inbox.run();
    } catch (cause) {
      showToast({ variant: 'error', title: '同步失败', description: errorText(cause) });
    } finally {
      setBusy(false);
    }
  };

  const prefs = state?.prefs;
  const toggleInterest = (interest: string) => {
    if (!prefs) return;
    const interests = prefs.interests.includes(interest)
      ? prefs.interests.filter((item) => item !== interest)
      : [...prefs.interests, interest];
    void save({ interests });
  };
  const run = state?.lastRun;
  const syncing = busy || Boolean(state?.running);

  return (
    <div className="grid gap-6">
      <SectionHeader
        description="每 30 分钟把 Teams、Outlook、myDundee 公告和 QQ 收到的文件读一遍，只把对你重要的事放进待办，并提醒你。"
        title="重要事项"
      />
      <SettingsGroup
        description="开启后，新消息的正文会发给你在「模型供应商」里配置的模型（不经过 DTQD 的服务器，DTQD 没有服务器）。关闭后只在本机同步存档，新消息留着，开启后再提取。"
        settingId="inbox-ai"
        title="AI 提取"
      >
        <SettingRow
          description={
            state?.model
              ? `当前使用：${state.model}（优先选名字带 flash 的快速模型）· ${usageLabel(state.usage)}`
              : '还没有可用的模型：先在「模型供应商」里配置一个'
          }
          settingId="inbox-ai-extract"
          title="用模型从新消息里挑出重要的事"
        >
          <Switch
            checked={prefs?.aiExtract ?? true}
            disabled={!prefs}
            label="AI 提取"
            onChange={(next) => void save({ aiExtract: next, noticeAcknowledged: true })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        description="招聘、讲座、项目信息只有跟你选的方向有关、且有报名或申请截止时才进待办。"
        settingId="inbox-interests"
        title="我关心的方向"
      >
        <div className="flex flex-wrap gap-2 py-3.5">
          {inboxInterestOptions.map((interest) => {
            const selected = prefs?.interests.includes(interest) ?? false;
            return (
              <button
                aria-pressed={selected}
                className={cn(
                  'rounded-full border px-3 py-1 text-13 transition-colors',
                  selected
                    ? 'border-ink bg-ink text-surface'
                    : 'border-line-strong text-ink-2 hover:bg-hover',
                )}
                disabled={!prefs}
                key={interest}
                onClick={() => toggleInterest(interest)}
                type="button"
              >
                {interest}
              </button>
            );
          })}
        </div>
      </SettingsGroup>

      <SettingsGroup
        action={
          <Button
            disabled={syncing || !state}
            onClick={() => void syncNow()}
            size="sm"
            variant="outline"
          >
            <RefreshCw className={cn(syncing && 'animate-spin')} />
            {syncing ? '同步中…' : '立即同步'}
          </Button>
        }
        description={
          run
            ? `上次提取：${relativeTime(run.at)} · ${runStatusLabels[run.status]}${run.status === 'ok' ? `：重要 ${run.items} 件，新建待办 ${run.todos} 件` : ''}`
            : '启动 20 秒后第一次同步'
        }
        settingId="inbox-sources"
        title="来源"
      >
        <SettingRow
          description={state?.model ?? '没有可用模型时只同步存档，不提取'}
          settingId="inbox-source-model"
          title="提取用的模型"
        >
          {state?.model ? (
            <span className="text-13 text-ink-2">正常</span>
          ) : (
            <Button
              onClick={() => useNavigationStore.getState().openSettings('providers')}
              size="sm"
              variant="outline"
            >
              去配置
            </Button>
          )}
        </SettingRow>
        {(state?.sources ?? []).map((source) => (
          <SettingRow
            description={source.detail ?? `上次同步：${relativeTime(source.lastSyncAt)}`}
            key={source.source}
            settingId={`inbox-source-${source.source}`}
            title={inboxSourceLabels[source.source]}
          >
            <span
              className={cn(
                'text-13',
                source.status === 'ok'
                  ? 'text-ink-2'
                  : source.status === 'needs-login' || source.status === 'error'
                    ? 'text-red'
                    : 'text-ink-3',
              )}
            >
              {sourceStatusLabels[source.status]}
              {source.status === 'ok' && source.newItems > 0 ? ` · 新 ${source.newItems} 条` : ''}
            </span>
          </SettingRow>
        ))}
      </SettingsGroup>
    </div>
  );
}
