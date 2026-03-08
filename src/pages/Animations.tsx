import { Player } from "@remotion/player";
import { ExternalLink, Film, Sparkles } from "lucide-react";

import { LaunchFilmComposition } from "@/components/animations/LaunchFilmComposition";
import {
  ANIMATION_DURATION_IN_FRAMES,
  ANIMATION_FPS,
  ANIMATION_HEIGHT,
  ANIMATION_WIDTH,
  animationBeats,
} from "@/components/animations/launchFilmData";

function formatSeconds(frame: number): string {
  return `${(frame / ANIMATION_FPS).toFixed(1)}s`;
}

export default function Animations() {
  return (
    <div className="min-h-full overflow-x-hidden bg-[linear-gradient(180deg,#f2eadf_0%,#e7dece_100%)]">
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-8 px-4 py-6 md:px-6 lg:px-8">
        <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[32px] border border-black/10 bg-white/65 p-6 shadow-[0_32px_90px_rgba(24,24,24,0.12)] backdrop-blur-md">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="type-micro text-[11px] text-[hsl(var(--brand-accent))]">Animations</p>
                <h1 className="mt-3 text-4xl tracking-[0.04em] text-black md:text-5xl">Coded launch-film scenes</h1>
                <p className="mt-4 max-w-3xl text-sm leading-relaxed text-black/65 md:text-base">
                  This page uses Remotion&apos;s React video model inside the app. The player is rendering coded scenes,
                  timed beats, and transitions that map directly to the launch-film storyboard.
                </p>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-black/10 bg-black px-4 py-2 text-white">
                <Film className="h-4 w-4" />
                <span className="font-mono text-xs uppercase tracking-[0.18em]">54s composition</span>
              </div>
            </div>

            <div className="mt-6 overflow-hidden rounded-[28px] border border-black/10 bg-black shadow-[0_25px_70px_rgba(0,0,0,0.18)]">
              <Player
                component={LaunchFilmComposition}
                durationInFrames={ANIMATION_DURATION_IN_FRAMES}
                fps={ANIMATION_FPS}
                compositionWidth={ANIMATION_WIDTH}
                compositionHeight={ANIMATION_HEIGHT}
                controls
                loop
                clickToPlay
                style={{
                  width: "100%",
                  aspectRatio: `${ANIMATION_WIDTH} / ${ANIMATION_HEIGHT}`,
                }}
              />
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-[32px] border border-black/10 bg-white/60 p-6 shadow-[0_26px_70px_rgba(24,24,24,0.10)] backdrop-blur-md">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[hsl(var(--brand-accent))] text-white">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <p className="type-micro text-[11px] text-[hsl(var(--brand-accent))]">Why Remotion</p>
                  <p className="text-lg font-semibold text-black">React components become video scenes.</p>
                </div>
              </div>
              <div className="mt-5 space-y-3 text-sm leading-relaxed text-black/68">
                <p>Remotion uses React to define compositions, sequence timing, animated interpolation, and renderable video frames.</p>
                <p>This route uses the embedded player approach first, so you can iterate on scenes in the app before deciding whether to add full render/export automation.</p>
              </div>
              <a
                href="https://www.remotion.dev/docs"
                target="_blank"
                rel="noreferrer"
                className="mt-5 inline-flex items-center gap-2 rounded-full border border-black/10 bg-black px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white transition-colors hover:bg-black/85"
              >
                Remotion Docs
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>

            <div className="rounded-[32px] border border-black/10 bg-white/60 p-6 shadow-[0_26px_70px_rgba(24,24,24,0.10)] backdrop-blur-md">
              <p className="type-micro text-[11px] text-[hsl(var(--brand-accent))]">Timeline</p>
              <div className="mt-5 space-y-3">
                {animationBeats.map((beat) => (
                  <div key={beat.id} className="rounded-[22px] border border-black/8 bg-white/70 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-base font-semibold text-black">{beat.title}</p>
                        <p className="mt-1 text-sm text-black/55">{beat.headline}</p>
                      </div>
                      <div className="text-right font-mono text-[11px] uppercase tracking-[0.16em] text-black/45">
                        <div>{formatSeconds(beat.startFrame)} - {formatSeconds(beat.endFrame + 1)}</div>
                      </div>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-black/62">{beat.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
