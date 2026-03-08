import { AbsoluteFill, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { BarChart3, Download, FileStack, SearchCheck, SendHorizonal, Sparkles } from "lucide-react";

import { animationBeats, launchFilmData } from "./launchFilmData";

const SPRINGS = {
  snappy: { damping: 14, stiffness: 220, mass: 0.8 },
  smooth: { damping: 24, stiffness: 120, mass: 1 },
  float: { damping: 30, stiffness: 60, mass: 1.2 },
  overshoot: { damping: 12, stiffness: 180, mass: 1.1 },
};

function reveal(frame: number, fps: number, delay = 0, config = SPRINGS.snappy): number {
  return spring({
    fps,
    frame: Math.max(0, frame - delay),
    config,
  });
}

function map(value: number, input: [number, number], output: [number, number]) {
  return interpolate(value, input, output, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

function Grain() {
  return (
    <AbsoluteFill className="pointer-events-none opacity-[0.45] mix-blend-overlay">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.08)_0_1px,transparent_1px),radial-gradient(circle_at_80%_30%,rgba(255,255,255,0.06)_0_1px,transparent_1px),radial-gradient(circle_at_40%_75%,rgba(255,255,255,0.07)_0_1px,transparent_1px),radial-gradient(circle_at_70%_80%,rgba(255,255,255,0.05)_0_1px,transparent_1px)] [background-size:28px_28px,32px_32px,24px_24px,36px_36px]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent_35%,rgba(0,0,0,0.04))]" />
    </AbsoluteFill>
  );
}

function Stage({
  children,
  dark = false,
}: {
  children: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <AbsoluteFill className={dark ? "overflow-hidden bg-[#0c0c10] text-white" : "overflow-hidden bg-[#f4f1ea] text-[#111111]"}>
      <div
        className={
          dark
            ? "absolute inset-0 bg-[radial-gradient(circle_at_14%_18%,#7f5ec233,transparent_40%),radial-gradient(circle_at_86%_72%,#ffb45011,transparent_40%),linear-gradient(180deg,#0e0d12_0%,#050507_100%)]"
            : "absolute inset-0 bg-[radial-gradient(circle_at_16%_20%,#7f5ec21a,transparent_36%),radial-gradient(circle_at_84%_80%,#ffb4501a,transparent_36%),linear-gradient(to_bottom,#f4f0e9,#e9e4d9)]"
        }
      />
      <div className="absolute inset-0 opacity-[0.05] grayscale brightness-0 invert-[.1] [background-image:linear-gradient(rgba(0,0,0,0.8)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.8)_1px,transparent_1px)] [background-size:64px_64px]" />
      <Grain />
      {children}
    </AbsoluteFill>
  );
}

function Card({
  children,
  className = "",
  dark = false,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  dark?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`relative isolate ${dark ? "border-white/10 bg-[#121118]/80 text-white" : "border-black/5 bg-white/65 text-[#111111]"} rounded-[26px] border shadow-[0_45px_110px_rgba(0,0,0,0.14)] backdrop-blur-xl ${className}`}
      style={style}
    >
      <div className={`absolute inset-0 -z-10 bg-gradient-to-br ${dark ? "from-white/5 to-transparent" : "from-black/5 to-transparent"} rounded-[26px] pointer-events-none`} />
      {children}
    </div>
  );
}

