// 设置 › 重要事项：AI 提取与后台同步开关、关心的方向、各来源开关和状态、「立即同步」。
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

  const loginOffice = async () => {
    if (!window.dela) return;
    const result = await window.dela.inbox.loginCampusOffice();
    showToast(
      result.ok
        ? { variant: 'success', title: '校内办公网已登录' }
        : { variant: 'error', title: '登录没有完成', description: result.error },
    );
  };

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
        description="每 30 分钟同步一次你开启的来源。开启 AI 提取后，由你配置的模型挑出重要的事，放进待办并提醒你。"
        title="重要事项"
      />
      <SettingsGroup
        description="默认关闭。开启后，新内容会发给你在「模型供应商」里配置的模型服务，发出后无法撤回。关闭后，尚未发送的内容不再发送。"
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
            checked={prefs?.aiExtract ?? false}
            disabled={!prefs}
            label="AI 提取"
            // 打开时先弹说明框，学生点「开启」才生效。
            onChange={(next) =>
              void save(next ? { noticeAcknowledged: false } : { aiExtract: false })
            }
          />
        </SettingRow>
        <SettingRow
          description="开启后，Teams 私聊也会发给模型服务，聊天时的 Teams 命令也能查询私聊。关闭时聊天仍可能通过通用文件工具读到私聊存档文件。私聊含他人发言，不宜发送时请保持关闭。"
          settingId="inbox-teams-private"
          title="私聊进入提取"
        >
          <Switch
            checked={prefs?.teamsPrivate ?? false}
            disabled={!prefs}
            label="私聊进入提取"
            onChange={(next) => void save({ teamsPrivate: next })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        description="关闭后不再自动读取，只在你点「立即同步」时读取。"
        settingId="inbox-background"
        title="后台同步"
      >
        <SettingRow
          description="每 30 分钟读取一次开启的来源和学校公开网站。关闭窗口后仍会继续，从托盘退出才会停止。"
          settingId="inbox-background-sync"
          title="自动同步"
        >
          <Switch
            checked={prefs?.backgroundSync ?? true}
            disabled={!prefs}
            label="自动同步"
            onChange={(next) => void save({ backgroundSync: next })}
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
            : '还没有同步过'
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
            <Switch
              checked={prefs?.sources[source.source] ?? true}
              disabled={!prefs}
              label={inboxSourceLabels[source.source]}
              onChange={(next) =>
                prefs && void save({ sources: { ...prefs.sources, [source.source]: next } })
              }
            />
          </SettingRow>
        ))}
        <SettingRow
          description="默认关闭。开启后用你的校园登录读取 oa.csu.edu.cn 的通知，并进入 AI 提取和聊天问答，发给你配置的模型服务。这类通知可能不宜对外提供，请自行判断。"
          settingId="inbox-office-network"
          title="校内办公网"
        >
          {prefs?.officeNetwork && (
            <Button onClick={() => void loginOffice()} size="sm" variant="outline">
              登录校内办公网
            </Button>
          )}
          <Switch
            checked={prefs?.officeNetwork ?? false}
            disabled={!prefs}
            label="校内办公网"
            onChange={(next) => void save({ officeNetwork: next })}
          />
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
