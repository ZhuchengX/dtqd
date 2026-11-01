import { nativeTheme } from 'electron';

/** 窗口内容画出来之前的底色，跟随深浅色主题（对应 --page），避免深色模式下先闪一下白。 */
export function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#17181b' : '#f7f7f8';
}