function Micro({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return <p className={`font-mono text-[11px] uppercase tracking-[0.24em] ${dark ? "text-white/45" : "text-[#7f5ec2]"}`}>{children}</p>;
}

function LogoBug({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`rounded-[16px] border ${dark ? "border-white/10 bg-white/5" : "border-black/10 bg-white/60"} px-4 py-2`}>
        <Img src={staticFile(launchFilmData.brand.logoSrc.replace(/^\//, ""))} className="h-8 w-auto object-contain" />
      </div>
    </div>
  );
}

function CountChip({ icon: Icon, label }: { icon: typeof FileStack; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3 py-2">
      <Icon className="h-4 w-4 text-[#7f5ec2]" />
      <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-black/60">{label}</span>
    </div>
  );
}

function MetricCards({ items, dark = false }: { items: Array<{ label: string; value: string }>; dark?: boolean }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div className="grid grid-cols-4 gap-3">
      {items.map((item, index) => {
        const cardReveal = reveal(frame, fps, 100 + index * 4);
        return (
          <Card
            key={item.label}
            className={`relative overflow-hidden px-4 py-4 ${dark ? "bg-white/6" : "bg-white/84"}`}
            dark={dark}
            style={{
              opacity: cardReveal,
              transform: `translateY(${map(cardReveal, [0, 1], [30, 0])}px) perspective(1000px) rotateY(${map(cardReveal, [0, 1], [-20, 0])}deg)`,
            }}
          >
            <div className="relative z-10">
              <p className={`font-mono text-[10px] uppercase tracking-[0.18em] ${dark ? "text-white/45" : "text-black/42"}`}>{item.label}</p>
              <p className="mt-2 font-['Archivo'] text-[24px] font-semibold">{item.value}</p>
            </div>
            <div className={`absolute inset-0 z-0 bg-gradient-to-tr ${dark ? "from-white/5" : "from-black/5"} to-transparent`} />
            <div
              className="absolute inset-0 z-20 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full"
              style={{
                animation: cardReveal > 0.9 ? "shimmer 3s infinite 2s" : "none"
              }}
            />
          </Card>
        );
      })}
    </div>
  );
}

function TypeLine({ text, start = 0, speed = 1.15 }: { text: string; start?: number; speed?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const chars = Math.max(0, Math.floor((frame - start) / speed));
  const show = text.slice(0, chars);

  return (
    <span className="relative">
      {show.split("").map((char, i) => {
        const charReveal = reveal(frame, fps, start + i * speed, SPRINGS.snappy);
        return (
          <span
            key={i}
            style={{
              opacity: charReveal,
              display: "inline-block",
              transform: `translateY(${map(charReveal, [0, 1], [6, 0])}px)`,
            }}
          >
            {char === " " ? "\u00A0" : char}
          </span>
        );
      })}
      <span className="ml-1 inline-block animate-[pulse_0.4s_infinite] text-[#7f5ec2]" style={{ opacity: Math.max(0, 1 - show.length / text.length) }}>|</span>
    </span>
  );
}

type HeaderAnim = "split" | "blur" | "kinetic" | "drift";

function SceneHeader({
  eyebrow,
  title,
  dark = false,
  exitStart = 150,
  className = "",
  titleClassName = "",
  style = "split"
}: {
  eyebrow: string;
  title: React.ReactNode;
  dark?: boolean;
  exitStart?: number;
  className?: string;
  titleClassName?: string;
  style?: HeaderAnim;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const intro = reveal(frame, fps, 0, SPRINGS.overshoot);
  const outro = map(frame, [exitStart, exitStart + 35], [0, 1]);

  const opacity = map(intro, [0, 1], [0, 1]) * map(outro, [0, 1], [1, 0]);

  // Custom intro/outro mechanics based on style
  let transform = `translateY(${map(intro, [0, 1], [60, 0])}px)`;
  let filter = `none`;
  const letterSpacing = style === "kinetic" ? `${map(intro, [0, 1], [0.4, 0.05])}em` : "0.05em";

  if (style === "blur") {
    filter = `blur(${map(intro, [0, 1], [20, 0]) + map(outro, [0, 1], [0, 20])}px)`;
    transform = `scale(${map(intro, [0, 1], [1.1, 1]) + map(outro, [0, 1], [0, 0.1])})`;
  } else if (style === "drift") {
    transform = `translateX(${map(intro, [0, 1], [-100, 0]) + map(outro, [0, 1], [0, 200])}px)`;
  } else if (style === "kinetic") {
    transform = `skewX(${map(intro, [0, 1], [15, 0])}deg) translateY(${map(intro, [0, 1], [80, 0])}px)`;
  }

  return (
    <div
      className={`absolute left-12 top-28 z-20 max-w-[840px] pointer-events-none ${className}`}
      style={{
        opacity,
        transform,
        filter,
        letterSpacing
      }}
    >
      <div style={{ opacity: intro, transform: `translateX(${map(intro, [0, 1], [-30, 0])}px)` }}>
        <div className="flex items-center gap-3">
          <div className={`h-1.5 w-8 ${dark ? "bg-white/30" : "bg-[#7f5ec2]/40"}`} />
          <Micro dark={dark}>{eyebrow}</Micro>
        </div>
      </div>
      <div
        className={`mt-6 font-['Bebas_Neue'] text-[124px] uppercase leading-[0.82] tracking-tight ${dark ? "text-white" : "text-[#111111]"} ${titleClassName}`}
        style={{
          textShadow: dark ? "0 0 40px rgba(0,0,0,0.5)" : "none",
        }}
      >
        {title}
      </div>
    </div>
  );
}

function IngestionScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pulse = map(Math.sin(frame / 12), [-1, 1], [0.92, 1.04]);

  const cards = Array.from({ length: 18 }).map((_, index) => {
    const row = Math.floor(index / 6);
    const col = index % 6;

    // Starting grid layout
    const xStart = -480 + col * 200;
    const yStart = -260 + row * 240;

    const turn = reveal(frame, fps, index * 0.8, SPRINGS.overshoot);
    const wander = map(Math.sin((frame + index * 5) / 30), [-1, 1], [-15, 15]);
    const outro = map(frame, [155, 185], [0, 1]);

    // Terminal Monolith style: Cards form a monolithic vertical tower
    const x = map(turn, [0, 1], [-600 + (index % 4) * 40, (index - 9) * 4]) + wander + map(outro, [0, 1], [0, 200]);
    const y = map(turn, [0, 1], [0, (index - 9) * 25]);
    const z = map(turn, [0, 1], [-800, 0]) - map(outro, [0, 1], [0, 400]);

    const rotateX = map(turn, [0, 1], [40, 10]);
    const rotateY = map(turn, [0, 1], [-30, (index - 9) * 2]) + map(outro, [0, 1], [0, 45]);
    const rotateZ = map(turn, [0, 1], [20, 0]);

    const scale = map(turn, [0, 1], [0.5, 1]) * map(outro, [0, 1], [1, 0.5]);
    const opacity = map(turn, [0, 1], [0, 1]) * map(outro, [0, 1], [1, 0]);

    return { x, y, z, rotateX, rotateY, rotateZ, scale, opacity };
  });
  const ledgerReveal = reveal(frame, fps, 128);
  const orbit = frame * 0.9;

  return (
    <Stage>
      <div className="relative h-full px-12 py-10">
        <div className="flex items-start justify-between">
          <LogoBug />
          <div className="flex gap-3">
            <CountChip icon={FileStack} label="500 pages" />
            <CountChip icon={SearchCheck} label="7 CMO reports" />
            <CountChip icon={BarChart3} label="5,000 rows" />
          </div>
        </div>

        <div className="absolute left-10 top-20 z-20">
          <div className="flex items-center gap-3">
            <div className="h-1.5 w-8 bg-[#7f5ec2]" />
            <Micro>The Foundation</Micro>
          </div>
          <h1 className="mt-6 font-['Bebas_Neue'] text-[100px] uppercase leading-[0.85] tracking-tight text-[#111111]">
            SEVERAL <span className="text-[#7f5ec2]">CMO REPORTS.</span>
            <br />
            HUNDREDS OF PAGES.
          </h1>
        </div>

        <div
          className="absolute z-30 text-right pointer-events-none"
          style={{
            right: 64,
            bottom: 60,
            opacity: reveal(frame, fps, 92),
            transform: `translateY(${map(reveal(frame, fps, 92), [0, 1], [30, 0])}px)`,
          }}
        >
          <p className="font-['Archivo'] text-[32px] font-bold leading-none text-black/60 tracking-widest uppercase font-mono">
            thousands of rows
          </p>
          <h1 className="mt-3 font-['Bebas_Neue'] text-[96px] uppercase leading-[0.85] tracking-[0.04em] text-[#7f5ec2]">
            normalized to a<br />unified ledger
          </h1>
        </div>

        <div className="absolute inset-0">
          <div className="absolute left-[50%] top-[48%] h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(127,94,194,0.24)_0%,rgba(127,94,194,0.08)_32%,transparent_68%)]" />
          <div
            className="absolute left-[50%] top-[48%] h-[620px] w-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#7f5ec2]/20"
            style={{
              transform: `translate(-50%, -50%) rotate(${orbit}deg) scale(${pulse})`,
              opacity: map(frame, [155, 185], [1, 0])
            }}
          />
        </div>

        <div className="absolute inset-0 perspective-[1200px]">
          {cards.map((card, index) => (
            <div
              key={index}
              className="absolute left-[50%] top-[48%] h-[280px] w-[200px] rounded-[12px] border border-black/10 bg-white p-5 shadow-[0_20px_60px_rgba(0,0,0,0.1)]"
              style={{
                opacity: card.opacity,
                transform: `translate(-50%, -50%) translate3d(${card.x}px, ${card.y}px, ${card.z}px) rotateX(${card.rotateX}deg) rotateY(${card.rotateY}deg) rotateZ(${card.rotateZ}deg) scale(${card.scale})`,
                backfaceVisibility: "hidden",
                borderWidth: `1px ${index % 2 === 0 ? "4px" : "1px"} 1px 1px`,
              }}
            >
              <div className="absolute right-0 top-0 h-10 w-10 overflow-hidden rounded-bl-[18px] rounded-tr-[22px] border-l border-b border-black/8 bg-[#f2ecff]" />
              <div className="flex items-center justify-between">
                <Micro>pdf</Micro>
                <div className="flex items-center gap-1.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-[#7f5ec2] animate-pulse" />
                  <span className="rounded-full bg-[#111111] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-white">
                    {launchFilmData.ingestion.cmos[index % launchFilmData.ingestion.cmos.length]}
                  </span>
                </div>
              </div>
              <div className="mt-3 space-y-2.5">
                <div className="h-3 w-3/4 rounded-full bg-black/14" />
                <div className="h-3 w-1/2 rounded-full bg-black/12" />
                <div className="h-px bg-black/10" />
                {Array.from({ length: 8 }).map((__, row) => (
                  <div key={row} className="grid grid-cols-3 gap-1.5">
                    <div className="h-2.5 rounded-full bg-black/8" />
                    <div className="h-2.5 rounded-full bg-black/8" />
                    <div className="h-2.5 rounded-full bg-black/8" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div
          className="absolute z-30 pointer-events-none"
          style={{
            left: 40,
            bottom: 40,
            width: 680,
            opacity: ledgerReveal * map(frame, [180, 205], [1, 0]),
            transform: `translateY(${map(ledgerReveal, [0, 1], [50, 0]) + Math.sin(frame / 18) * 5}px) scale(${map(ledgerReveal, [0, 1], [0.96, 1]) * map(frame, [180, 205], [1, 0.9])})`,
          }}
        >
          <Card className="overflow-hidden px-6 py-6 border-[#7f5ec2]/10 bg-white shadow-2xl">
            <div className="flex items-center justify-between">
              <Micro>normalized ledger</Micro>
              <div className="rounded-full bg-[#7f5ec2] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-white">AI ready</div>
            </div>
            <div className="mt-5 overflow-hidden rounded-[22px] border border-black/8 bg-white/50 backdrop-blur-sm">
              <div className="grid grid-cols-7 border-b border-black/8 bg-black/[0.03] px-4 py-3">
                {launchFilmData.ingestion.ledgerColumns.map((column) => (
                  <p key={column} className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#7f5ec2] font-bold">{column}</p>
                ))}
              </div>
              <div className="space-y-2 px-4 py-4">
                {launchFilmData.ingestion.ledgerRows.map((row, rowIndex) => {
                  const rowReveal = reveal(frame, fps, 138 + rowIndex * 3);
                  return (
                    <div
                      key={row.join("-")}
                      className="grid grid-cols-7 rounded-[18px] border border-black/5 bg-white px-3 py-3 shadow-[0_4px_12px_rgba(0,0,0,0.02)]"
                      style={{
                        opacity: rowReveal,
                        transform: `translateX(${map(rowReveal, [0, 1], [36, 0])}px)`,
                      }}
                    >
                      {row.map((cell) => (
                        <p key={cell} className="truncate font-['Archivo'] text-[13px] text-black/60">{cell}</p>
                      ))}
                    </div>
                  );
                })}
                <div className="grid grid-cols-7 rounded-[18px] border border-[#7f5ec2]/10 bg-[#7f5ec2]/5 px-3 py-3">
                  <p className="font-mono text-[11px] font-bold text-[#7f5ec2]/80 uppercase tracking-widest">+ 4,996 more</p>
                  <div className="col-span-6 flex gap-4">
                    <p className="font-['Archivo'] text-[13px] text-black/40">normalized rows across all territories</p>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </Stage>
  );
}

function AnswerOneScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sourceReveal = reveal(frame, fps, 0);
  const sourceExit = map(frame, [86, 130], [1, 0]);
  const promptOneReveal = reveal(frame, fps, 24);
  const promptOneExit = map(frame, [176, 204], [1, 0]);
  const loadingReveal = reveal(frame, fps, 54);
  const loadingOut = map(frame, [94, 126], [1, 0]);
  const answerReveal = reveal(frame, fps, 98);
  const answerScroll = map(frame, [156, 236], [0, -126]);
  const secondPromptReveal = reveal(frame, fps, 214);
  const secondLoadingReveal = reveal(frame, fps, 246);
  const secondLoadingOut = map(frame, [274, 300], [1, 0]);
  const secondAnswerReveal = reveal(frame, fps, 296);
  const answerExit = map(frame, [290, 320], [1, 0]);

  return (
    <Stage dark>
      <div className="relative h-full px-12 py-10">
        <div className="flex items-start justify-between">
          <LogoBug dark />
          <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-white/65">
            AI workspace
          </div>
        </div>

        <SceneHeader
          eyebrow="Natural Language AI"
          title="ASK YOUR DATA ANYTHING"
          dark
          style="blur"
          exitStart={160}
          titleClassName="text-[140px]"
        />

        <div
          className="absolute left-10 right-10 bottom-10"
          style={{
            top: `${map(frame, [160, 195], [340, 160])}px`, // Dynamic Reflow Lift
          }}
        >
          <div
            className="absolute left-0 top-0 w-[460px]"
            style={{
              opacity: sourceReveal * sourceExit,
              transform: `perspective(2000px) rotateY(${map(sourceReveal, [0, 1], [45, 0])}deg) translateZ(${map(sourceReveal, [0, 1], [-200, 0])}px) translateX(${map(sourceExit, [0, 1], [0, -100])}px)`,
            }}
          >
            <Card dark className="px-5 py-5">
              <div className="flex items-center justify-between">
                <Micro dark>data source</Micro>
                <div className="rounded-full border border-white/10 bg-white/6 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-white/55">
                  normalized ledger
                </div>
              </div>
              <div className="mt-4 overflow-hidden rounded-[20px] border border-white/8 bg-white/5">
                <div className="grid grid-cols-4 border-b border-white/8 px-4 py-3">
                  {["Track", "Territory", "Platform", "Net"].map((column) => (
                    <p key={column} className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/42">{column}</p>
                  ))}
                </div>
                <div className="space-y-2 px-4 py-4">
                  {launchFilmData.ingestion.ledgerRows.slice(0, 3).map((row, index) => (
                    <div key={row.join("-")} className="grid grid-cols-4 rounded-[16px] border border-white/8 bg-black/18 px-3 py-3">
                      <p className="truncate font-['Archivo'] text-[13px] text-white/74">{row[0]}</p>
                      <p className="truncate font-['Archivo'] text-[13px] text-white/74">{row[2]}</p>
                      <p className="truncate font-['Archivo'] text-[13px] text-white/74">{row[3]}</p>
                      <p className="truncate font-['Archivo'] text-[13px] text-white/74">{row[6]}</p>
                    </div>
                  ))}
                </div>
              </div>
              <p className="mt-4 font-['Archivo'] text-[17px] leading-[1.35] text-white/68">
                Ask this ledger any question in natural language.
              </p>
            </Card>
          </div>

          <div className="absolute left-[458px] right-0 top-0">
            <Card
              dark
              className="px-6 py-5"
              style={{
                opacity: promptOneReveal * promptOneExit,
                transform: `perspective(1000px) translateY(${map(promptOneReveal, [0, 1], [24, 0])}px) rotateX(${map(promptOneReveal, [0, 1], [15, 0])}deg) translateX(${map(promptOneExit, [0, 1], [0, 100])}px)`,
                boxShadow: `0 45px 100px rgba(0,0,0,${map(promptOneReveal, [0, 1], [0.1, 0.3])})`,
              }}
            >
              <div className="flex items-center justify-between">
                <Micro dark>question one</Micro>
                <div className="rounded-full border border-white/10 bg-white/6 px-3 py-1">
                  <SendHorizonal className="h-4 w-4 text-[#ffb450]" />
                </div>
              </div>
              <div className="mt-4 rounded-[24px] border border-white/10 bg-gradient-to-br from-white/8 to-white/2 px-5 py-5 overflow-hidden">
                <p className="font-['Archivo'] text-[30px] font-semibold leading-[1.18] text-white">
                  <TypeLine text={launchFilmData.ai.questionOne.prompt} start={24} />
                </p>
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full animate-[shimmer_3s_infinite_1s]" />
              </div>
            </Card>

            <Card
              dark
              className="mt-4 px-6 py-6"
              style={{
                opacity: loadingReveal * loadingOut,
                transform: `translateY(${map(loadingReveal, [0, 1], [24, 0])}px) translateY(${map(loadingOut, [0, 1], [0, -40])}px)`,
              }}
            >
              <div className="flex items-start gap-4">
                <div className="relative flex h-12 w-12 items-center justify-center rounded-[16px] border border-white/10 bg-white/7">
                  <div className="absolute inset-0 animate-[shimmer_2s_infinite] bg-gradient-to-t from-transparent via-white/20 to-transparent -translate-y-full" />
                  <span className="relative font-mono text-[13px] text-white">AI</span>
                </div>
                <div className="flex-1 space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#7f5ec2] animate-pulse" />
                    <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#ffb450]">
                      {launchFilmData.ai.questionOne.loadingLabel}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <div className="relative h-[2px] w-full overflow-hidden bg-white/10">
                      <div className="absolute inset-0 animate-[loading-bar_2.8s_infinite] bg-[#7f5ec2]" />
                    </div>
                    <div className="relative h-[2px] w-2/3 overflow-hidden bg-white/10">
                      <div className="absolute inset-0 animate-[loading-bar_1.9s_infinite_0.4s] bg-[#ffb450]" />
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            <div
              className="mt-4"
              style={{
                opacity: answerReveal * answerExit,
                transform: `translateY(${map(answerReveal, [0, 1], [56, 0])}px) translateY(${answerScroll}px) scale(${map(answerExit, [0, 1], [1, 0.96])})`,
              }}
            >
              <Card dark className="px-6 py-6">
                <div className="space-y-5">
                  <div className="max-w-[880px]">
                    <Micro dark>AI answer</Micro>
                    <h2 className="mt-3 font-['Bebas_Neue'] text-[76px] uppercase leading-[0.92] tracking-[0.04em] text-white">
                      {launchFilmData.ai.questionOne.answerTitle}
                    </h2>
                    <p className="mt-3 font-['Archivo'] text-[22px] leading-[1.4] text-white/78">
                      {launchFilmData.ai.questionOne.answer}
                    </p>
                  </div>

                  <MetricCards items={launchFilmData.ai.questionOne.kpis} dark />

                  <Card
                    dark
                    className="border-[#ffb450]/20 bg-[#ffb450]/10 px-5 py-5 overflow-hidden"
                    style={{
                      transform: `perspective(1000px) rotateY(${map(Math.sin(frame / 30), [-1, 1], [-2, 2])}deg)`,
                    }}
                  >
                    <div className="relative z-10">
                      <div className="flex items-center gap-3">
                        <Sparkles className="h-4 w-4 text-[#ffb450] animate-pulse" />
                        <Micro dark>business strategy</Micro>
                      </div>
                      <p className="mt-3 font-['Archivo'] text-[24px] leading-[1.4] text-white/88">
                        {launchFilmData.ai.questionOne.whyThisMatters}
                      </p>
                    </div>
                  </Card>

                  <div className="grid grid-cols-[1.02fr_0.98fr] gap-4">
                    <Card dark className="px-5 py-5">
                      <div className="flex items-center justify-between">
                        <Micro dark>evidence chart</Micro>
                        <BarChart3 className="h-4 w-4 text-[#7f5ec2]" />
                      </div>
                      <div className="mt-5 space-y-4">
                        {launchFilmData.ai.questionOne.chartBars.map((item, index) => {
                          const barReveal = reveal(frame, fps, 188 + index * 5);
                          return (
                            <div key={item.label} className="space-y-2">
                              <div className="flex items-center justify-between">
                                <p className="font-['Archivo'] text-[16px] text-white/75">{item.label}</p>
                                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/45">
                                  {item.usage}% / {item.payout}%
                                </p>
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <div className="h-3 rounded-full bg-white/10 overflow-hidden">
                                  <div className="h-3 rounded-full bg-[#7f5ec2] shadow-[0_0_12px_rgba(127,94,194,0.4)] transition-all" style={{ width: `${item.usage * barReveal}%` }} />
                                </div>
                                <div className="h-3 rounded-full bg-white/10 overflow-hidden">
                                  <div className="h-3 rounded-full bg-[#ffb450] shadow-[0_0_12px_rgba(255,180,80,0.4)] transition-all" style={{ width: `${item.payout * barReveal}%` }} />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </Card>

                    <Card dark className="px-5 py-5">
                      <div className="flex items-center justify-between">
                        <Micro dark>query result</Micro>
                        <div className="rounded-full border border-white/10 bg-white/6 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-white/55">
                          4 rows
                        </div>
                      </div>
                      <div className="mt-5 overflow-hidden rounded-[20px] border border-white/8 bg-white/5">
                        <div className="grid grid-cols-4 border-b border-white/8 px-4 py-3">
                          {launchFilmData.ai.questionOne.tableColumns.map((column) => (
                            <p key={column} className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/42">{column.replace(/_/g, " ")}</p>
                          ))}
                        </div>
                        <div className="space-y-2 px-4 py-4">
                          {launchFilmData.ai.questionOne.tableRows.map((row, rowIndex) => {
                            const rowReveal = reveal(frame, fps, 204 + rowIndex * 5);
                            return (
                              <div
                                key={row.join("-")}
                                className="grid grid-cols-4 rounded-[16px] border border-white/8 bg-black/20 px-3 py-3"
                                style={{
                                  opacity: rowReveal,
                                  transform: `translateX(${map(rowReveal, [0, 1], [24, 0])}px)`,
                                }}
                              >
                                {row.map((cell) => (
                                  <p key={cell} className="font-['Archivo'] text-[13px] text-white/75">{cell}</p>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </Card>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {launchFilmData.ai.questionOne.evidence.map((item, index) => {
                      const chipReveal = reveal(frame, fps, 220 + index * 3);
                      return (
                        <div
                          key={item}
                          className="rounded-full border border-white/10 bg-white/6 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/56"
                          style={{
                            opacity: chipReveal,
                            transform: `translateY(${map(chipReveal, [0, 1], [16, 0])}px)`,
                          }}
                        >
                          {item}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Card>
            </div>

            <div
              className="absolute left-0 right-0 top-0"
              style={{
                opacity: secondPromptReveal,
                transform: `translateY(${map(secondPromptReveal, [0, 1], [22, 0])}px)`,
              }}
            >
              <Card dark className="px-6 py-5">
                <div className="flex items-center justify-between">
                  <Micro dark>question two</Micro>
                  <div className="rounded-full border border-white/10 bg-white/6 px-3 py-1">
                    <SendHorizonal className="h-4 w-4 text-[#ffb450]" />
                  </div>
                </div>
                <p className="mt-4 font-['Archivo'] text-[28px] font-semibold leading-[1.2] text-white">
                  {launchFilmData.ai.questionQuick.prompt}
                </p>
              </Card>
            </div>

            <div
              className="absolute left-0 right-0 top-[118px]"
              style={{
                opacity: secondLoadingReveal * secondLoadingOut,
                transform: `translateY(${map(secondLoadingReveal, [0, 1], [24, 0])}px)`,
              }}
            >
              <Card dark className="px-6 py-6">
                <div className="flex items-start gap-4">
                  <div className="relative flex h-12 w-12 items-center justify-center rounded-[16px] border border-white/10 bg-white/7">
                    <div className="absolute inset-0 animate-[shimmer_2s_infinite] bg-gradient-to-t from-transparent via-white/20 to-transparent -translate-y-full" />
                    <span className="relative font-mono text-[13px] text-white">AI</span>
                  </div>
                  <div className="flex-1 space-y-4">
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#7f5ec2] animate-pulse" />
                      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#ffb450]">
                        {launchFilmData.ai.questionOne.loadingLabel}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <div className="relative h-[2px] w-full overflow-hidden bg-white/10">
                        <div className="absolute inset-0 animate-[loading-bar_2.8s_infinite] bg-[#7f5ec2]" />
                      </div>
                      <div className="relative h-[2px] w-2/3 overflow-hidden bg-white/10">
                        <div className="absolute inset-0 animate-[loading-bar_1.9s_infinite_0.4s] bg-[#ffb450]" />
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            </div>

            <div
              className="absolute left-0 right-0 top-[118px]"
              style={{
                opacity: secondAnswerReveal,
                transform: `translateY(${map(secondAnswerReveal, [0, 1], [42, 0])}px)`,
              }}
            >
              <div className="grid grid-cols-[0.52fr_0.48fr] gap-4">
                <Card dark className="px-5 py-5">
                  <div className="max-w-[680px]">
                    <Micro dark>AI answer</Micro>
                    <h3 className="mt-3 font-['Bebas_Neue'] text-[54px] uppercase leading-[0.94] tracking-[0.04em] text-white">
                      {launchFilmData.ai.questionQuick.answerTitle}
                    </h3>
                    <p className="mt-3 font-['Archivo'] text-[19px] leading-[1.38] text-white/76">
                      {launchFilmData.ai.questionQuick.answer}
                    </p>
                  </div>
                  <div className="mt-4">
                    <MetricCards items={launchFilmData.ai.questionQuick.kpis} dark />
                  </div>
                </Card>

                <Card dark className="px-5 py-5">
                  <div className="flex items-center justify-between">
                    <Micro dark>bar chart</Micro>
                    <BarChart3 className="h-4 w-4 text-[#7f5ec2]" />
                  </div>
                  <div className="mt-5 space-y-4">
                    {launchFilmData.ai.questionQuick.chartBars.map((item, index) => {
                      const barReveal = reveal(frame, fps, 232 + index * 4);
                      return (
                        <div key={item.label} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="font-['Archivo'] text-[16px] text-white/75">{item.label}</p>
                            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/45">{item.value}</p>
                          </div>
                          <div className="h-3 rounded-full bg-white/10">
                            <div className="h-3 rounded-full bg-[linear-gradient(90deg,#7f5ec2,#ffb450)]" style={{ width: `${item.value * barReveal}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>
              <Card dark className="mt-4 px-5 py-5">
                <div className="flex items-center justify-between">
                  <Micro dark>table evidence</Micro>
                  <div className="rounded-full border border-white/10 bg-white/6 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-white/55">
                    3 rows
                  </div>
                </div>
                <div className="mt-5 overflow-hidden rounded-[20px] border border-white/8 bg-white/5">
                  <div className="grid grid-cols-4 border-b border-white/8 px-4 py-3">
                    {launchFilmData.ai.questionQuick.tableColumns.map((column) => (
                      <p key={column} className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/42">
                        {column.replace(/_/g, " ")}
                      </p>
                    ))}
                  </div>
                  <div className="space-y-2 px-4 py-4">
                    {launchFilmData.ai.questionQuick.tableRows.map((row, rowIndex) => {
                      const rowReveal = reveal(frame, fps, 310 + rowIndex * 4);
                      return (
                        <div
                          key={row.join("-")}
                          className="grid grid-cols-4 rounded-[16px] border border-white/8 bg-black/20 px-3 py-3"
                          style={{
                            opacity: rowReveal,
                            transform: `translateX(${map(rowReveal, [0, 1], [18, 0])}px)`,
                          }}
                        >
                          {row.map((cell) => (
                            <p key={cell} className="font-['Archivo'] text-[13px] text-white/75">{cell}</p>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </Stage>
  );
}

function AnswerTwoScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <Stage>
      <div className="relative h-full px-12 py-10">
        <div className="flex items-start justify-between">
          <LogoBug />
          <div className="rounded-full border border-black/10 bg-white/70 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-black/60">
            portfolio scope
          </div>
        </div>

        <SceneHeader
          eyebrow="Strategic Insights"
          title="SEE THE NEXT MOVE"
          exitStart={140}
          style="drift"
          titleClassName="text-[130px]"
        />

        <div
          className="absolute left-10 right-10 bottom-10 h-[600px] grid grid-cols-[0.45fr_0.55fr] gap-12"
          style={{
            top: `${map(frame, [140, 175], [320, 160])}px`, // Reflow Lift
          }}
        >
          <div className="flex flex-col gap-6">
            <div
              className="rounded-[22px] border-l-[6px] border-[#7f5ec2] bg-white/80 p-6 shadow-sm"
              style={{
                opacity: reveal(frame, fps, 0),
                transform: `translateX(${map(reveal(frame, fps, 0), [0, 1], [-40, 0])}px)`,
              }}
            >
              <Micro>query</Micro>
              <p className="mt-4 font-['Archivo'] text-[26px] font-bold leading-tight text-black/90">
                {launchFilmData.ai.questionTwo.prompt}
              </p>
            </div>

            <Card
              className="flex-1 bg-gradient-to-br from-[#0c0c10] to-[#1a1825] p-8 text-white border-white/10 shadow-[0_60px_100px_rgba(0,0,0,0.6)] overflow-hidden"
              style={{
                opacity: reveal(frame, fps, 20),
                transform: `scale(${map(reveal(frame, fps, 20), [0, 1], [0.95, 1])}) translateY(${map(reveal(frame, fps, 20), [0, 1], [40, 0])}px)`,
              }}
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,#7f5ec222_0%,transparent_50%)]" />
              <div className="relative z-10">
                <Micro dark>AI intelligence</Micro>
                <h2 className="mt-6 font-['Bebas_Neue'] text-[64px] uppercase leading-none tracking-tight text-white">
                  {launchFilmData.ai.questionTwo.answerTitle}
                </h2>
                <p className="mt-6 font-['Archivo'] text-[20px] leading-relaxed text-white/85">
                  {launchFilmData.ai.questionTwo.answer}
                </p>

                <div className="mt-8 grid grid-cols-2 gap-4">
                  {launchFilmData.ai.questionTwo.kpis.map((item, index) => (
                    <div key={item.label} className="border-t border-white/10 pt-4">
                      <p className="font-mono text-[9px] uppercase tracking-widest text-white/45">{item.label}</p>
                      <p className="mt-1 text-[22px] font-bold text-[#7f5ec2]">{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            {launchFilmData.ai.questionTwo.kpis.map((item, index) => {
              const metricReveal = reveal(frame, fps, 26 + index * 5);
              const isLead = item.label.toLowerCase().includes("lead");
              const isTrend = item.label.toLowerCase().includes("trend");

              return (
                <Card
                  key={item.label}
                  className="relative overflow-hidden rounded-[26px] bg-white border-[#7f5ec2]/15 px-6 py-6 shadow-[0_20px_50px_rgba(0,0,0,0.04)]"
                  style={{
                    opacity: metricReveal,
                    transform: `translateY(${map(metricReveal, [0, 1], [30, 0])}px) scale(${map(metricReveal, [0, 1], [0.95, 1])})`,
                  }}
                >
                  <div className="relative z-10 flex flex-col h-full justify-between">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#7f5ec2] font-bold">
                        {item.label}
                      </p>
                      <div className={`h-2 w-2 rounded-full bg-[#7f5ec2] animate-pulse`} />
                    </div>
                    <div className="mt-6">
                      <p className="font-['Archivo'] text-[28px] font-bold text-black opacity-90 tracking-tight">
                        {item.value}
                      </p>
                      {isTrend && (
                        <div className="mt-2 flex items-center gap-1.5">
                          <div className="h-1 w-12 rounded-full bg-[#7f5ec2]/20 overflow-hidden">
                            <div className="h-full bg-[#7f5ec2]" style={{ width: '70%' }} />
                          </div>
                          <span className="font-mono text-[9px] text-[#7f5ec2] font-bold uppercase tracking-widest">Accelerating</span>
                        </div>
                      )}
                      {!isTrend && (
                        <div className="mt-2 h-1 w-8 rounded-full bg-[#7f5ec2]/10" />
                      )}
                    </div>
                  </div>
                  <div className="absolute -bottom-8 -right-8 h-24 w-24 rounded-full bg-[#7f5ec2]/5 blur-2xl" />
                </Card>
              );
            })}
          </div>

          <Card className="mt-4 px-5 py-5 overflow-hidden">
            <div className="relative z-10 flex items-center justify-between">
              <Micro>data evidence</Micro>
              <Sparkles className="h-4 w-4 text-[#7f5ec2] animate-pulse" />
            </div>
            <div className="mt-4 grid gap-3 relative z-10">
              {launchFilmData.ai.questionTwo.evidence.map((item, index) => {
                const itemReveal = reveal(frame, fps, 40 + index * 4);
                return (
                  <div
                    key={item}
                    className={`rounded-[18px] border px-4 py-3 shadow-sm ${index % 2 === 0 ? "border-[#7f5ec2]/22 bg-[#f2ecfb]" : "border-black/8 bg-white/78"}`}
                    style={{
                      opacity: itemReveal,
                      transform: `translateX(${map(itemReveal, [0, 1], [24, 0])}px) perspective(1000px) rotateY(${map(itemReveal, [0, 1], [10, 0])}deg)`,
                    }}
                  >
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-black/58">{item}</p>
                  </div>
                );
              })}
            </div>
            <div className="absolute top-0 right-0 w-32 h-32 bg-[#7f5ec2]/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2" />
          </Card>

          <div className="grid grid-rows-[0.72fr_0.28fr] gap-6">
            <Card className="px-6 py-6 border-[#7f5ec2]/10">
              <div className="flex items-center justify-between">
                <div>
                  <Micro>artist priority</Micro>
                  <p className="mt-2 font-['Archivo'] text-[24px] font-bold text-[#111111]/90">Market Sentiment</p>
                </div>
                <div className="h-10 w-10 flex items-center justify-center rounded-full bg-[#7f5ec2]/5 border border-[#7f5ec2]/10">
                  <Sparkles className="h-5 w-5 text-[#7f5ec2]" />
                </div>
              </div>
              <div className="mt-8 space-y-5">
                {launchFilmData.ai.questionTwo.artistBars.map((item, index) => {
                  const barReveal = reveal(frame, fps, index * 6);
                  return (
                    <div key={item.label} className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <p className="font-['Archivo'] text-[18px] font-bold text-black/80">{item.label}</p>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] font-bold text-[#7f5ec2] bg-[#7f5ec2]/5 px-2 py-0.5 rounded-full">{item.value}%</span>
                        </div>
                      </div>
                      <div className="h-3 rounded-full bg-black/[0.04] overflow-hidden">
                        <div className="h-full rounded-full bg-[#7f5ec2] shadow-[0_0_15px_rgba(127,94,194,0.3)]" style={{ width: `${item.value * barReveal}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card className="overflow-hidden px-5 py-5">
              <Micro>strategy</Micro>
              <p className="mt-3 font-['Archivo'] text-[18px] leading-[1.42] text-black/70">
                {launchFilmData.ai.questionTwo.whyThisMatters}
              </p>
            </Card>
          </div>
        </div>
      </div>
    </Stage>
  );
}

function ReviewScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const intro = reveal(frame, fps, 0, SPRINGS.overshoot);
  const exit = map(frame, [88, 120], [1, 0]);

  return (
    <Stage dark>
      <div className="relative h-full px-12 py-10">
        <div className="flex items-start justify-between">
          <LogoBug dark />
          <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-white/50">
            audit trails
          </div>
        </div>

        <SceneHeader
          eyebrow="Full Transparency"
          title="VERIFY EVERY CLAIM"
          dark
          style="split"
          exitStart={100}
          titleClassName="text-[140px]"
        />

        <div className="absolute left-1/2 top-[58%] -translate-x-1/2 -translate-y-1/2 perspective-[2000px]">
          <Card
            dark
            className="w-[840px] overflow-hidden p-10 border-white/5 shadow-[0_80px_160px_rgba(0,0,0,0.6)]"
            style={{
              opacity: intro * exit,
              transform: `rotateX(${map(intro, [0, 1], [20, 0])}deg) translateZ(${map(intro, [0, 1], [-300, 0])}px) translateY(${map(frame, [100, 130], [0, -100])}px) scale(${map(exit, [0, 1], [1, 0.9])})`,
            }}
          >
            <div className="relative z-10">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#7f5ec2] text-white">
                  <Sparkles className="h-5 w-5" />
                </div>
                <Micro dark>{launchFilmData.review.title}</Micro>
              </div>
              <h3 className="mt-6 font-['Archivo'] text-[32px] font-bold leading-tight text-white">
                {launchFilmData.review.body}
              </h3>

              <div className="mt-8 space-y-3">
                {launchFilmData.review.evidence.map((item, index) => {
                  const itemReveal = reveal(frame, fps, 35 + index * 5);
                  return (
                    <div
                      key={item}
                      className="flex items-center gap-4 rounded-[18px] border border-white/10 bg-white/5 px-4 py-3"
                      style={{
                        opacity: itemReveal,
                        transform: `translateX(${map(itemReveal, [0, 1], [-20, 0])}px)`,
                      }}
                    >
                      <div className="h-1.5 w-1.5 rounded-full bg-[#7f5ec2]" />
                      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/70">{item}</p>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="absolute -bottom-24 -right-24 h-64 w-64 rounded-full bg-[#7f5ec2]/10 blur-[80px]" />
          </Card>
        </div>
      </div>
    </Stage>
  );
}

function TransactionsScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tableReveal = reveal(frame, fps, 10);
  const detailReveal = reveal(frame, fps, 36);

  return (
    <Stage>
      <div className="relative h-full px-12 py-10">
        <div className="flex items-start justify-between">
          <LogoBug />
          <div className="rounded-full border border-black/10 bg-white/70 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-black/60">
            transactions
          </div>
        </div>

        <div className="absolute left-12 top-28 z-20">
          <div className="flex items-center gap-3">
            <div className="h-1.5 w-8 bg-[#7f5ec2]" />
            <Micro>Deep Verification</Micro>
          </div>
          <h1 className="mt-6 font-['Bebas_Neue'] text-[124px] uppercase leading-[0.8] tracking-tighter text-[#111111]">
            TRACE EVERY <span className="text-[#7f5ec2]">LINE.</span>
          </h1>
        </div>

        <div
          className="absolute left-10 right-10 bottom-10 grid grid-cols-[1.6fr_1fr] gap-8"
          style={{
            top: `${map(frame, [110, 145], [320, 160])}px`, // Reflow Lift
          }}
        >
          <Card
            className="overflow-hidden border-black/5 bg-white/80 shadow-2xl"
            style={{
              opacity: tableReveal * map(frame, [160, 190], [1, 0]),
              transform: `translateY(${map(tableReveal, [0, 1], [60, 0])}px) rotateX(${map(tableReveal, [0, 1], [10, 0])}deg) scale(${map(frame, [160, 190], [1, 0.9])})`
            }}
          >
            <div className="mt-5 overflow-hidden rounded-[20px] border border-black/8 bg-[#faf6ee]">
              <div className="grid grid-cols-5 border-b border-black/8 bg-white px-4 py-4">
                {["Track", "Territory", "Platform", "Net", "Status"].map((column) => (
                  <p key={column} className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#7f5ec2] font-bold">{column}</p>
                ))}
              </div>
              <div className="space-y-2 px-4 py-5">
                {launchFilmData.transactions.rows.map((row, index) => {
                  const rowReveal = reveal(frame, fps, 18 + index * 5);
                  const rowOut = map(frame, [145 + index * 4, 165 + index * 4], [1, 0]);
                  const status = row[4];
                  const isReview = status === "Review";

                  return (
                    <div
                      key={row.join("-")}
                      className="grid grid-cols-5 items-center rounded-[16px] border border-black/5 bg-white px-3 py-3 shadow-[0_4px_10px_rgba(0,0,0,0.02)]"
                      style={{
                        opacity: rowReveal * rowOut,
                        transform: `translateX(${map(rowReveal, [0, 1], [18, 0])}px) scale(${map(rowOut, [0, 1], [0.94, 1])})`
                      }}
                    >
                      {row.slice(0, 4).map((cell, i) => (
                        <p key={cell} className={`truncate font-['Archivo'] text-[13px] ${i === 3 ? "font-bold text-[#111111]" : "text-black/60"}`}>{cell}</p>
                      ))}
                      <div>
                        <span className={`inline-block px-2 py-0.5 rounded-full font-mono text-[9px] font-bold ${isReview ? "bg-[#7f5ec2]/15 text-[#7f5ec2]" : "bg-[#7f5ec2]/10 text-[#7f5ec2]"}`}>
                          {status}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="absolute -bottom-12 -right-12 h-40 w-40 rounded-full bg-[#7f5ec2]/5 blur-3xl animate-pulse" />
          </Card>

          <Card
            className="px-6 py-6"
            style={{
              opacity: detailReveal * map(frame, [155, 185], [1, 0]),
              transform: `translateX(${map(detailReveal, [0, 1], [54, 0]) + map(frame, [155, 185], [0, 100])}px)`
            }}
          >
            <Micro>transaction detail</Micro>
            <div className="mt-5 grid gap-3">
              {[
                ["ISRC", launchFilmData.transactions.detail.isrc],
                ["Territory", launchFilmData.transactions.detail.territory],
                ["Platform", launchFilmData.transactions.detail.platform],
                ["Net", launchFilmData.transactions.detail.net],
                ["Source", launchFilmData.transactions.detail.source],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[18px] border border-black/8 bg-white/78 px-4 py-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-black/42">{label}</p>
                  <p className="mt-2 font-['Archivo'] text-[20px] font-semibold text-black/78">{value}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </Stage>
  );
}

function SnapshotScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const intro = reveal(frame, fps, 0, SPRINGS.overshoot);

  const scoreValue = parseFloat(launchFilmData.snapshot.opportunityScore);
  const scoreDisplay = map(reveal(frame, fps, 45, SPRINGS.smooth), [0, 1], [0, scoreValue]).toFixed(1);

  return (
    <Stage>
      <div className="relative h-full px-12 py-10">
        <div className="flex items-start justify-between">
          <LogoBug />
          <div className="flex gap-3">
            <CountChip icon={SearchCheck} label="Track snapshot" />
            <CountChip icon={Download} label="Export bundle" />
          </div>
        </div>

        <SceneHeader
          eyebrow="The Export"
          title="EXPORT THE INSIGHTS"
          style="drift"
          exitStart={140}
          titleClassName="text-[110px]"
        />

        <div
          className="absolute left-10 right-10 bottom-10 grid grid-cols-[0.9fr_1.1fr] gap-12"
          style={{
            top: `${map(frame, [140, 175], [300, 160])}px`, // Reflow Lift
          }}
        >
          <div
            className="flex flex-col justify-center"
            style={{
              opacity: intro * map(frame, [180, 210], [1, 0]),
              transform: `translateX(${map(intro, [0, 1], [-60, 0])}px) scale(${map(frame, [180, 210], [1, 0.9])})`,
            }}
          >
            <div className="relative inline-block">
              <div className="absolute -inset-12 bg-[#7f5ec2]/15 blur-[60px] animate-pulse rounded-full" />
              <div className="relative h-[280px] w-[280px] overflow-hidden rounded-[20px] border border-black/5 bg-white shadow-[0_40px_100px_rgba(0,0,0,0.12)]">
                <div className="absolute inset-x-0 top-0 h-[100px] bg-gradient-to-b from-black/5 to-transparent" />
                <div className="flex h-full w-full items-center justify-center">
                  <Sparkles className="h-40 w-40 text-[#7f5ec2]/15" />
                </div>
              </div>
            </div>
            <div className="mt-12">
              <h2 className="font-['Bebas_Neue'] text-[120px] uppercase leading-[0.75] tracking-tight text-[#111111]">
                {launchFilmData.snapshot.track}
              </h2>
              <p className="mt-6 font-mono text-[14px] uppercase tracking-[0.4em] text-black/40">{launchFilmData.snapshot.artist}</p>
            </div>

            <div
              className="mt-12 border-t border-black/5 pt-8"
              style={{
                opacity: reveal(frame, fps, 30),
                transform: `translateY(${map(reveal(frame, fps, 30), [0, 1], [30, 0])}px)`,
              }}
            >
              <Micro>Opportunity Score</Micro>
              <div className="mt-6 flex items-baseline gap-4 text-[#7f5ec2]">
                <span className="font-['Bebas_Neue'] text-[180px] leading-[0.7] tracking-tighter drop-shadow-2xl">{scoreDisplay}</span>
                <span className="font-mono text-[20px] tracking-widest text-[#7f5ec2]/40">POINTS</span>
              </div>
            </div>
          </div>

          <div className="space-y-6 flex flex-col justify-center">
            <div className="grid grid-cols-2 gap-4">
              {launchFilmData.snapshot.kpis.map((item, index) => {
                const kpiReveal = reveal(frame, fps, 50 + index * 5);
                const kpiExit = map(frame, [160 + index * 5, 190 + index * 5], [1, 0]);
                return (
                  <Card
                    key={item.label}
                    className="p-6 bg-white/90 shadow-lg"
                    style={{
                      opacity: kpiReveal * kpiExit,
                      transform: `translateY(${map(kpiReveal, [0, 1], [30, 0])}px) perspective(1000px) rotateX(${map(kpiReveal, [0, 1], [10, 0])}deg) scale(${map(kpiExit, [0, 1], [0.94, 1])})`,
                    }}
                  >
                    <Micro>{item.label}</Micro>
                    <p className="mt-2 text-[32px] font-bold text-[#111111]">{item.value}</p>
                  </Card>
                );
              })}
            </div>

            <div className="space-y-4">
              {launchFilmData.snapshot.signals.map((signal, index) => {
                const signalReveal = reveal(frame, fps, 80 + index * 6);
                const signalExit = map(frame, [170 + index * 4, 195 + index * 4], [1, 0]);
                const isWarning = signal.tone === "warning";
                const isOpportunity = signal.tone === "opportunity";

                return (
                  <Card
                    key={signal.title}
                    className={`p-6 border-l-[8px] shadow-sm ${isWarning ? "border-[#7f5ec2]/40" : isOpportunity ? "border-[#7f5ec2]" : "border-black/10"}`}
                    style={{
                      opacity: signalReveal * signalExit,
                      transform: `translateX(${map(signalReveal, [0, 1], [50, 0])}px) scale(${map(signalExit, [0, 1], [0.96, 1])})`,
                    }}
                  >
                    <div className="flex items-center gap-3">
                      {isWarning ? <Sparkles className="h-4 w-4 text-[#7f5ec2] animate-pulse" /> : <SearchCheck className="h-4 w-4 text-[#7f5ec2]" />}
                      <Micro>{signal.title}</Micro>
                    </div>
                    <p className="mt-3 text-[18px] leading-relaxed text-black/70">{signal.body}</p>
                  </Card>
                );
              })}
            </div>

            <Card
              className="mt-4 flex items-center justify-between p-6 bg-[#111111] text-white border-none shadow-[0_40px_80px_rgba(0,0,0,0.3)]"
              style={{
                opacity: reveal(frame, fps, 110) * map(frame, [185, 215], [1, 0]),
                transform: `translateY(${map(reveal(frame, fps, 110), [0, 1], [20, 0])}px) scale(${map(frame, [185, 215], [1, 0.9])})`,
              }}
            >
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-full bg-white/10 flex items-center justify-center">
                  <Download className="h-6 w-6 text-[#7f5ec2]" />
                </div>
                <div>
                  <Micro dark>Download Bundle</Micro>
                  <p className="text-xl font-semibold">Publisher Snapshot.pdf</p>
                </div>
              </div>
              <div className="rounded-full bg-[#7f5ec2] px-4 py-2 font-mono text-[11px] uppercase tracking-widest">Ready</div>
            </Card>
          </div>
        </div>
      </div>
    </Stage>
  );
}

function EndCardScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const intro = reveal(frame, fps, 10, SPRINGS.overshoot);
  const glowPulse = map(Math.sin(frame / 20), [-1, 1], [0.8, 1.1]);

  return (
    <Stage dark>
      <div className="relative flex h-full flex-col items-center justify-center text-center">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,#7f5ec222_0%,transparent_60%)] opacity-50" />

        <div
          style={{
            opacity: intro,
            transform: `scale(${map(intro, [0, 1], [0.8, 1])}) translateY(${map(intro, [0, 1], [40, 0])}px)`,
          }}
        >
          <div className="relative">
            <div className="absolute inset-0 blur-[100px] bg-[#7f5ec2]/30 rounded-full scale-[1.5]" style={{ opacity: glowPulse }} />
            <div className="relative rounded-[12px] border border-white/5 bg-black/60 backdrop-blur-3xl px-24 py-16 shadow-[0_100px_200px_rgba(0,0,0,0.8)]">
              <Img src={staticFile(launchFilmData.brand.logoSrc.replace(/^\//, ""))} className="h-44 w-auto grayscale invert" />
              <div className="absolute -bottom-px left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#7f5ec2]/50 to-transparent" />
            </div>
          </div>
        </div>

        <div
          className="mt-20 max-w-[1000px]"
          style={{
            opacity: reveal(frame, fps, 50),
            transform: `translateY(${map(reveal(frame, fps, 50), [0, 1], [20, 0])}px)`
          }}
        >
          <h1 className="font-['Bebas_Neue'] text-[64px] uppercase tracking-[0.15em] text-white opacity-90">
            {launchFilmData.brand.tagline}
          </h1>
          <div className="mt-10 flex justify-center items-center gap-12">
            {["Bespoke Ledgering", "AI Strategy", "Global Auditing"].map((feat, i) => (
              <div key={feat} className="flex items-center gap-4">
                <div className="h-px w-8 bg-white/20" />
                <span className="font-mono text-[10px] uppercase tracking-[0.4em] text-white/40">{feat}</span>
              </div>
            ))}
            <div className="h-px w-8 bg-white/20" />
          </div>
        </div>
      </div>
    </Stage>
  );
}

export function LaunchFilmComposition() {
  return (
    <AbsoluteFill>
      <Sequence from={animationBeats[0].startFrame} durationInFrames={animationBeats[0].endFrame - animationBeats[0].startFrame + 1}>
        <IngestionScene />
      </Sequence>
      <Sequence from={animationBeats[1].startFrame} durationInFrames={animationBeats[1].endFrame - animationBeats[1].startFrame + 1}>
        <AnswerOneScene />
      </Sequence>
      <Sequence from={animationBeats[2].startFrame} durationInFrames={animationBeats[2].endFrame - animationBeats[2].startFrame + 1}>
        <AnswerTwoScene />
      </Sequence>
      <Sequence from={animationBeats[3].startFrame} durationInFrames={animationBeats[3].endFrame - animationBeats[3].startFrame + 1}>
        <ReviewScene />
      </Sequence>
      <Sequence from={animationBeats[4].startFrame} durationInFrames={animationBeats[4].endFrame - animationBeats[4].startFrame + 1}>
        <TransactionsScene />
      </Sequence>
      <Sequence from={animationBeats[5].startFrame} durationInFrames={animationBeats[5].endFrame - animationBeats[5].startFrame + 1}>
        <SnapshotScene />
      </Sequence>
      <Sequence from={animationBeats[6].startFrame} durationInFrames={animationBeats[6].endFrame - animationBeats[6].startFrame + 1}>
        <EndCardScene />
      </Sequence>
    </AbsoluteFill>
  );
}
