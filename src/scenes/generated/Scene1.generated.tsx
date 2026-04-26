import React, {useMemo} from 'react';
import {
	AbsoluteFill,
	Easing,
	interpolate,
	spring,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion';
import type {SegmentCue, WordCue} from '../../types';
import {useSceneProgress} from '../../hooks/useSceneProgress';
import {Background} from '../../components/Background';

const DEEP_BLUE = '#1E3A8A';
const LIGHT_BLUE = '#3B82F6';
const ORANGE = '#F97316';
const NIGHT = '#050B1C';

type IconKind =
	| 'office'
	| 'education'
	| 'medical'
	| 'tool'
	| 'debate'
	| 'hype'
	| 'critique'
	| 'context'
	| 'question';

const clamp = (
	frame: number,
	input: [number, number],
	output: [number, number],
	easing?: (input: number) => number
) =>
	interpolate(frame, input, output, {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
		easing,
	});

const cueIsActive = (cue: SegmentCue, frame: number) =>
	frame >= cue.startFrame && frame <= cue.endFrame;

const keywordActive = (
	cues: SegmentCue[],
	frame: number,
	predicate: (word: WordCue, cue: SegmentCue) => boolean
) =>
	cues.some((cue) =>
		cue.words.some(
			(word) =>
				frame >= word.startFrame &&
				frame < word.endFrame &&
				predicate(word, cue)
		)
	);

const pickIconKind = (cue: SegmentCue, index: number): IconKind => {
	const t = cue.text;
	if (t.includes('吹') || t.includes('夸')) return 'hype';
	if (t.includes('骂') || t.includes('逮')) return 'critique';
	if (t.includes('AI') || t.includes('工具') || t.includes('落地')) return 'tool';
	if (t.includes('失真') || t.includes('混') || t.includes('场景')) return 'context';
	if (t.includes('讨论') || t.includes('聊')) return 'debate';
	if (t.includes('问题') || t.includes('解决')) return 'question';
	const fallback: IconKind[] = ['office', 'education', 'medical', 'tool', 'debate'];
	return fallback[index % fallback.length];
};

const iconTitle = (kind: IconKind) => {
	if (kind === 'office') return 'WORKFLOW';
	if (kind === 'education') return 'LEARNING';
	if (kind === 'medical') return 'HEALTHCARE';
	if (kind === 'tool') return 'AI TOOL';
	if (kind === 'debate') return 'DEBATE';
	if (kind === 'hype') return 'AMPLIFY';
	if (kind === 'critique') return 'CRITIQUE';
	if (kind === 'context') return 'CONTEXT';
	return 'QUESTION';
};

const isOrangeToken = (token: string) =>
	token === 'Agent' ||
	token === 'AI' ||
	token === '场' ||
	token === '景' ||
	token === '失' ||
	token === '真';

const RuntimeText: React.FC<{
	text: string;
	fontSize: number;
	weight?: number;
	align?: React.CSSProperties['textAlign'];
}> = ({text, fontSize, weight = 850, align = 'center'}) => {
	const tokens = useMemo(() => {
		const result: string[] = [];
		let i = 0;
		while (i < text.length) {
			if (text.slice(i, i + 5) === 'Agent') {
				result.push('Agent');
				i += 5;
			} else if (text.slice(i, i + 2) === 'AI') {
				result.push('AI');
				i += 2;
			} else {
				result.push(text[i]);
				i += 1;
			}
		}
		return result;
	}, [text]);

	return (
		<div
			style={{
				fontSize,
				fontWeight: weight,
				lineHeight: 1.16,
				letterSpacing: '-0.035em',
				textAlign: align,
				color: 'rgba(241,247,255,0.96)',
			}}
		>
			{tokens.map((token, i) => {
				const accent = isOrangeToken(token);
				return (
					<span
						key={`${token}-${i}`}
						style={{
							color: accent ? ORANGE : 'rgba(241,247,255,0.96)',
							textShadow: accent
								? `0 0 22px ${ORANGE}88, 0 5px 22px rgba(0,0,0,0.5)`
								: '0 5px 22px rgba(0,0,0,0.46)',
							margin: token === 'Agent' || token === 'AI' ? '0 0.11em' : 0,
						}}
					>
						{token}
					</span>
				);
			})}
		</div>
	);
};

const CityBackground: React.FC<{durationInFrames: number}> = ({
	durationInFrames,
}) => {
	const frame = useCurrentFrame();
	const {width, height} = useVideoConfig();

	const buildings = useMemo(
		() =>
			Array.from({length: 36}, (_, i) => ({
				x: (i / 36) * width - 26,
				w: 32 + ((i * 29) % 58),
				h: 120 + ((i * 47) % 290),
				windowStep: 2 + (i % 4),
			})),
		[width]
	);

	const intro = clamp(frame, [0, Math.min(90, durationInFrames * 0.16)], [0, 1]);
	const drift = Math.sin(frame * 0.008) * 12;

	return (
		<AbsoluteFill style={{background: NIGHT, overflow: 'hidden'}}>
			<Background particleCount={50} color={DEEP_BLUE} />
			<div
				style={{
					position: 'absolute',
					inset: 0,
					opacity: intro,
					background: `
            radial-gradient(circle at 48% 35%, rgba(59,130,246,0.34), transparent 32%),
            radial-gradient(circle at 72% 18%, rgba(249,115,22,0.10), transparent 24%),
            linear-gradient(145deg, #020617 0%, ${DEEP_BLUE} 48%, #071225 100%)
          `,
				}}
			/>
			<div
				style={{
					position: 'absolute',
					inset: 0,
					opacity: 0.5,
					transform: `translateY(${drift}px)`,
					backgroundImage:
						'linear-gradient(rgba(147,197,253,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(147,197,253,0.04) 1px, transparent 1px)',
					backgroundSize: '80px 80px',
				}}
			/>
			<svg
				width={width}
				height={height}
				style={{
					position: 'absolute',
					inset: 0,
					filter: 'blur(3.2px)',
					opacity: 0.92 * intro,
				}}
			>
				<defs>
					<linearGradient id="skyline" x1="0" x2="0" y1="0" y2="1">
						<stop offset="0%" stopColor="#1B3F86" stopOpacity="0.58" />
						<stop offset="100%" stopColor="#020617" stopOpacity="0.96" />
					</linearGradient>
				</defs>
				{buildings.map((b, i) => {
					const y = height - 160 - b.h * 0.43;
					return (
						<g key={i}>
							<rect
								x={b.x}
								y={y}
								width={b.w}
								height={height - y}
								rx={4}
								fill="url(#skyline)"
							/>
							{Array.from({length: Math.floor(b.h / 48)}, (_, row) =>
								Array.from(
									{length: Math.max(1, Math.floor(b.w / 18))},
									(_, col) => {
										const lit = (row + col + i) % b.windowStep === 0;
										return (
											<rect
												key={`${row}-${col}`}
												x={b.x + 8 + col * 17}
												y={y + 18 + row * 27}
												width={6}
												height={10}
												rx={1}
												fill={lit ? LIGHT_BLUE : '#0B1B3E'}
												opacity={lit ? 0.24 : 0.12}
											/>
										);
									}
								)
							)}
						</g>
					);
				})}
			</svg>
			<div
				style={{
					position: 'absolute',
					inset: 0,
					background:
						'linear-gradient(180deg, rgba(2,6,23,0) 0%, rgba(2,6,23,0.14) 57%, rgba(2,6,23,0.88) 100%)',
				}}
			/>
		</AbsoluteFill>
	);
};

const ScenarioIcon: React.FC<{kind: IconKind; color?: string}> = ({
	kind,
	color = '#EAF4FF',
}) => {
	const common = {
		stroke: color,
		strokeWidth: 4,
		fill: 'none',
		strokeLinecap: 'round' as const,
		strokeLinejoin: 'round' as const,
	};
	return (
		<svg width="70" height="70" viewBox="0 0 72 72">
			{kind === 'office' && (
				<>
					<rect x="14" y="23" width="44" height="31" rx="4" {...common} />
					<path d="M26 23v-7h20v7M14 35h44M36 35v8" {...common} />
				</>
			)}
			{kind === 'education' && (
				<>
					<path d="M10 25l26-12 26 12-26 12L10 25z" {...common} />
					<path d="M20 31v13c8 8 24 8 32 0V31M62 25v18" {...common} />
				</>
			)}
			{kind === 'medical' && (
				<>
					<rect x="16" y="15" width="40" height="42" rx="8" {...common} />
					<path d="M36 25v22M25 36h22" {...common} />
				</>
			)}
			{kind === 'tool' && (
				<>
					<rect x="15" y="14" width="42" height="36" rx="7" {...common} />
					<path d="M24 58h24M36 50v8M26 28h20M26 38h11" {...common} />
					<circle cx="49" cy="38" r="3" fill={color} opacity={0.95} />
				</>
			)}
			{kind === 'debate' && (
				<>
					<path
						d="M14 19h30a8 8 0 0 1 8 8v8a8 8 0 0 1-8 8H29L17 53V43h-3a8 8 0 0 1-8-8v-8a8 8 0 0 1 8-8z"
						{...common}
					/>
					<path d="M21 29h22M21 37h14" {...common} />
				</>
			)}
			{kind === 'hype' && (
				<>
					<path d="M17 42l23-12v26L17 44v-2zM40 31l14-8v40l-14-8" {...common} />
					<path d="M57 29c5 5 5 17 0 22" {...common} />
				</>
			)}
			{kind === 'critique' && (
				<>
					<circle cx="36" cy="36" r="23" {...common} />
					<path d="M24 24l24 24M48 24L24 48" {...common} stroke={ORANGE} />
				</>
			)}
			{kind === 'context' && (
				<>
					<circle cx="24" cy="28" r="12" {...common} />
					<circle cx="48" cy="28" r="12" {...common} />
					<circle cx="36" cy="48" r="12" {...common} />
					<path d="M31 35l-4 5M41 35l4 5" {...common} opacity={0.72} />
				</>
			)}
			{kind === 'question' && (
				<>
					<circle cx="36" cy="36" r="25" {...common} />
					<path d="M28 29c1-8 17-9 18 1 1 8-10 8-10 16" {...common} />
					<circle cx="36" cy="55" r="2.5" fill={color} />
				</>
			)}
		</svg>
	);
};

const CoreAgent: React.FC<{
	cues: SegmentCue[];
	durationInFrames: number;
}> = ({cues, durationInFrames}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();

	const agentActive = keywordActive(cues, frame, (word) => word.text === 'Agent');
	const intro = clamp(
		frame,
		[0, durationInFrames * 0.2],
		[0, 1],
		Easing.out(Easing.sin)
	);
	const thesis = clamp(
		frame,
		[durationInFrames * 0.5, durationInFrames * 0.78],
		[0, 1],
		Easing.inOut(Easing.sin)
	);
	const refocus = clamp(
		frame,
		[durationInFrames * 0.9, durationInFrames * 0.98],
		[0, 1],
		Easing.out(Easing.sin)
	);
	const wordPulse = spring({
		frame: agentActive ? frame % Math.max(1, fps) : -30,
		fps,
		durationInFrames: 18,
		config: {damping: 160},
	});
	const scale =
		0.86 +
		intro * 0.14 +
		(agentActive ? 0.08 : 0) +
		wordPulse * 0.025 +
		Math.sin(frame * 0.025) * 0.012 -
		thesis * 0.08 +
		refocus * 0.04;

	return (
		<div
			style={{
				position: 'absolute',
				left: '50%',
				top: '42%',
				transform: `translate(-50%, -50%) scale(${scale})`,
				opacity: intro * (0.92 - thesis * 0.32 + refocus * 0.28),
				padding: '34px 58px',
				borderRadius: 999,
				background:
					'linear-gradient(135deg, rgba(15,23,42,0.78), rgba(30,58,138,0.42))',
				border: `1px solid ${
					agentActive ? 'rgba(249,115,22,0.9)' : 'rgba(147,197,253,0.36)'
				}`,
				boxShadow: agentActive
					? `0 0 38px ${ORANGE}88, 0 0 100px rgba(59,130,246,0.28)`
					: '0 0 85px rgba(59,130,246,0.25), inset 0 0 45px rgba(147,197,253,0.08)',
				backdropFilter: 'blur(14px)',
			}}
		>
			<div
				style={{
					fontSize: 78,
					fontWeight: 930,
					letterSpacing: '0.055em',
					color: agentActive ? ORANGE : '#F8FBFF',
					textShadow: agentActive
						? `0 0 28px ${ORANGE}`
						: '0 0 30px rgba(59,130,246,0.65)',
				}}
			>
				Agent
			</div>
		</div>
	);
};

const OrbitSystem: React.FC<{
	cues: SegmentCue[];
	durationInFrames: number;
}> = ({cues, durationInFrames}) => {
	const frame = useCurrentFrame();
	const {fps, width, height} = useVideoConfig();
	const centerX = width / 2;
	const centerY = height * 0.42;
	const total = Math.max(1, cues.length);

	const expand = clamp(
		frame,
		[durationInFrames * 0.2, durationInFrames * 0.5],
		[0, 1],
		Easing.out(Easing.sin)
	);
	const mix = clamp(
		frame,
		[durationInFrames * 0.8, durationInFrames * 0.88],
		[0, 1],
		Easing.inOut(Easing.sin)
	);
	const refocus = clamp(
		frame,
		[durationInFrames * 0.9, durationInFrames * 0.98],
		[0, 1],
		Easing.inOut(Easing.sin)
	);

	return (
		<>
			<svg
				width={width}
				height={height}
				style={{
					position: 'absolute',
					inset: 0,
					filter: `blur(${mix * (1 - refocus) * 2.4}px)`,
				}}
			>
				<defs>
					<radialGradient id="ringGradient">
						<stop offset="0%" stopColor={LIGHT_BLUE} stopOpacity="0.24" />
						<stop offset="72%" stopColor={DEEP_BLUE} stopOpacity="0.08" />
						<stop offset="100%" stopColor={ORANGE} stopOpacity="0" />
					</radialGradient>
					<linearGradient id="wire" x1="0" x2="1" y1="0" y2="1">
						<stop offset="0%" stopColor={LIGHT_BLUE} stopOpacity="0.7" />
						<stop offset="100%" stopColor={ORANGE} stopOpacity="0.7" />
					</linearGradient>
				</defs>
				{Array.from({length: 5}, (_, i) => {
					const start = durationInFrames * 0.2 + i * 34;
					const p = clamp(frame, [start, start + durationInFrames * 0.25], [0, 1]);
					return (
						<circle
							key={i}
							cx={centerX}
							cy={centerY}
							r={70 + p * (185 + i * 54)}
							fill="none"
							stroke="url(#ringGradient)"
							strokeWidth={2.4}
							opacity={p * (1 - p * 0.48)}
						/>
					);
				})}
				{cues.map((cue, index) => {
					const a = -Math.PI / 2 + (index / total) * Math.PI * 2;
					const radius = (265 + Math.sin(index * 1.7) * 36) * expand;
					const x = centerX + Math.cos(a) * radius;
					const y = centerY + Math.sin(a) * radius * 0.72;
					const revealStart =
						durationInFrames * 0.2 + (index / total) * durationInFrames * 0.3;
					const opacity = clamp(frame, [revealStart, revealStart + 24], [0, 1]);
					return (
						<line
							key={`spoke-${cue.id}`}
							x1={centerX}
							y1={centerY}
							x2={x}
							y2={y}
							stroke={mix > 0.12 ? ORANGE : LIGHT_BLUE}
							strokeWidth={mix > 0.12 ? 1.9 : 1.1}
							strokeOpacity={opacity * (0.22 + mix * 0.56)}
							strokeDasharray={mix > 0.12 ? '8 9' : '4 14'}
						/>
					);
				})}
				{cues.map((cue, index) => {
					if (cues.length < 2) return null;
					const a1 = -Math.PI / 2 + (index / total) * Math.PI * 2;
					const a2 = -Math.PI / 2 + (((index + 1) % total) / total) * Math.PI * 2;
					const r = 265 * expand;
					return (
						<line
							key={`cross-${cue.id}`}
							x1={centerX + Math.cos(a1) * r}
							y1={centerY + Math.sin(a1) * r * 0.72}
							x2={centerX + Math.cos(a2) * r}
							y2={centerY + Math.sin(a2) * r * 0.72}
							stroke="url(#wire)"
							strokeWidth={1.2}
							strokeOpacity={mix * (1 - refocus) * 0.52}
						/>
					);
				})}
			</svg>
			{cues.map((cue, index) => {
				const kind = pickIconKind(cue, index);
				const angle = -Math.PI / 2 + (index / total) * Math.PI * 2;
				const revealStart =
					durationInFrames * 0.2 + (index / total) * durationInFrames * 0.3;
				const reveal = spring({
					frame: frame - revealStart,
					fps,
					durationInFrames: 36,
					config: {damping: 200},
				});
				const active = cueIsActive(cue, frame);
				const cuePulse = active
					? clamp(frame, [cue.startFrame - 8, cue.startFrame + 12], [0, 1])
					: 0;
				const normalRadius = 265 + Math.sin(index * 1.7) * 36;
				const normalX = centerX + Math.cos(angle) * normalRadius * expand;
				const normalY = centerY + Math.sin(angle) * normalRadius * 0.72 * expand;
				const jitterX = Math.sin(frame * 0.16 + index * 2.1) * 46 * mix * (1 - refocus);
				const jitterY = Math.cos(frame * 0.13 + index * 1.4) * 34 * mix * (1 - refocus);
				const overlapX = centerX + Math.cos(angle * 4) * 48 + jitterX;
				const overlapY = centerY + Math.sin(angle * 3) * 34 + jitterY;
				const finalRadius = 175 + (index % 3) * 20;
				const finalX = centerX + Math.cos(angle) * finalRadius;
				const finalY = centerY + Math.sin(angle) * finalRadius * 0.58;
				const mixedX = normalX * (1 - mix) + overlapX * mix;
				const mixedY = normalY * (1 - mix) + overlapY * mix;
				const x = mixedX * (1 - refocus) + finalX * refocus;
				const y = mixedY * (1 - refocus) + finalY * refocus;

				const nodeStyle: React.CSSProperties = {
					position: 'absolute',
					left: x,
					top: y,
					width: 118,
					height: 118,
					marginLeft: -59,
					marginTop: -59,
					borderRadius: '50%',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					flexDirection: 'column',
					gap: 2,
					opacity: Math.min(1, reveal) * (0.72 + cuePulse * 0.28),
					transform: `scale(${0.72 + reveal * 0.28 + cuePulse * 0.14})`,
					background:
						'radial-gradient(circle at 35% 30%, rgba(147,197,253,0.34), rgba(30,58,138,0.56) 62%, rgba(2,6,23,0.72) 100%)',
					border: `1px solid ${
						active ? 'rgba(249,115,22,0.78)' : 'rgba(147,197,253,0.32)'
					}`,
					boxShadow: active
						? `0 0 34px ${ORANGE}66, 0 0 70px rgba(59,130,246,0.28)`
						: '0 0 38px rgba(59,130,246,0.18)',
					backdropFilter: `blur(${8 + mix * 8}px)`,
					filter: `blur(${mix * 1.7 * (1 - refocus)}px) saturate(${
						1 + mix * 0.55
					})`,
				};

				return (
					<div key={`node-${cue.id}`} style={nodeStyle}>
						<ScenarioIcon kind={kind} color={active ? ORANGE : '#DCEEFF'} />
						<div
							style={{
								fontSize: 11,
								fontWeight: 820,
								letterSpacing: '0.13em',
								color: active ? ORANGE : 'rgba(219,234,254,0.72)',
							}}
						>
							{iconTitle(kind)}
						</div>
					</div>
				);
			})}
		</>
	);
};

const CueIllustrations: React.FC<{cues: SegmentCue[]}> = ({cues}) => {
	const frame = useCurrentFrame();
	const {width} = useVideoConfig();

	return (
		<>
			{cues.map((cue, index) => {
				const kind = pickIconKind(cue, index);
				const fadeIn = clamp(frame, [cue.startFrame - 15, cue.startFrame + 10], [0, 1]);
				const fadeOut = clamp(frame, [cue.endFrame, cue.endFrame + 15], [1, 0]);
				const opacity = fadeIn * fadeOut;
				const side = index % 2 === 0 ? 72 : width - 472;
				const y = 78 + (index % 3) * 18;

				const style: React.CSSProperties = {
					position: 'absolute',
					left: side,
					top: y,
					width: 400,
					minHeight: 142,
					padding: '22px 24px',
					borderRadius: 26,
					background:
						'linear-gradient(135deg, rgba(15,23,42,0.74), rgba(30,58,138,0.42))',
					border: '1px solid rgba(147,197,253,0.22)',
					boxShadow: '0 24px 90px rgba(0,0,0,0.26)',
					backdropFilter: 'blur(18px)',
					opacity,
					transform: `translateY(${(1 - fadeIn) * 22}px) scale(${
						0.985 + opacity * 0.015
					})`,
					display: 'flex',
					alignItems: 'center',
					gap: 18,
				};

				return (
					<div key={`illustration-${cue.id}`} style={style}>
						<div
							style={{
								width: 92,
								height: 92,
								borderRadius: 22,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								background:
									'radial-gradient(circle at 30% 20%, rgba(249,115,22,0.24), rgba(59,130,246,0.20) 62%, rgba(2,6,23,0.44))',
								border: '1px solid rgba(249,115,22,0.35)',
							}}
						>
							<ScenarioIcon kind={kind} color={ORANGE} />
						</div>
						<div style={{flex: 1}}>
							<div
								style={{
									fontSize: 13,
									fontWeight: 900,
									letterSpacing: '0.16em',
									color: 'rgba(147,197,253,0.78)',
									marginBottom: 8,
								}}
							>
								{iconTitle(kind)}
							</div>
							<RuntimeText text={cue.text} fontSize={24} weight={760} align="left" />
						</div>
					</div>
				);
			})}
		</>
	);
};

const SeparationDiagram: React.FC<{
	cues: SegmentCue[];
	durationInFrames: number;
}> = ({cues, durationInFrames}) => {
	const frame = useCurrentFrame();
	const {width, height} = useVideoConfig();

	const opacity =
		clamp(frame, [durationInFrames * 0.5, durationInFrames * 0.56], [0, 1]) *
		clamp(frame, [durationInFrames * 0.78, durationInFrames * 0.84], [1, 0]);

	const relevant = cues.filter(
		(cue) =>
			cue.text.includes('讨论') ||
			cue.text.includes('场景') ||
			cue.text.includes('分清') ||
			cue.text.includes('实际') ||
			cue.text.includes('问题')
	);

	const split = clamp(
		frame,
		[durationInFrames * 0.54, durationInFrames * 0.66],
		[0, 1],
		Easing.inOut(Easing.sin)
	);
	const leftX = width * 0.29;
	const rightX = width * 0.71;
	const y = height * 0.57;

	return (
		<div style={{position: 'absolute', inset: 0, opacity, pointerEvents: 'none'}}>
			<svg width={width} height={height} style={{position: 'absolute', inset: 0}}>
				<line
					x1={width / 2}
					y1={height * 0.46}
					x2={width / 2}
					y2={height * 0.69}
					stroke={ORANGE}
					strokeWidth={2}
					strokeOpacity={0.55 * split}
					strokeDasharray="10 12"
				/>
				<path
					d={`M${leftX + 130},${y} C${width * 0.45},${y - 48} ${
						width * 0.55
					},${y - 48} ${rightX - 130},${y}`}
					stroke={LIGHT_BLUE}
					strokeWidth={2}
					strokeOpacity={0.32 * split}
					fill="none"
				/>
			</svg>
			<div
				style={{
					position: 'absolute',
					left: leftX,
					top: y,
					transform: `translate(-50%, -50%) translateX(${-60 * split}px)`,
					width: 320,
					padding: '26px 30px',
					borderRadius: 32,
					background: 'rgba(30,58,138,0.42)',
					border: '1px solid rgba(147,197,253,0.36)',
					boxShadow: '0 0 60px rgba(59,130,246,0.20)',
					backdropFilter: 'blur(14px)',
					textAlign: 'center',
				}}
			>
				<div
					style={{
						fontSize: 56,
						fontWeight: 930,
						color: ORANGE,
						textShadow: `0 0 22px ${ORANGE}66`,
					}}
				>
					场景
				</div>
				<div
					style={{
						marginTop: 8,
						fontSize: 18,
						fontWeight: 730,
						color: 'rgba(219,234,254,0.82)',
					}}
				>
					context first
				</div>
			</div>
			<div
				style={{
					position: 'absolute',
					left: rightX,
					top: y,
					transform: `translate(-50%, -50%) translateX(${60 * split}px)`,
					width: 320,
					padding: '26px 30px',
					borderRadius: 32,
					background: 'rgba(2,6,23,0.58)',
					border: '1px solid rgba(147,197,253,0.28)',
					boxShadow: '0 0 50px rgba(15,23,42,0.40)',
					backdropFilter: 'blur(14px)',
					textAlign: 'center',
				}}
			>
				<div
					style={{
						fontSize: 54,
						fontWeight: 930,
						color: 'rgba(238,246,255,0.94)',
						textShadow: '0 0 24px rgba(59,130,246,0.5)',
					}}
				>
					Agent
				</div>
				<div
					style={{
						marginTop: 8,
						fontSize: 18,
						fontWeight: 730,
						color: 'rgba(219,234,254,0.72)',
					}}
				>
					then evaluate
				</div>
			</div>
			<div
				style={{
					position: 'absolute',
					left: '50%',
					top: height * 0.73,
					transform: 'translateX(-50%)',
					width: 1050,
					display: 'flex',
					justifyContent: 'center',
					gap: 16,
				}}
			>
				{relevant.map((cue) => {
					const local =
						clamp(frame, [cue.startFrame - 10, cue.startFrame + 16], [0, 1]) *
						clamp(frame, [cue.endFrame + 12, cue.endFrame + 38], [1, 0]);
					return (
						<div
							key={`fragment-${cue.id}`}
							style={{
								maxWidth: 250,
								padding: '12px 16px',
								borderRadius: 18,
								background: 'rgba(15,23,42,0.58)',
								border: '1px solid rgba(147,197,253,0.20)',
								opacity: Math.max(0.16, local),
								transform: `translateY(${(1 - local) * 10}px)`,
								filter: local < 0.25 ? 'blur(1px)' : 'none',
							}}
						>
							<RuntimeText text={cue.text} fontSize={18} weight={720} />
						</div>
					);
				})}
			</div>
		</div>
	);
};

const ThesisLayer: React.FC<{
	cues: SegmentCue[];
	durationInFrames: number;
}> = ({cues, durationInFrames}) => {
	const frame = useCurrentFrame();
	const thesisCues = cues.filter(
		(cue) => cue.text.includes('先问') || cue.text.includes('再谈')
	);
	const thesisText =
		thesisCues.length > 0
			? thesisCues.map((cue) => cue.text).join('，')
			: cues.find((cue) => cue.text.includes('场景'))?.text ?? '';

	const thesisStart = thesisCues.reduce(
		(min, cue) => Math.min(min, cue.startFrame),
		durationInFrames * 0.72
	);
	const thesisEnd = thesisCues.reduce(
		(max, cue) => Math.max(max, cue.endFrame),
		thesisStart + 45
	);

	const visible =
		clamp(frame, [thesisStart - 22, thesisStart + 10], [0, 1]) *
		clamp(frame, [thesisEnd + 42, thesisEnd + 95], [1, 0]);

	const sceneActive = keywordActive(
		cues,
		frame,
		(word) => word.text === '场' || word.text === '景'
	);
	const scale = 0.94 + clamp(frame, [thesisStart - 16, thesisStart + 18], [0, 1]) * 0.06;

	return (
		<div
			style={{
				position: 'absolute',
				left: '50%',
				top: '42%',
				transform: `translate(-50%, -50%) scale(${scale})`,
				width: 1260,
				padding: '34px 44px',
				borderRadius: 34,
				background:
					'linear-gradient(135deg, rgba(2,6,23,0.22), rgba(30,58,138,0.20))',
				border: `1px solid ${
					sceneActive ? 'rgba(249,115,22,0.58)' : 'rgba(147,197,253,0.16)'
				}`,
				boxShadow: sceneActive
					? `0 0 80px ${ORANGE}33`
					: '0 0 80px rgba(59,130,246,0.14)',
				backdropFilter: 'blur(8px)',
				opacity: visible,
			}}
		>
			<RuntimeText text={thesisText} fontSize={84} weight={930} />
			<div
				style={{
					margin: '24px auto 0',
					width: 520,
					height: 3,
					borderRadius: 999,
					background: `linear-gradient(90deg, transparent, ${ORANGE}, ${LIGHT_BLUE}, transparent)`,
					opacity: 0.85,
				}}
			/>
		</div>
	);
};

const DistortionLabel: React.FC<{
	cues: SegmentCue[];
	durationInFrames: number;
}> = ({cues, durationInFrames}) => {
	const frame = useCurrentFrame();
	const distortionWord = keywordActive(
		cues,
		frame,
		(word, cue) =>
			cue.text.includes('失真') && (word.text === '失' || word.text === '真')
	);
	const distortedCue = cues.find((cue) => cue.text.includes('失真'));
	const text = distortedCue?.text ?? '';
	const phaseOpacity =
		clamp(frame, [durationInFrames * 0.79, durationInFrames * 0.84], [0, 1]) *
		clamp(frame, [durationInFrames * 0.9, durationInFrames * 0.95], [1, 0]);

	return (
		<div
			style={{
				position: 'absolute',
				left: '50%',
				top: '61%',
				transform: `translate(-50%, -50%) skewX(${
					distortionWord ? Math.sin(frame * 0.65) * 4 : 0
				}deg)`,
				opacity: phaseOpacity,
				filter: `blur(${distortionWord ? 2.8 : 0.6}px)`,
				mixBlendMode: 'screen',
			}}
		>
			<RuntimeText text={text} fontSize={58} weight={930} />
		</div>
	);
};

const FinalRefocus: React.FC<{
	cues: SegmentCue[];
	durationInFrames: number;
}> = ({cues, durationInFrames}) => {
	const frame = useCurrentFrame();
	const {width, height} = useVideoConfig();

	const finalCue =
		cues.find((cue) => cue.text.includes('解决') && cue.text.includes('场景')) ??
		cues.find((cue) => cue.text.includes('场景')) ??
		cues.reduce<SegmentCue | undefined>(
			(max, cue) => (!max || cue.endFrame > max.endFrame ? cue : max),
			undefined
		);

	const opacity = clamp(
		frame,
		[durationInFrames * 0.9, durationInFrames * 0.965],
		[0, 1],
		Easing.out(Easing.sin)
	);
	const settle = clamp(
		frame,
		[durationInFrames * 0.94, durationInFrames],
		[0, 1],
		Easing.out(Easing.sin)
	);

	return (
		<div style={{position: 'absolute', inset: 0, opacity}}>
			<svg width={width} height={height} style={{position: 'absolute', inset: 0}}>
				<defs>
					<linearGradient id="cleanLine" x1="0" x2="1" y1="0" y2="0">
						<stop offset="0%" stopColor={ORANGE} stopOpacity="0.95" />
						<stop offset="100%" stopColor={LIGHT_BLUE} stopOpacity="0.95" />
					</linearGradient>
				</defs>
				<path
					d={`M${width * 0.32},${height * 0.44} C${width * 0.42},${
						height * 0.34
					} ${width * 0.58},${height * 0.34} ${width * 0.68},${height * 0.44}`}
					stroke="url(#cleanLine)"
					strokeWidth={4}
					fill="none"
					strokeLinecap="round"
					strokeDasharray={`${settle * 520} 520`}
				/>
				<circle
					cx={width * 0.32}
					cy={height * 0.44}
					r={88 + settle * 4}
					fill="rgba(249,115,22,0.10)"
					stroke={ORANGE}
					strokeWidth={2}
				/>
				<circle
					cx={width * 0.68}
					cy={height * 0.44}
					r={88 + settle * 4}
					fill="rgba(59,130,246,0.10)"
					stroke={LIGHT_BLUE}
					strokeWidth={2}
				/>
			</svg>
			<div
				style={{
					position: 'absolute',
					left: width * 0.32,
					top: height * 0.44,
					transform: 'translate(-50%, -50%)',
					textAlign: 'center',
				}}
			>
				<div
					style={{
						fontSize: 56,
						fontWeight: 930,
						color: ORANGE,
						textShadow: `0 0 30px ${ORANGE}55`,
					}}
				>
					场景
				</div>
				<div
					style={{
						fontSize: 17,
						fontWeight: 820,
						letterSpacing: '0.15em',
						color: 'rgba(255,237,213,0.72)',
					}}
				>
					WHAT IS BEING SOLVED
				</div>
			</div>
			<div
				style={{
					position: 'absolute',
					left: width * 0.68,
					top: height * 0.44,
					transform: 'translate(-50%, -50%)',
					textAlign: 'center',
				}}
			>
				<div
					style={{
						fontSize: 54,
						fontWeight: 930,
						color: 'rgba(238,246,255,0.95)',
						textShadow: '0 0 28px rgba(59,130,246,0.55)',
					}}
				>
					Agent
				</div>
				<div
					style={{
						fontSize: 17,
						fontWeight: 820,
						letterSpacing: '0.15em',
						color: 'rgba(219,234,254,0.72)',
					}}
				>
					AFTER CONTEXT
				</div>
			</div>
			<div
				style={{
					position: 'absolute',
					left: '50%',
					top: height * 0.62,
					transform: `translate(-50%, -50%) scale(${0.96 + settle * 0.04})`,
					width: 1180,
					padding: '30px 48px',
					borderRadius: 34,
					background:
						'linear-gradient(135deg, rgba(15,23,42,0.70), rgba(30,58,138,0.34))',
					border: '1px solid rgba(249,115,22,0.34)',
					boxShadow: `0 0 70px rgba(249,115,22,${0.16 + settle * 0.14})`,
					backdropFilter: 'blur(14px)',
				}}
			>
				<RuntimeText text={finalCue?.text ?? ''} fontSize={66} weight={930} />
			</div>
		</div>
	);
};

const ThinkingPause: React.FC<{cues: SegmentCue[]}> = ({cues}) => {
	const frame = useCurrentFrame();
	const {width, height} = useVideoConfig();

	const pulse = cues.reduce((max, cue) => {
		const inPulse = clamp(frame, [cue.endFrame - 4, cue.endFrame + 15], [1, 0]);
		return Math.max(max, inPulse);
	}, 0);

	return (
		<svg
			width={width}
			height={height}
			style={{
				position: 'absolute',
				inset: 0,
				opacity: 0.22 * pulse,
				pointerEvents: 'none',
			}}
		>
			<circle
				cx={width / 2}
				cy={height * 0.42}
				r={180 + pulse * 70}
				fill="none"
				stroke={ORANGE}
				strokeWidth={2}
				strokeOpacity={0.6}
			/>
			<circle
				cx={width / 2}
				cy={height * 0.42}
				r={270 + pulse * 110}
				fill="none"
				stroke={LIGHT_BLUE}
				strokeWidth={1.4}
				strokeOpacity={0.5}
			/>
			<rect
				x={0}
				y={0}
				width={width}
				height={height}
				fill="rgba(255,255,255,0.018)"
			/>
			<text
				x={width / 2}
				y={height * 0.83}
				textAnchor="middle"
				fill="rgba(219,234,254,0.40)"
				fontSize={18}
				fontWeight={700}
				letterSpacing={6}
			>
				THINKING PAUSE
			</text>
		</svg>
	);
};

const CustomCaptions: React.FC<{cues: SegmentCue[]}> = ({cues}) => {
	const frame = useCurrentFrame();
	const activeCue = cues.find((cue) => frame >= cue.startFrame && frame <= cue.endFrame);

	if (!activeCue) return null;

	return (
		<AbsoluteFill
			style={{
				justifyContent: 'flex-end',
				alignItems: 'center',
				paddingBottom: 70,
				pointerEvents: 'none',
			}}
		>
			<div
				style={{
					maxWidth: '82%',
					padding: '15px 30px 17px',
					borderRadius: 18,
					background: 'rgba(2, 6, 23, 0.58)',
					border: '1px solid rgba(147,197,253,0.20)',
					boxShadow: '0 18px 70px rgba(0,0,0,0.35)',
					backdropFilter: 'blur(12px)',
					textAlign: 'center',
				}}
			>
				<div
					style={{
						fontSize: 36,
						fontWeight: 780,
						lineHeight: 1.42,
						letterSpacing: '0.015em',
						whiteSpace: 'pre-wrap',
						color: 'white',
						textShadow: '0 3px 16px rgba(0,0,0,0.85)',
					}}
				>
					{activeCue.words.length > 0 ? (
						activeCue.words.map((word, i) => {
							const isActive = frame >= word.startFrame && frame < word.endFrame;
							const isPast = frame >= word.endFrame;
							const isOrange =
								word.text === 'Agent' ||
								word.text === 'AI' ||
								word.text === '场' ||
								word.text === '景' ||
								word.text === '失' ||
								word.text === '真';
							const isBlue =
								word.text === '工' ||
								word.text === '具' ||
								word.text === '讨' ||
								word.text === '论' ||
								word.text === '问' ||
								word.text === '题' ||
								word.text === '解' ||
								word.text === '决';

							const activeColor = isOrange ? ORANGE : isBlue ? '#93C5FD' : '#FFFFFF';

							return (
								<span
									key={`${activeCue.id}-${word.startFrame}-${i}`}
									style={{
										color: isActive
											? activeColor
											: isPast
												? 'rgba(226,232,240,0.84)'
												: 'rgba(226,232,240,0.42)',
										textShadow: isActive
											? `0 0 18px ${
													isOrange ? ORANGE : LIGHT_BLUE
												}, 0 3px 18px rgba(0,0,0,0.9)`
											: '0 3px 14px rgba(0,0,0,0.8)',
										transform: `scale(${isActive ? 1.08 : 1})`,
										display: 'inline-block',
										margin:
											word.text === 'Agent' || word.text === 'AI' ? '0 0.13em' : 0,
									}}
								>
									{word.text}
								</span>
							);
						})
					) : (
						<RuntimeText text={activeCue.text} fontSize={36} weight={780} />
					)}
				</div>
			</div>
		</AbsoluteFill>
	);
};

export const Scene1Generated: React.FC<{
	cues: SegmentCue[];
	durationInFrames: number;
}> = ({cues, durationInFrames}) => {
	const {frame, progress, at} = useSceneProgress(durationInFrames);
	const activeCue = cues.find((cue) => frame >= cue.startFrame && frame <= cue.endFrame);

	const agentActive = keywordActive(cues, frame, (word) => word.text === 'Agent');
	const aiActive = keywordActive(cues, frame, (word) => word.text === 'AI');
	const sceneWordActive = keywordActive(
		cues,
		frame,
		(word) => word.text === '场' || word.text === '景'
	);
	const distortionActive = keywordActive(
		cues,
		frame,
		(word, cue) =>
			cue.text.includes('失真') && (word.text === '失' || word.text === '真')
	);

	const endPulse = cues.reduce((max, cue) => {
		const p = clamp(frame, [cue.endFrame - 8, cue.endFrame + 15], [0, 1]);
		const out = clamp(frame, [cue.endFrame + 15, cue.endFrame + 30], [1, 0]);
		return Math.max(max, p * out);
	}, 0);

	const cameraScale =
		1 +
		progress * 0.018 +
		endPulse * 0.018 +
		(agentActive || aiActive || sceneWordActive ? 0.012 : 0) +
		(distortionActive ? Math.sin(frame * 0.7) * 0.008 : 0);

	const blur = at(0.8, 0.88, 2.2) * (1 - at(0.9, 0.98, 1)) + (distortionActive ? 2.4 : 0);

	const cameraStyle: React.CSSProperties = {
		position: 'absolute',
		inset: 0,
		transform: `scale(${cameraScale})`,
		transformOrigin: '50% 42%',
		filter: `blur(${blur}px)`,
	};

	return (
		<AbsoluteFill
			style={{
				background: NIGHT,
				overflow: 'hidden',
				fontFamily:
					'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
			}}
		>
			<CityBackground durationInFrames={durationInFrames} />
			<div style={cameraStyle}>
				<OrbitSystem cues={cues} durationInFrames={durationInFrames} />
				<CoreAgent cues={cues} durationInFrames={durationInFrames} />
				<SeparationDiagram cues={cues} durationInFrames={durationInFrames} />
				<ThesisLayer cues={cues} durationInFrames={durationInFrames} />
				<DistortionLabel cues={cues} durationInFrames={durationInFrames} />
				<FinalRefocus cues={cues} durationInFrames={durationInFrames} />
				<CueIllustrations cues={cues} />
				<ThinkingPause cues={cues} />
			</div>

			<div
				style={{
					position: 'absolute',
					left: 0,
					right: 0,
					top: 0,
					height: 120,
					background:
						'linear-gradient(180deg, rgba(2,6,23,0.58), rgba(2,6,23,0))',
					pointerEvents: 'none',
				}}
			/>
			<div
				style={{
					position: 'absolute',
					left: 50,
					top: 42,
					display: 'flex',
					alignItems: 'center',
					gap: 14,
					opacity: 0.72,
				}}
			>
				<div
					style={{
						width: 12,
						height: 12,
						borderRadius: 99,
						background: activeCue
							? activeCue.text.includes('场景')
								? ORANGE
								: LIGHT_BLUE
							: 'rgba(147,197,253,0.7)',
						boxShadow: activeCue?.text.includes('场景')
							? `0 0 18px ${ORANGE}`
							: `0 0 18px ${LIGHT_BLUE}`,
					}}
				/>
				<div
					style={{
						fontSize: 15,
						fontWeight: 820,
						letterSpacing: '0.2em',
						color: 'rgba(219,234,254,0.70)',
					}}
				>
					SCENARIO ANALYSIS
				</div>
			</div>
			<div
				style={{
					position: 'absolute',
					right: 52,
					top: 36,
					width: 230,
					height: 40,
					opacity: 0.58,
				}}
			>
				{Array.from({length: 18}, (_, i) => (
					<div
						key={i}
						style={{
							position: 'absolute',
							bottom: 0,
							left: i * 13,
							width: 4,
							height:
								8 + Math.abs(Math.sin(frame * 0.035 + i * 0.75)) * (18 + (i % 5) * 3),
							borderRadius: 999,
							background:
								i % 5 === 0 ? 'rgba(249,115,22,0.78)' : 'rgba(147,197,253,0.62)',
							boxShadow:
								i % 5 === 0 ? `0 0 12px ${ORANGE}66` : `0 0 10px ${LIGHT_BLUE}44`,
						}}
					/>
				))}
			</div>
			<div
				style={{
					position: 'absolute',
					left: 0,
					right: 0,
					bottom: 0,
					height: 230,
					background:
						'linear-gradient(0deg, rgba(2,6,23,0.92), rgba(2,6,23,0.42) 58%, rgba(2,6,23,0))',
					pointerEvents: 'none',
				}}
			/>
			<CustomCaptions cues={cues} />
		</AbsoluteFill>
	);
};
