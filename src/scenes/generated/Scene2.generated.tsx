import React, {useMemo} from 'react';
import {
	AbsoluteFill,
	Easing,
	interpolate,
	spring,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion';
import type {SceneAsset, SegmentCue, WordCue} from '../../types';
import {useSceneProgress} from '../../hooks/useSceneProgress';

const FONT =
	'"思源黑体", "HarmonyOS Sans", "阿里巴巴普惠体", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

const clampInterpolate = (
	frame: number,
	input: number[],
	output: number[],
	easing?: (input: number) => number
) =>
	interpolate(frame, input, output, {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
		easing,
	});

const safeEndFrame = (start: number, preferredEnd: number, durationInFrames: number) =>
	Math.max(start + 1, Math.min(durationInFrames, preferredEnd));

const wordFrame = (cues: SegmentCue[], match: string, fallback: number): number => {
	const found = cues
		.flatMap((cue) => cue.words)
		.find((word) => word.text.includes(match));
	return found?.startFrame ?? fallback;
};

const activeCueAt = (cues: SegmentCue[], frame: number) =>
	cues.find((cue) => frame >= cue.startFrame && frame < cue.endFrame);

const phraseFromCue = (cues: SegmentCue[], id: string, fallback = '') =>
	cues.find((cue) => cue.id === id)?.text ?? fallback;

const pulseAt = (frame: number, start: number, duration = 12, strength = 0.08) => {
	const p = clampInterpolate(frame, [start, start + duration / 2, start + duration], [0, 1, 0]);
	return 1 + p * strength;
};

const shakeAt = (frame: number, start: number, duration = 12, amount = 10) => {
	if (frame < start || frame > start + duration) return 0;
	return Math.sin((frame - start) * 2.7) * amount;
};

const TechBackground: React.FC<{
	durationInFrames: number;
	cues: SegmentCue[];
}> = ({durationInFrames, cues}) => {
	const frame = useCurrentFrame();
	const {width, height} = useVideoConfig();
	const gridOpacity = clampInterpolate(frame, [0, 84], [0, 0.3]);
	const chaos = clampInterpolate(frame, [294, 308, 476, 602, 700, 868], [0.2, 1, 0.35, 0.85, 0.25, 0.05]);
	const finalBlue = clampInterpolate(frame, [868, 966], [0, 1]);

	const cueEnergy = cues.reduce((acc, cue, index) => {
		if (frame >= cue.startFrame && frame < cue.endFrame) {
			return acc + (index + 1) / Math.max(1, cues.length);
		}
		return acc;
	}, 0);

	const particles = useMemo(
		() =>
			Array.from({length: 70}, (_, i) => ({
				x: ((i * 137) % 1000) / 1000,
				y: ((i * 269 + 91) % 1000) / 1000,
				r: 1 + ((i * 17) % 4),
				speed: 0.15 + ((i * 19) % 40) / 100,
				phase: i * 0.83,
			})),
		[]
	);

	const nodes = useMemo(
		() =>
			Array.from({length: 12}, (_, i) => ({
				x: 0.12 + (((i * 197) % 760) / 1000),
				y: 0.12 + (((i * 311) % 680) / 1000),
			})),
		[]
	);

	return (
		<AbsoluteFill
			style={{
				background:
					'radial-gradient(circle at 50% 35%, #101B2E 0%, #080B12 42%, #05070B 100%)',
				overflow: 'hidden',
				fontFamily: FONT,
			}}
		>
			<div
				style={{
					position: 'absolute',
					inset: 0,
					opacity: gridOpacity,
					backgroundImage:
						'linear-gradient(rgba(80, 140, 255, 0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(80, 140, 255, 0.12) 1px, transparent 1px)',
					backgroundSize: `${Math.max(42, width * 0.045)}px ${Math.max(42, width * 0.045)}px`,
					transform: `translateY(${clampInterpolate(frame, [0, 84], [30, 0])}px) scale(${1 + finalBlue * 0.02})`,
				}}
			/>
			<svg
				width={width}
				height={height}
				style={{
					position: 'absolute',
					inset: 0,
					opacity: 0.4 + finalBlue * 0.2,
				}}
			>
				{nodes.map((n, i) => {
					const next = nodes[(i + (frame < 602 ? 3 : 5)) % nodes.length];
					const crossed = frame >= 602 && frame < 700;
					const x1 = n.x * width + Math.sin(frame * 0.012 + i) * 18;
					const y1 = n.y * height + Math.cos(frame * 0.01 + i) * 12;
					const x2 = (crossed ? 1 - next.x : next.x) * width;
					const y2 = next.y * height;
					return (
						<line
							key={`line-${i}`}
							x1={x1}
							y1={y1}
							x2={x2}
							y2={y2}
							stroke={crossed ? 'rgba(255,77,79,0.28)' : 'rgba(34,211,238,0.18)'}
							strokeWidth={1}
							strokeDasharray="8 14"
							strokeDashoffset={-frame * 0.8}
						/>
					);
				})}
				{nodes.map((n, i) => (
					<circle
						key={`node-${i}`}
						cx={n.x * width + Math.sin(frame * 0.016 + i) * 10}
						cy={n.y * height + Math.cos(frame * 0.013 + i) * 10}
						r={3 + Math.sin(frame * 0.04 + i) * 1.5}
						fill={i % 3 === 0 ? '#22D3EE' : '#3B82F6'}
						opacity={0.28}
					/>
				))}
			</svg>
			{particles.map((p, i) => {
				const noiseBoost = frame >= 294 && frame < 308 ? 1.5 : 1;
				const x = (p.x * width + Math.sin(frame * 0.02 * p.speed + p.phase) * width * 0.035) % width;
				const y = (p.y * height + frame * p.speed * (0.2 + chaos) + Math.cos(frame * 0.015 + p.phase) * 18) % height;
				return (
					<div
						key={i}
						style={{
							position: 'absolute',
							left: x,
							top: y,
							width: p.r,
							height: p.r,
							borderRadius: '50%',
							background: 'rgba(255,255,255,0.18)',
							opacity: (0.15 + chaos * 0.45 + cueEnergy * 0.12) * noiseBoost,
							boxShadow: '0 0 10px rgba(59,130,246,0.25)',
						}}
					/>
				);
			})}
		</AbsoluteFill>
	);
};

const GlassCard: React.FC<{
	children: React.ReactNode;
	x: number;
	y: number;
	w: number;
	h?: number;
	color?: string;
	opacity?: number;
	scale?: number;
	rotate?: number;
	style?: React.CSSProperties;
}> = ({children, x, y, w, h = 92, color = '#3B82F6', opacity = 1, scale = 1, rotate = 0, style}) => {
	return (
		<div
			style={{
				position: 'absolute',
				left: `${x}%`,
				top: `${y}%`,
				width: w,
				minHeight: h,
				transform: `translate(-50%, -50%) scale(${scale}) rotate(${rotate}deg)`,
				borderRadius: 22,
				border: `1.5px solid ${color}88`,
				background: `linear-gradient(135deg, ${color}24, rgba(8,11,18,0.62))`,
				boxShadow: `0 0 36px ${color}28, inset 0 0 24px rgba(255,255,255,0.04)`,
				backdropFilter: 'blur(12px)',
				color: '#F8FAFC',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				textAlign: 'center',
				padding: '18px 24px',
				fontWeight: 800,
				letterSpacing: '0.02em',
				opacity,
				fontFamily: FONT,
				...style,
			}}
		>
			{children}
		</div>
	);
};

const AgentCore: React.FC<{cues: SegmentCue[]}> = ({cues}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const agentWord = wordFrame(cues, 'Agent', 56);
	const intro = spring({frame: frame - 9, fps, durationInFrames: 36, config: {damping: 18, stiffness: 120}});
	const pulse = pulseAt(frame, agentWord, 16, 0.1);
	const push = clampInterpolate(frame, [70, 84], [1, 1.035]);
	const fadeAfter = clampInterpolate(frame, [308, 476], [1, 0]);
	const visible = frame < 476 ? fadeAfter : 0;
	const ring = clampInterpolate(frame, [140, 164], [0, 1]) - clampInterpolate(frame, [164, 190], [0, 1]);

	const bubbles = ['...', 'Agent?', '方案', '讨论', '效率', '争议', '落地', '判断'];

	return (
		<AbsoluteFill style={{opacity: visible, transform: `scale(${push})`}}>
			<GlassCard
				x={50}
				y={38}
				w={460}
				h={240}
				color="#3B82F6"
				opacity={intro}
				scale={(0.85 + intro * 0.15) * pulse}
				style={{flexDirection: 'column'}}
			>
				<div
					style={{
						fontSize: 78,
						lineHeight: 0.95,
						color: '#F8FAFC',
						textShadow: `0 0 ${24 + (pulse - 1) * 240}px #3B82F6`,
					}}
				>
					AGENT
				</div>
				<div style={{fontSize: 34, marginTop: 18, color: 'rgba(248,250,252,0.68)', letterSpacing: '0.18em'}}>
					DISCUSSION
				</div>
			</GlassCard>
			<div
				style={{
					position: 'absolute',
					left: '50%',
					top: '38%',
					width: 420 + ring * 360,
					height: 420 + ring * 360,
					borderRadius: '50%',
					border: '3px solid #FF6B3D',
					opacity: ring * 0.7,
					transform: 'translate(-50%, -50%)',
					boxShadow: '0 0 50px rgba(255,107,61,0.45)',
				}}
			/>
			{bubbles.map((b, i) => {
				const appear = clampInterpolate(frame, [42 + i * 2, 64 + i * 2], [0, 1]);
				const angle = (i / bubbles.length) * Math.PI * 2 + frame * 0.006;
				const r = 270 + (i % 2) * 70;
				return (
					<div
						key={b}
						style={{
							position: 'absolute',
							left: `calc(50% + ${Math.cos(angle) * r}px)`,
							top: `calc(38% + ${Math.sin(angle) * r * 0.62}px)`,
							transform: 'translate(-50%, -50%)',
							padding: '12px 22px',
							borderRadius: 999,
							border: '1px solid rgba(34,211,238,0.25)',
							background: 'rgba(16,27,46,0.48)',
							color: 'rgba(248,250,252,0.72)',
							fontSize: 24,
							fontWeight: 700,
							opacity: appear * 0.75,
							boxShadow: '0 0 22px rgba(59,130,246,0.15)',
						}}
					>
						{b}
					</div>
				);
			})}
		</AbsoluteFill>
	);
};

const OpinionCards: React.FC<{cues: SegmentCue[]}> = ({cues}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const agent182 = wordFrame(
		cues.filter((c) => c.startFrame >= 120 && c.endFrame <= 230),
		'Agent',
		182
	);
	const agent266 = wordFrame(
		cues.filter((c) => c.startFrame >= 240 && c.endFrame <= 320),
		'Agent',
		266
	);
	const leftIn = spring({frame: frame - 84, fps, durationInFrames: 42, config: {damping: 9, stiffness: 130}});
	const rightIn = spring({frame: frame - 210, fps, durationInFrames: 42, config: {damping: 16, stiffness: 140}});
	const dim = frame >= 308 ? 0.35 : 1;
	const retreat = clampInterpolate(frame, [462, 476], [0, 1]);
	const vibration = frame >= 294 && frame < 308 ? Math.sin(frame * 2.1) * 5 : 0;
	const glitch = frame >= 686 && frame < 695 ? (frame % 2 === 0 ? 12 : -12) : 0;
	const frontOpacity =
		frame < 84 ? 0 : frame < 476 ? dim : frame < 700 ? clampInterpolate(frame, [602, 700], [0.55, 0.9]) : 0;

	const smallCards = [
		{t: '什么都能解决', x: 28, y: 21, c: '#FF6B3D', r: -7},
		{t: 'Agent 没用', x: 70, y: 23, c: '#C95CFF', r: 6},
		{t: '方案太复杂', x: 24, y: 55, c: '#C95CFF', r: 8},
		{t: '场景不清', x: 74, y: 55, c: '#FACC15', r: -5},
		{t: '结论跑偏', x: 50, y: 18, c: '#FF4D4F', r: 3},
	];

	return (
		<AbsoluteFill style={{pointerEvents: 'none', opacity: frontOpacity}}>
			{smallCards.map((card, i) => {
				const appear = clampInterpolate(frame, [110 + i * 12, 138 + i * 12], [0, 1]);
				const chaos = frame >= 602 && frame < 700 ? clampInterpolate(frame, [602, 686], [0, 1]) : 0;
				return (
					<GlassCard
						key={card.t}
						x={card.x + Math.sin(frame * 0.025 + i) * 1.5 + glitch * 0.04 * (i % 2 ? -1 : 1)}
						y={card.y + Math.cos(frame * 0.02 + i) * 1.3 + chaos * (i % 2 ? 8 : -6)}
						w={220}
						h={72}
						color={card.c}
						opacity={appear * (frame >= 476 ? 0.68 : 0.86)}
						rotate={card.r + chaos * (i % 2 ? 15 : -18)}
						scale={0.9 + appear * 0.1}
						style={{fontSize: 24}}
					>
						{card.t}
					</GlassCard>
				);
			})}
			<GlassCard
				x={clampInterpolate(frame, [84, 122], [0, 26]) - retreat * 38}
				y={61 + vibration * 0.05}
				w={360}
				h={120}
				color="#FF6B3D"
				opacity={leftIn * dim}
				scale={pulseAt(frame, agent182, 12, 0.08)}
				rotate={-4 + vibration}
				style={{fontSize: 30}}
			>
				Agent 什么都能解决
			</GlassCard>
			<GlassCard
				x={clampInterpolate(frame, [210, 244], [105, 74]) + retreat * 38 + shakeAt(frame, agent266, 12, 1.3)}
				y={26 + shakeAt(frame, agent266, 12, 0.5)}
				w={380}
				h={120}
				color="#C95CFF"
				opacity={rightIn * dim}
				scale={1}
				rotate={4 + shakeAt(frame, agent266, 12, 0.45) - vibration}
				style={{fontSize: 30}}
			>
				看到 Agent 就想吐槽
			</GlassCard>
		</AbsoluteFill>
	);
};

const AnalysisPanel: React.FC<{cues: SegmentCue[]}> = ({cues}) => {
	const frame = useCurrentFrame();
	const ai = wordFrame(cues, 'AI', 364);
	const issue = wordFrame(cues, '问题', 434);
	const opacity = frame < 308 || frame > 492 ? 0 : clampInterpolate(frame, [308, 322, 476, 492], [0, 1, 1, 0]);
	const scan = clampInterpolate(frame, [ai, ai + 20], [-100, 100]);
	const issueText = phraseFromCue(cues, 'cue-7');

	return (
		<AbsoluteFill style={{opacity}}>
			<GlassCard
				x={50}
				y={36}
				w={620}
				h={190}
				color="#22D3EE"
				opacity={clampInterpolate(frame, [322, 348], [0, 1])}
				style={{flexDirection: 'column', overflow: 'hidden'}}
			>
				<div
					style={{
						position: 'absolute',
						top: 0,
						left: `${scan}%`,
						width: 220,
						height: 4,
						background: 'linear-gradient(90deg, transparent, #3B82F6, #22D3EE, transparent)',
						boxShadow: '0 0 20px #3B82F6',
					}}
				/>
				<div style={{fontSize: 26, color: '#22D3EE', letterSpacing: '0.16em'}}>ANALYSIS PANEL</div>
				<div style={{fontSize: 48, marginTop: 18}}>AI 工具落地观察</div>
			</GlassCard>
			<div
				style={{
					position: 'absolute',
					left: '50%',
					top: '56%',
					transform: `translate(-50%, -50%) scale(${clampInterpolate(frame, [392, 420], [0.92, 1])})`,
					opacity: clampInterpolate(frame, [392, 420], [0, 1]),
					textAlign: 'center',
					fontFamily: FONT,
				}}
			>
				<div style={{fontSize: 62, fontWeight: 900, color: frame >= issue ? '#FACC15' : '#F8FAFC', textShadow: '0 0 28px rgba(250,204,21,0.25)'}}>
					关键问题
				</div>
				<div style={{fontSize: 36, fontWeight: 750, color: 'rgba(248,250,252,0.78)', marginTop: 18}}>
					不是争 Agent 有没有用
				</div>
				<div style={{fontSize: 18, color: 'rgba(34,211,238,0.55)', marginTop: 14}}>{issueText}</div>
			</div>
		</AbsoluteFill>
	);
};

const ScenarioClassifier: React.FC<{cues: SegmentCue[]}> = ({cues}) => {
	const frame = useCurrentFrame();
	const agentDrop = wordFrame(
		cues.filter((c) => c.startFrame >= 476 && c.endFrame <= 546),
		'Agent',
		518
	);
	const opacity = frame < 476 || frame > 720 ? 0 : clampInterpolate(frame, [476, 494, 700, 720], [0, 1, 1, 0]);
	const red = frame >= 588 ? 1 : 0;
	const tagY = clampInterpolate(frame, [agentDrop, agentDrop + 18], [-120, 18], Easing.out(Easing.back(1.5)));
	const warning = clampInterpolate(frame, [546, 574], [0, 1]);
	const glitch = frame >= 686 && frame < 695 ? (frame % 2 ? -12 : 12) : 0;
	const slots = ['任务类型', '决策复杂度', '工具调用', '结果可验证性'];

	return (
		<AbsoluteFill style={{opacity}}>
			<div
				style={{
					position: 'absolute',
					left: '50%',
					top: '23%',
					transform: 'translate(-50%, -50%)',
					color: '#F8FAFC',
					fontFamily: FONT,
					fontSize: 42,
					fontWeight: 850,
					letterSpacing: '0.03em',
				}}
			>
				聊 <span style={{color: '#3B82F6'}}>Agent</span> 之前
			</div>
			<div
				style={{
					position: 'absolute',
					left: `calc(50% + ${glitch}px)`,
					top: '43%',
					width: 620,
					height: 250,
					transform: 'translate(-50%, -50%)',
					borderRadius: 28,
					border: `2px solid ${red ? '#FF4D4F' : '#22D3EE'}`,
					background: 'rgba(8,11,18,0.58)',
					boxShadow: `0 0 42px ${red ? 'rgba(255,77,79,0.3)' : 'rgba(34,211,238,0.22)'}`,
					overflow: 'hidden',
				}}
			>
				<div
					style={{
						position: 'absolute',
						top: 18,
						left: 26,
						fontSize: 24,
						color: red ? '#FF4D4F' : '#22D3EE',
						fontWeight: 900,
						letterSpacing: '0.18em',
					}}
				>
					SCENARIO
				</div>
				<div
					style={{
						position: 'absolute',
						left: '50%',
						top: tagY,
						transform: 'translate(-50%, 0)',
						padding: '14px 38px',
						borderRadius: 16,
						border: '1px solid rgba(59,130,246,0.8)',
						background: 'rgba(59,130,246,0.18)',
						color: '#F8FAFC',
						fontSize: 34,
						fontWeight: 900,
						boxShadow: '0 0 26px rgba(59,130,246,0.35)',
					}}
				>
					AGENT
				</div>
				{frame >= 588 && (
					<div
						style={{
							position: 'absolute',
							right: 24,
							bottom: 22,
							padding: '8px 18px',
							border: '1px solid #FF4D4F',
							color: '#FF4D4F',
							fontWeight: 950,
							letterSpacing: '0.14em',
							fontSize: 22,
							transform: `rotate(${frame % 2 ? -2 : 2}deg)`,
						}}
					>
						UNSORTED
					</div>
				)}
			</div>
			<div
				style={{
					position: 'absolute',
					left: '50%',
					top: '62%',
					transform: `translate(-50%, -50%) scale(${0.92 + warning * 0.08})`,
					opacity: warning,
					fontSize: 66,
					fontWeight: 950,
					color: '#F8FAFC',
					textShadow: '0 0 32px rgba(255,77,79,0.32)',
				}}
			>
				<span style={{color: frame >= 574 ? '#FACC15' : '#F8FAFC'}}>场景</span>没分清楚
			</div>
			<div
				style={{
					position: 'absolute',
					left: '50%',
					top: '74%',
					transform: 'translate(-50%, -50%)',
					display: 'flex',
					gap: 18,
					opacity: clampInterpolate(frame, [500, 540], [0, 1]),
				}}
			>
				{slots.map((s, i) => (
					<div
						key={s}
						style={{
							width: 150,
							height: 58,
							borderRadius: 16,
							border: `1px solid ${frame >= 588 ? 'rgba(255,77,79,0.46)' : 'rgba(34,211,238,0.34)'}`,
							color: 'rgba(248,250,252,0.74)',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							fontWeight: 800,
							fontSize: 20,
							background: 'rgba(16,27,46,0.42)',
							transform: frame >= 602 ? `translate(${(i - 1.5) * -18}px, ${(i % 2 ? 12 : -8)}px) rotate(${(i - 1.5) * 7}deg)` : undefined,
						}}
					>
						{s}
					</div>
				))}
			</div>
		</AbsoluteFill>
	);
};

const MixedDiagram: React.FC<{cues: SegmentCue[]}> = ({cues}) => {
	const frame = useCurrentFrame();
	const opacity = frame < 700 || frame > 884 ? 0 : clampInterpolate(frame, [700, 718, 868, 884], [0, 1, 1, 0]);
	const boundary = frame >= wordFrame(cues, '一类问题', 728) && frame < 742 ? 1 : 0;
	const mix = clampInterpolate(frame, [742, 770], [0, 1], Easing.inOut(Easing.quad));
	const stamp = clampInterpolate(frame, [854, 862], [0, 1], Easing.out(Easing.back(1.8)));
	const report = clampInterpolate(frame, [826, 842], [0, 1]);
	const shake = frame >= 854 && frame < 868 ? Math.sin(frame * 2.5) * 6 : 0;
	const cols = [
		{t: '信息检索', x: 25, c: '#22D3EE'},
		{t: '流程自动化', x: 50, c: '#3B82F6'},
		{t: '复杂决策', x: 75, c: '#FACC15'},
	];

	return (
		<AbsoluteFill style={{opacity}}>
			<div
				style={{
					position: 'absolute',
					left: '50%',
					top: '23%',
					width: 880,
					height: 330,
					transform: 'translate(-50%, -50%)',
				}}
			>
				{[37.5, 62.5].map((x) => (
					<div
						key={x}
						style={{
							position: 'absolute',
							left: `${x}%`,
							top: 20,
							bottom: 20,
							width: 2,
							background: '#22D3EE',
							opacity: boundary * 0.9 * (1 - mix),
							boxShadow: '0 0 18px #22D3EE',
						}}
					/>
				))}
				<div
					style={{
						position: 'absolute',
						left: '50%',
						top: '50%',
						width: 640,
						height: 220,
						transform: `translate(-50%, -50%) scale(${mix})`,
						borderRadius: 28,
						border: '2px dashed rgba(255,77,79,0.72)',
						background: 'rgba(255,77,79,0.08)',
						boxShadow: '0 0 36px rgba(255,77,79,0.18)',
						opacity: mix,
					}}
				>
					<div
						style={{
							position: 'absolute',
							top: -48,
							width: '100%',
							textAlign: 'center',
							color: '#F8FAFC',
							fontSize: 38,
							fontWeight: 900,
						}}
					>
						混在一起讨论
					</div>
				</div>
				{cols.map((col, i) => {
					const x = col.x + (50 - col.x) * mix;
					const y = 52 + (i - 1) * mix * 14;
					return (
						<GlassCard
							key={col.t}
							x={x}
							y={y}
							w={220}
							h={120}
							color={col.c}
							opacity={1}
							scale={1 - mix * 0.08}
							rotate={(i - 1) * mix * 9}
							style={{fontSize: 30}}
						>
							{col.t}
						</GlassCard>
					);
				})}
			</div>
			<div
				style={{
					position: 'absolute',
					left: '50%',
					top: '57%',
					width: 410,
					height: 250,
					transform: `translate(-50%, -50%) scale(${report}) rotate(${shake * 0.3}deg)`,
					opacity: report,
					borderRadius: 22,
					background: 'rgba(248,250,252,0.9)',
					color: '#080B12',
					padding: 30,
					boxShadow: '0 20px 80px rgba(0,0,0,0.38)',
					fontFamily: FONT,
				}}
			>
				<div style={{fontSize: 28, fontWeight: 950, color: '#101B2E'}}>CONCLUSION REPORT</div>
				<div style={{height: 12}} />
				{[0, 1, 2].map((i) => (
					<div
						key={i}
						style={{
							height: 12,
							width: `${80 - i * 15}%`,
							background: 'rgba(16,27,46,0.22)',
							borderRadius: 99,
							marginTop: 18,
						}}
					/>
				))}
				<div
					style={{
						position: 'absolute',
						left: '50%',
						top: '52%',
						transform: `translate(-50%, -50%) scale(${stamp}) rotate(-14deg)`,
						width: 210,
						height: 92,
						border: '7px solid #FF4D4F',
						borderRadius: 14,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						color: '#FF4D4F',
						fontSize: 48,
						fontWeight: 950,
						opacity: stamp,
					}}
				>
					不靠谱
				</div>
				<div
					style={{
						position: 'absolute',
						left: '50%',
						top: '52%',
						width: 180 + stamp * 260,
						height: 180 + stamp * 260,
						borderRadius: '50%',
						border: '3px solid rgba(255,77,79,0.45)',
						transform: 'translate(-50%, -50%)',
						opacity: stamp * clampInterpolate(frame, [854, 868], [0.7, 0]),
					}}
				/>
			</div>
		</AbsoluteFill>
	);
};

const PauseAndQuestion: React.FC<{cues: SegmentCue[]}> = ({cues}) => {
	const frame = useCurrentFrame();
	const agent = wordFrame(cues, 'Agent', 924);
	const useWord = wordFrame(cues, '有没有用', 952);
	const opacity = frame < 868 || frame > 986 ? 0 : clampInterpolate(frame, [868, 882, 966, 986], [0, 1, 1, 0]);
	const cursorOn = frame >= useWord && frame < 966 && Math.floor((frame - useWord) / 4) % 2 === 0;

	return (
		<AbsoluteFill style={{opacity, alignItems: 'center', justifyContent: 'center'}}>
			<div
				style={{
					position: 'absolute',
					top: '40%',
					left: '50%',
					transform: `translate(-50%, -50%) scale(${clampInterpolate(frame, [882, 902, 910], [0.9, 1, 0.92])})`,
					opacity: frame < 910 ? clampInterpolate(frame, [882, 902], [0, 1]) : clampInterpolate(frame, [910, 924], [1, 0]),
					color: '#F8FAFC',
					fontSize: 70,
					fontWeight: 950,
					textShadow: '0 0 28px rgba(59,130,246,0.22)',
				}}
			>
				先停一下
			</div>
			<div
				style={{
					position: 'absolute',
					top: '43%',
					left: '50%',
					transform: `translate(-50%, -50%) scale(${clampInterpolate(frame, [910, 930], [0.95, 1])})`,
					opacity: clampInterpolate(frame, [910, 930], [0, 1]),
					textAlign: 'center',
					color: '#F8FAFC',
					fontFamily: FONT,
					fontWeight: 950,
				}}
			>
				<div style={{fontSize: 54}}>别急着争</div>
				<div style={{fontSize: 58, marginTop: 18}}>
					<span style={{color: frame >= agent ? '#3B82F6' : '#F8FAFC'}}>Agent</span> 到底有没有用
				</div>
				<div
					style={{
						width: 160,
						height: 5,
						background: cursorOn ? '#FACC15' : 'transparent',
						margin: '18px auto 0',
						boxShadow: cursorOn ? '0 0 18px #FACC15' : 'none',
					}}
				/>
				<div style={{fontSize: 42, color: cursorOn ? '#FACC15' : 'transparent', lineHeight: 1}}>?</div>
			</div>
		</AbsoluteFill>
	);
};

const FinalQuestion: React.FC<{cues: SegmentCue[]; durationInFrames: number}> = ({cues, durationInFrames}) => {
	const frame = useCurrentFrame();
	const solve = wordFrame(cues, '解决', 994);
	const sceneWord = wordFrame(cues, '什么场景', 1036);
	const unclear = wordFrame(cues, '不弄明白', 1078);
	const off = wordFrame(cues, '会跑偏', 1147);
	const opacity = frame < 966 ? 0 : clampInterpolate(frame, [966, 982], [0, 1]);
	const titleLock = clampInterpolate(frame, [1050, 1092], [0, 1]);
	const quote = clampInterpolate(frame, [1124, safeEndFrame(1124, 1161, durationInFrames)], [0, 1]);

	const targetOpacity = clampInterpolate(frame, [solve, solve + 16], [0, 1]);
	const pathProgress = clampInterpolate(frame, [1092, off + 12], [0, 1], Easing.inOut(Easing.quad));
	const shoot = clampInterpolate(frame, [off, off + 14], [0, 1]);
	const disabled = frame >= unclear;

	const slots = ['场景 A', '场景 B', '场景 C'];

	return (
		<AbsoluteFill style={{opacity}}>
			<div
				style={{
					position: 'absolute',
					top: `${titleLock ? 17 : 40}%`,
					left: '50%',
					transform: `translate(-50%, -50%) scale(${1 - titleLock * 0.34}) translateY(${clampInterpolate(frame, [966, 990], [60, 0])}px)`,
					textAlign: 'center',
					color: '#F8FAFC',
					fontFamily: FONT,
					fontWeight: 950,
					opacity: 1 - quote * 0.9,
					width: '92%',
				}}
			>
				<div style={{fontSize: 70, color: '#F8FAFC'}}>先问清楚</div>
				<div style={{fontSize: 52, marginTop: 22}}>
					你要解决的到底是
					<span style={{color: frame >= 1050 ? '#FACC15' : '#F8FAFC'}}>什么场景？</span>
				</div>
			</div>
			<div
				style={{
					position: 'absolute',
					left: '50%',
					top: '42%',
					transform: 'translate(-50%, -50%)',
					opacity: targetOpacity,
				}}
			>
				<div
					style={{
						width: 34,
						height: 34,
						borderRadius: '50%',
						border: '4px solid #22D3EE',
						boxShadow: '0 0 30px rgba(34,211,238,0.7)',
					}}
				/>
				<div
					style={{
						position: 'absolute',
						left: '50%',
						top: '50%',
						width: 110,
						height: 110,
						borderRadius: '50%',
						border: '2px solid rgba(34,211,238,0.25)',
						transform: `translate(-50%, -50%) scale(${1 + Math.sin(frame * 0.08) * 0.08})`,
					}}
				/>
			</div>
			<div
				style={{
					position: 'absolute',
					left: '50%',
					top: '58%',
					transform: 'translate(-50%, -50%)',
					display: 'flex',
					gap: 24,
					opacity: 1 - quote * 0.45,
				}}
			>
				{slots.map((s, i) => {
					const lit = frame >= sceneWord + i * 5;
					return (
						<div
							key={s}
							style={{
								width: 190,
								height: 82,
								borderRadius: 20,
								border: `1.5px solid ${disabled ? 'rgba(148,163,184,0.38)' : lit ? '#FACC15' : 'rgba(59,130,246,0.28)'}`,
								background: disabled
									? 'rgba(148,163,184,0.09)'
									: lit
										? 'rgba(250,204,21,0.13)'
										: 'rgba(59,130,246,0.08)',
								color: disabled ? 'rgba(148,163,184,0.65)' : lit ? '#FACC15' : 'rgba(248,250,252,0.55)',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								fontSize: 26,
								fontWeight: 900,
								boxShadow: lit && !disabled ? '0 0 24px rgba(250,204,21,0.18)' : 'none',
							}}
						>
							{s}
						</div>
					);
				})}
			</div>
			<div
				style={{
					position: 'absolute',
					left: '50%',
					top: '39%',
					transform: `translate(-50%, -50%) scale(${clampInterpolate(frame, [1050, 1070], [0.92, 1])})`,
					opacity: clampInterpolate(frame, [1050, 1070, 1092, 1104], [0, 1, 1, 0]),
					color: '#FF4D4F',
					fontSize: 56,
					fontWeight: 950,
					textShadow: '0 0 26px rgba(255,77,79,0.28)',
				}}
			>
				问题没弄明白
			</div>
			<svg
				style={{
					position: 'absolute',
					inset: 0,
					opacity: frame >= 1092 ? 1 : 0,
				}}
				width="100%"
				height="100%"
				viewBox="0 0 1000 1000"
				preserveAspectRatio="none"
			>
				<path
					d={`M 150 710 C ${330 + pathProgress * 40} ${640 - pathProgress * 80}, ${420 + pathProgress * 100} ${500 + pathProgress * 15}, ${500 + pathProgress * (420 + shoot * 360)} ${420 + pathProgress * (130 + shoot * 60)}`}
					fill="none"
					stroke="#FF4D4F"
					strokeWidth="7"
					strokeLinecap="round"
					strokeDasharray={`${pathProgress * 1050} 1200`}
					opacity={0.85}
					style={{filter: 'drop-shadow(0 0 12px rgba(255,77,79,0.55))'}}
				/>
				<path
					d="M 150 710 C 310 640, 410 500, 500 420"
					fill="none"
					stroke="rgba(34,211,238,0.22)"
					strokeWidth="3"
					strokeDasharray="10 14"
					opacity={0.8}
				/>
			</svg>
			<div
				style={{
					position: 'absolute',
					left: '50%',
					top: '39%',
					transform: `translate(-50%, -50%) scale(${0.92 + quote * 0.08})`,
					opacity: quote,
					textAlign: 'center',
					fontFamily: FONT,
					fontWeight: 950,
					color: '#F8FAFC',
					textShadow: '0 0 34px rgba(59,130,246,0.32)',
					width: '90%',
				}}
			>
				<div style={{fontSize: 76}}>
					先分清<span style={{color: '#FACC15'}}>场景</span>
				</div>
				<div style={{fontSize: 58, marginTop: 20}}>
					再讨论 <span style={{color: '#3B82F6'}}>Agent</span>
				</div>
			</div>
		</AbsoluteFill>
	);
};

const CueTelemetry: React.FC<{cues: SegmentCue[]}> = ({cues}) => {
	const frame = useCurrentFrame();
	const activeIndex = cues.findIndex((cue) => frame >= cue.startFrame && frame < cue.endFrame);
	return (
		<div
			style={{
				position: 'absolute',
				left: '7%',
				top: '7%',
				display: 'flex',
				gap: 6,
				opacity: 0.42,
			}}
		>
			{cues.map((cue, i) => (
				<div
					key={cue.id}
					style={{
						width: i === activeIndex ? 28 : 12,
						height: 5,
						borderRadius: 99,
						background: i === activeIndex ? '#22D3EE' : 'rgba(80,140,255,0.32)',
						boxShadow: i === activeIndex ? '0 0 12px rgba(34,211,238,0.6)' : 'none',
					}}
				/>
			))}
		</div>
	);
};

const keywordColor = (text: string) => {
	if (text.includes('Agent')) return '#3B82F6';
	if (text.includes('场') || text.includes('景')) return '#FACC15';
	if (text.includes('不靠谱')) return '#FF4D4F';
	if (text.includes('跑偏')) return '#FF4D4F';
	return '#F8FAFC';
};

const CaptionLayer: React.FC<{cues: SegmentCue[]}> = ({cues}) => {
	const frame = useCurrentFrame();
	const {width, height} = useVideoConfig();
	const active = activeCueAt(cues, frame);
	if (!active) return null;

	const fontSize = height > width ? 52 : 46;
	const words: WordCue[] = active.words.length > 0 ? active.words : [{text: active.text, startFrame: active.startFrame, endFrame: active.endFrame}];

	return (
		<div
			style={{
				position: 'absolute',
				left: '11%',
				right: '11%',
				top: '82%',
				transform: 'translateY(-50%)',
				textAlign: 'center',
				fontFamily: FONT,
				fontSize,
				lineHeight: 1.42,
				fontWeight: 600,
				color: '#F8FAFC',
				textShadow:
					'3px 0 rgba(0,0,0,0.65), -3px 0 rgba(0,0,0,0.65), 0 3px rgba(0,0,0,0.65), 0 -3px rgba(0,0,0,0.65), 0 4px 16px rgba(0,0,0,0.45)',
				letterSpacing: '0.01em',
				pointerEvents: 'none',
			}}
		>
			<div
				style={{
					display: 'inline',
					maxWidth: '78%',
					whiteSpace: 'normal',
				}}
			>
				{words.map((word, i) => {
					const isActive = frame >= word.startFrame && frame < word.endFrame;
					const color = keywordColor(word.text);
					const isKeyword = color !== '#F8FAFC';
					const scale = isActive && isKeyword ? pulseAt(frame, word.startFrame, 6, 0.08) : 1;
					return (
						<span
							key={`${word.text}-${i}`}
							style={{
								display: 'inline-block',
								color: isKeyword ? color : '#F8FAFC',
								fontWeight: isKeyword ? 800 : 600,
								transform: `scale(${scale})`,
								textShadow: isKeyword
									? `0 0 18px ${color}66, 3px 0 rgba(0,0,0,0.65), -3px 0 rgba(0,0,0,0.65), 0 3px rgba(0,0,0,0.65), 0 -3px rgba(0,0,0,0.65), 0 4px 16px rgba(0,0,0,0.45)`
									: undefined,
							}}
						>
							{word.text}
						</span>
					);
				})}
			</div>
		</div>
	);
};

export const Scene2Generated: React.FC<{
	cues: SegmentCue[];
	durationInFrames: number;
	assets?: SceneAsset[];
}> = ({cues, durationInFrames}) => {
	useSceneProgress(durationInFrames);
	const frame = useCurrentFrame();

	const currentCue = activeCueAt(cues, frame);
	const beatLabel = currentCue?.words.find((word) => frame >= word.startFrame && frame < word.endFrame)?.text ?? '';

	return (
		<AbsoluteFill style={{backgroundColor: '#080B12', overflow: 'hidden', fontFamily: FONT}}>
			<TechBackground durationInFrames={durationInFrames} cues={cues} />
			<AgentCore cues={cues} />
			<OpinionCards cues={cues} />
			<AnalysisPanel cues={cues} />
			<ScenarioClassifier cues={cues} />
			<MixedDiagram cues={cues} />
			<PauseAndQuestion cues={cues} />
			<FinalQuestion cues={cues} durationInFrames={durationInFrames} />
			<CueTelemetry cues={cues} />
			<div
				style={{
					position: 'absolute',
					right: '6%',
					top: '6%',
					padding: '8px 14px',
					borderRadius: 999,
					border: '1px solid rgba(34,211,238,0.24)',
					background: 'rgba(8,11,18,0.38)',
					color: 'rgba(248,250,252,0.42)',
					fontSize: 16,
					fontWeight: 800,
					letterSpacing: '0.12em',
					opacity: 0.7,
				}}
			>
				{beatLabel ? `LIVE WORD · ${beatLabel}` : 'AGENT DISCUSSION MAP'}
			</div>
			<CaptionLayer cues={cues} />
		</AbsoluteFill>
	);
};
