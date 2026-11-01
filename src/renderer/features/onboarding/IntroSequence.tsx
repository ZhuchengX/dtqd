import { useEffect, useState } from 'react';
import { MotionConfig, motion, useReducedMotion } from 'framer-motion';
import logo from '../../../../assets/DTQD_Logo.png';
import { OnboardingWindowBar } from './onboarding-window-bar';
import { cn } from '../../lib/utils';

// 氛围视频（854×474、静音、9.5s）：铺满整窗裁切不拉伸；品牌层出现后用高斯模糊退为背景，
// 不叠白色蒙版。DTQD：上游开场视频含 Dela 品牌，已移除，
// 换成 DTQD 自有视频后在这里填 URL 即可恢复。
const introVideoUrl: string | undefined = undefined;

// 时间线（秒）：视频先播约两秒立住氛围，之后自上而下依次落笔，视线单方向移动。
const videoFadeSeconds = 0.6;
const logoAtSeconds = 3.2;
const logoSeconds = 0.7;
const blurAtSeconds = 3.2;
const blurSeconds = 1.4;
// 一开始就带 6px 模糊（视频本身分辨率不高），品牌层起来后再加到 12px 退为背景。
const blurStartPx = 6;
const blurPx = 12;
const nameAtSeconds = 4.2;
const ctaAtSeconds = 5.4;
const ctaSeconds = 0.6;
const leaveSeconds = 0.35;

/** 首启引导的开场：全屏氛围视频之上，Logo 浮现，品牌名随后淡入。 */
export function IntroSequence({ onStart }: { onStart: () => void }) {
  // 动画期间就提供「跳过」，CTA 出现前不响应点击（避免隐 form 中误触、无可见反馈）。
  const reduced = useReducedMotion() ?? false;
  const [ctaReady, setCtaReady] = useState(false);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (reduced) {
      setCtaReady(true);
      return;
    }
    const timer = setTimeout(() => setCtaReady(true), ctaAtSeconds * 1000);
    return () => clearTimeout(timer);
  }, [reduced]);

  const leave = () => setLeaving(true);

  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        animate={{ opacity: leaving ? 0 : 1 }}
        className="relative grid h-dvh grid-rows-[auto_1fr] bui-light bg-surface text-ink"
        data-onboarding-intro=""
        // 淡出结束后才切给向导，避免开场被直接抽走。
        onAnimationComplete={() => {
          if (leaving) onStart();
        }}
        transition={{ duration: leaveSeconds, ease: 'easeOut' }}
      >
        {/* 氛围层铺满整窗（含标题栏区域，标题栏本身透明），直接淡入——圆扩散太抢戏。 */}
        <motion.div
          animate={{ opacity: 1 }}
          className="pointer-events-none absolute inset-0 overflow-hidden"
          initial={reduced ? false : { opacity: 0 }}
          transition={{ duration: videoFadeSeconds, ease: 'easeOut' }}
        >
          {introVideoUrl && (
            <video
              autoPlay
              className="size-full object-cover"
              loop
              muted
              playsInline
              src={introVideoUrl}
            />
          )}
          {/* 品牌层起来时用一层透明高斯模糊压住视频，文字不靠白色蒙版也读得清。 */}
          <motion.div
            animate={{ backdropFilter: `blur(${blurPx}px)` }}
            className="absolute inset-0"
            initial={reduced ? false : { backdropFilter: `blur(${blurStartPx}px)` }}
            transition={{ delay: blurAtSeconds, duration: blurSeconds, ease: 'easeInOut' }}
          />
        </motion.div>

        <OnboardingWindowBar />
        {/* pb 让品牌列整体居中偏上，Logo 视觉重心落在画面上半部；矮窗口收缩留白与 Logo。 */}
        <div className="relative grid place-items-center overflow-hidden pb-[10vh] [@media(max-height:560px)]:pb-4">
          {/* 跳过动画：全程可点，不必等 CTA 出现。 */}
          <button
            className="absolute right-6 top-4 z-10 text-13 text-ink-3 transition-colors hover:text-ink"
            onClick={leave}
            type="button"
          >
            跳过
          </button>

          <div className="relative flex flex-col items-center">
            <motion.img
              alt="DTQD"
              animate={{ opacity: 1, y: 0 }}
              className="size-[11.25rem] [@media(max-height:560px)]:size-[8.25rem]"
              initial={reduced ? false : { opacity: 0, y: 14 }}
              src={logo}
              transition={{ delay: logoAtSeconds, duration: logoSeconds, ease: 'easeOut' }}
            />
            {/* DTQD：上游 name 行是预生成的「Dela」手写字形（字体子集无 T/Q），改为淡入的字标。 */}
            <motion.h1
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 text-6xl font-semibold tracking-tight text-ink [@media(max-height:560px)]:mt-3 [@media(max-height:560px)]:text-5xl"
              initial={reduced ? false : { opacity: 0, y: 10 }}
              transition={{ delay: nameAtSeconds, duration: 0.5, ease: 'easeOut' }}
            >
              DTQD
            </motion.h1>
            {/* DTQD：上游 Quote 与原作者署名两行不再渲染（字形素材 intro-lettering.ts 保留）。 */}
          </div>

          <motion.button
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              'absolute bottom-12 rounded-full bg-ink px-7 py-2.5 text-13 text-surface transition-colors hover:opacity-90 [@media(max-height:560px)]:bottom-6',
              !ctaReady && 'pointer-events-none',
            )}
            initial={reduced ? false : { opacity: 0, y: 10 }}
            onClick={leave}
            transition={{ delay: ctaAtSeconds, duration: ctaSeconds, ease: 'easeOut' }}
            type="button"
          >
            开始配置个人资料
          </motion.button>
        </div>
      </motion.div>
    </MotionConfig>
  );
}
