import { useWorkspaceStore } from '../../../workspace/store';

/**
 * 连接 Canvas 并同步课程列表：配置 Token、拉取课程并写入全局工作区状态。
 * 失败时抛出错误（调用方用 errorText 转文案）；Canvas 表单与首启向导共用。
 */
export async function connectCanvas(token: string): Promise<void> {
  const dela = window.dela;
  if (!dela) return;
  await dela.canvas.configure(token);
  useWorkspaceStore.getState().setCanvas(await dela.canvas.syncCourses());
}

/** 登录 myDundee（Blackboard）并同步课程列表；登录窗由主进程打开，学生自行完成 Microsoft SSO。 */
export async function connectBlackboard(): Promise<void> {
  const dela = window.dela;
  if (!dela) return;
  await dela.canvas.loginBlackboard();
  useWorkspaceStore.getState().setCanvas(await dela.canvas.syncCourses());
}

/** 仅 macOS：从 Chrome / Edge 导入 myDundee 登录并同步课程列表；返回来源浏览器名。 */
export async function importBlackboardFromBrowser(): Promise<string | undefined> {
  const dela = window.dela;
  if (!dela) return undefined;
  const browser = await dela.canvas.importBlackboardFromBrowser();
  useWorkspaceStore.getState().setCanvas(await dela.canvas.syncCourses());
  return browser;
}
