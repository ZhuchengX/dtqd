import { legalRevisions } from '../../../shared/legal';

const completedKey = 'dela.onboarding.completed';
const stepKey = 'dela.onboarding.step';
const consentKey = 'dela.onboarding.consent';

// 冒烟与自动化由 main 或各 smoke 脚本在页面 URL 上注入该参数，整个引导直接短路。
export const isSmokeTest = new URLSearchParams(window.location.search).has('smoke-test');

const acceptedRevisions = `${legalRevisions.terms}|${legalRevisions.privacy}`;

/** 条款接受记录：只认当前版本，「最后更新」变化后重新展示条款。 */
export function hasConsent() {
  return localStorage.getItem(consentKey) === acceptedRevisions;
}

export function saveConsent() {
  localStorage.setItem(consentKey, acceptedRevisions);
}

export function needsWizard() {
  return localStorage.getItem(completedKey) !== '1';
}

/**
 * 是否跳过原有引导流程。没有接受记录就一定先展示条款页，避免拒绝后重启绕过。
 * 接受过条款后不恢复旧向导；App 仍会检查独立的能力拓展版本。
 */
export function onboardingCompleted() {
  return isSmokeTest || hasConsent();
}

/** 当前向导步骤；新启动不再恢复未完成的引导。 */
export function readWizardStep(): number | null {
  const raw = localStorage.getItem(stepKey);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function saveWizardStep(step: number) {
  localStorage.setItem(stepKey, String(step));
}

export function markOnboardingCompleted() {
  localStorage.setItem(completedKey, '1');
  localStorage.removeItem(stepKey);
}
