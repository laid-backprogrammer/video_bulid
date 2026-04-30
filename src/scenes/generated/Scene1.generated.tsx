import React from 'react';
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

const FONT_STACK =
	'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

const safeInputRange = (points: number[]) =>
	points.reduce<number[]>((safe, point, index) => {
		const finitePoint = Number.isFinite(point) ? point : 0;
		if (index === 0) return [finitePoint];
		const previous = safe[index - 1];
		safe.push(finitePoint > previous ? finitePoint : previous + 1);
		return safe;
	}, []);

const safeInterpolate = (
	frame: number,
	input: number[],
	output: number[],
	options?: {
		easing?: (input: number) => number;
	}
) =>
	interpolate(frame, safeInputRange(input), output, {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
		...(options?.easing ? {easing: options.easing} : {}),
	});

const clampFrame = (value: number, durationInFrames: number) => {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, Math.min(Math.max(1, durationInFrames), value));
};

const getAllWords = (cues: SegmentCue[]) =>
	cues.reduce<Array<WordCue & {cueId: string}>>((acc, cue) => {
		cue.words.forEach((word) => acc.push({...word, cueId: cue.id}));
		return acc;
	}, []);

const findWord = (
	words: Array<WordCue & {cueId: string}>,
	predicate: (text: string) => boolean
) => words.find((word) => predicate(word.text));

const TechTexture: React.FC<{
	frame: number;
	width: number;
	height: number;
	assemble: number;
	emphasis: number;
}> = ({frame, width, height, assemble, emphasis}) => {
	const gridShift = (frame * 0.34) % 64;
	const scanY = ((frame * 9) % (height + 240)) - 120;
	const cx = width / 2;
	const cy = height * 0.43;

	const tickCount = 48;
	const dotCount = 86;
	const interfaceLines = 18;

	return (
		<>
			<div
				style={{
					position: 'absolute',
					inset: 0,
					opacity: 0.2 + assemble * 0.16,
					backgroundImage:
						'linear-gradient(rgba(51,214,255,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(91,124,255,0.05) 1px, transparent 1px)',
					backgroundSize: '64px 64px',
					backgroundPosition: `0px ${-gridShift}px`,
					maskImage:
						'radial-gradient(ellipse at center, black 0%, black 48%, transparent 82%)',
				}}
			/>
			<div
				style={{
					position: 'absolute',
					inset: 0,
					opacity: 0.08,
					backgroundImage:
						'linear-gradient(rgba(255,255,255,0.18) 1px, transparent 1px)',
					backgroundSize: '100% 7px',
					transform: `translateY(${frame * 0.18}px)`,
				}}
			/>
			<div
				style={{
					position: 'absolute',
					left: 0,
					top: scanY,
					width: '100%',
					height: 160,
					opacity: 0.13 + emphasis * 0.18,
					background:
						'linear-gradient(180deg, transparent 0%, rgba(51,214,255,0.18) 48%, rgba(154,92,255,0.13) 52%, transparent 100%)',
					filter: 'blur(10px)',
				}}
			/>
			{Array.from({length: dotCount}).map((_, i) => {
				const col = i % 14;
				const row = Math.floor(i / 14);
				const x = width * 0.08 + col * (width * 0.84 / 13);
				const y = height * 0.17 + row * 52 + Math.sin(frame * 0.035 + i) * 2;
				const dist = Math.hypot(x - cx, y - cy);
				const glow = Math.max(0, 1 - dist / (width * 0.48));
				return (
					<div
						key={`dot-${i}`}
						style={{
							position: 'absolute',
							left: x,
							top: y,
							width: 2 + glow * 2.4,
							height: 2 + glow * 2.4,
							borderRadius: 999,
							background: i % 5 === 0 ? '#33D6FF' : '#8EA2FF',
							opacity: (0.08 + glow * 0.18) * assemble,
							boxShadow:
								i % 5 === 0
									? '0 0 12px rgba(51,214,255,0.45)'
									: '0 0 10px rgba(142,162,255,0.35)',
						}}
					/>
				);
			})}
			<svg
				width={width}
				height={height}
				viewBox={`0 0 ${width} ${height}`}
				style={{
					position: 'absolute',
					inset: 0,
					opacity: 0.78,
				}}
			>
				<defs>
					<linearGradient id="scene1-ring" x1="0%" y1="0%" x2="100%" y2="0%">
						<stop offset="0%" stopColor="#33D6FF" stopOpacity="0" />
						<stop offset="34%" stopColor="#5B7CFF" stopOpacity="0.42" />
						<stop offset="70%" stopColor="#9A5CFF" stopOpacity="0.38" />
						<stop offset="100%" stopColor="#33D6FF" stopOpacity="0" />
					</linearGradient>
					<linearGradient id="scene1-line" x1="0%" y1="0%" x2="100%" y2="0%">
						<stop offset="0%" stopColor="#5B7CFF" stopOpacity="0" />
						<stop offset="50%" stopColor="#33D6FF" stopOpacity="0.56" />
						<stop offset="100%" stopColor="#9A5CFF" stopOpacity="0" />
					</linearGradient>
				</defs>

				{[0, 1, 2].map((ring) => {
					const radius = 185 + ring * 72 + assemble * 16;
					const dash = `${120 + ring * 32} ${80 + ring * 20}`;
					const rotation = frame * (0.22 + ring * 0.04) * (ring % 2 === 0 ? 1 : -1);
					return (
						<ellipse
							key={`ring-${ring}`}
							cx={cx}
							cy={cy}
							rx={radius * 1.64}
							ry={radius * 0.42}
							fill="none"
							stroke="url(#scene1-ring)"
							strokeWidth={1.2}
							strokeDasharray={dash}
							strokeDashoffset={-frame * (1.8 + ring * 0.6)}
							transform={`rotate(${rotation} ${cx} ${cy})`}
							opacity={(0.22 + ring * 0.06 + emphasis * 0.12) * assemble}
						/>
					);
				})}

				{Array.from({length: interfaceLines}).map((_, i) => {
					const side = i % 2 === 0 ? -1 : 1;
					const y = height * (0.18 + (i % 9) * 0.062);
					const inner = cx + side * (230 + (i % 3) * 42);
					const outer = cx + side * (500 + (i % 4) * 38);
					const drift = Math.sin(frame * 0.045 + i) * 10;
					const reveal = assemble * (0.55 + (i % 5) * 0.08);
					return (
						<g key={`line-${i}`} opacity={0.24 * reveal}>
							<path
								d={`M ${outer + side * drift} ${y} L ${inner + side * drift} ${
									y + side * 10
								} L ${inner - side * 54 + side * drift} ${y + side * 10}`}
								stroke="url(#scene1-line)"
								strokeWidth="1"
								fill="none"
							/>
							<circle
								cx={inner + side * drift}
								cy={y + side * 10}
								r="2.4"
								fill={i % 3 === 0 ? '#33D6FF' : '#8EA2FF'}
								opacity={0.55}
							/>
						</g>
					);
				})}

				{Array.from({length: tickCount}).map((_, i) => {
					const angle = (Math.PI * 2 * i) / tickCount + frame * 0.004;
					const r1 = 360;
					const r2 = i % 4 === 0 ? 382 : 373;
					const x1 = cx + Math.cos(angle) * r1;
					const y1 = cy + Math.sin(angle) * r1 * 0.42;
					const x2 = cx + Math.cos(angle) * r2;
					const y2 = cy + Math.sin(angle) * r2 * 0.42;
					return (
						<line
							key={`tick-${i}`}
							x1={x1}
							y1={y1}
							x2={x2}
							y2={y2}
							stroke={i % 6 === 0 ? '#33D6FF' : '#5B7CFF'}
							strokeWidth={i % 6 === 0 ? 1.4 : 0.8}
							opacity={(i % 6 === 0 ? 0.32 : 0.16) * assemble + emphasis * 0.08}
						/>
					);
				})}
			</svg>
		</>
	);
};

const LaunchPanels: React.FC<{
	frame: number;
	width: number;
	height: number;
	assemble: number;
	emphasis: number;
}> = ({frame, width, height, assemble, emphasis}) => {
	const centerX = width / 2;
	const centerY = height * 0.43;
	const panelW = width * 0.22;
	const panelH = height * 0.18;

	return (
		<>
			{[-1, 1].map((side) => {
				const x =
					centerX +
					side *
						(width * 0.24 -
							safeInterpolate(assemble, [0, 1], [48, 0], {
								easing: Easing.out(Easing.cubic),
							}));
				const y = centerY + side * 22 + Math.sin(frame * 0.05 + side) * 4;
				const rotate = side * (7 - assemble * 4);
				return (
					<div
						key={`launch-panel-${side}`}
						style={{
							position: 'absolute',
							left: x - panelW / 2,
							top: y - panelH / 2,
							width: panelW,
							height: panelH,
							opacity: 0.24 * assemble,
							transform: `rotate(${rotate}deg) skewX(${side * -7}deg)`,
							borderRadius: 20,
							border: '1px solid rgba(142,162,255,0.28)',
							background:
								side < 0
									? 'linear-gradient(135deg, rgba(11,27,61,0.72), rgba(91,124,255,0.08))'
									: 'linear-gradient(135deg, rgba(26,15,53,0.72), rgba(154,92,255,0.10))',
							boxShadow: `inset 0 0 28px rgba(91,124,255,0.10), 0 0 ${
								28 + emphasis * 22
							}px rgba(91,124,255,${0.08 + emphasis * 0.05})`,
							overflow: 'hidden',
						}}
					>
						<div
							style={{
								position: 'absolute',
								inset: 18,
								borderRadius: 14,
								border: '1px solid rgba(51,214,255,0.16)',
							}}
						/>
						{Array.from({length: 5}).map((_, i) => (
							<div
								key={`panel-line-${i}`}
								style={{
									position: 'absolute',
									left: 24,
									right: 24 + i * 18,
									top: 28 + i * 18,
									height: 2,
									borderRadius: 999,
									background:
										i % 2 === 0
											? 'rgba(51,214,255,0.38)'
											: 'rgba(142,162,255,0.28)',
									opacity: 0.35 + i * 0.08,
								}}
							/>
						))}
						<div
							style={{
								position: 'absolute',
								left: `${-120 + emphasis * 230}%`,
								top: -20,
								width: '35%',
								height: '140%',
								opacity: emphasis,
								background:
									'linear-gradient(90deg, transparent, rgba(255,255,255,0.28), transparent)',
								transform: 'skewX(-22deg)',
							}}
						/>
					</div>
				);
			})}
		</>
	);
};

const WordSubtitle: React.FC<{
	cues: SegmentCue[];
	frame: number;
}> = ({cues, frame}) => {
	const activeCue = cues.find(
		(cue) => frame >= cue.startFrame && frame < cue.endFrame
	);

	if (!activeCue) {
		return null;
	}

	const words =
		activeCue.words.length > 0
			? activeCue.words
			: [{text: activeCue.text, startFrame: activeCue.startFrame, endFrame: activeCue.endFrame}];

	return (
		<div
			style={{
				position: 'absolute',
				left: '50%',
				top: '86%',
				transform: 'translate(-50%, -50%)',
				maxWidth: '86%',
				display: 'flex',
				justifyContent: 'center',
				alignItems: 'center',
				flexWrap: 'wrap',
				gap: 3,
				padding: '10px 18px',
				borderRadius: 18,
				background: 'rgba(7,10,22,0.28)',
				backdropFilter: 'blur(10px)',
				border: '1px solid rgba(142,162,255,0.10)',
				boxShadow: '0 18px 46px rgba(0,0,0,0.22)',
				fontFamily: FONT_STACK,
			}}
		>
			{words.map((word, index) => {
				const isActive = frame >= word.startFrame && frame < word.endFrame;
				const isPast = frame >= word.endFrame;
				const wordPop = isActive
					? safeInterpolate(
							frame,
							[word.startFrame, Math.min(word.endFrame, word.startFrame + 5)],
							[0, 1],
							{easing: Easing.out(Easing.cubic)}
						)
					: 0;

				return (
					<span
						key={`${activeCue.id}-${word.text}-${index}`}
						style={{
							display: 'inline-block',
							padding: isActive ? '4px 10px 6px' : '4px 4px 6px',
							borderRadius: 12,
							fontSize: 40,
							lineHeight: 1.15,
							fontWeight: 650,
							letterSpacing: '0.02em',
							color: isActive
								? '#FFFFFF'
								: isPast
									? 'rgba(255,255,255,0.72)'
									: 'rgba(255,255,255,0.48)',
							background: isActive ? 'rgba(91,124,255,0.22)' : 'transparent',
							boxShadow: isActive
								? `0 0 ${14 + wordPop * 14}px rgba(91,124,255,0.24)`
								: 'none',
							transform: `translateY(${isActive ? -1.5 * wordPop : 0}px)`,
						}}
					>
						{word.text}
					</span>
				);
			})}
		</div>
	);
};

export const Scene1Generated: React.FC<{
	cues: SegmentCue[];
	durationInFrames: number;
	assets?: SceneAsset[];
}> = ({cues, durationInFrames, assets = []}) => {
	void assets;

	const frame = useCurrentFrame();
	const {fps, width, height} = useVideoConfig();
	const {progress} = useSceneProgress(durationInFrames);

	const allText = cues.map((cue) => cue.text).filter(Boolean).join('');
	const allWords = getAllWords(cues);
	const activeCue =
		cues.find((cue) => frame >= cue.startFrame && frame < cue.endFrame) ?? cues[0];
	const headline = activeCue?.text || allText || '';

	const openingWord = findWord(allWords, (text) => text.includes('这是')) ?? allWords[0];
	const readableWord = findWord(allWords, (text) => text.includes('这个')) ?? allWords[1];
	const accountWord = findWord(allWords, (text) => text.includes('账号')) ?? allWords[2];
	const firstMomentWord =
		findWord(allWords, (text) => text.includes('的第') || text.includes('第')) ??
		allWords[Math.max(0, allWords.length - 2)];
	const finalWord =
		findWord(allWords, (text) => text.includes('一条') || text.includes('视频')) ??
		allWords[allWords.length - 1];

	const d = Math.max(1, durationInFrames);
	const openingStart = clampFrame(openingWord?.startFrame ?? 0, d);
	const openingEnd = clampFrame(openingWord?.endFrame ?? d * 0.19, d);
	const titleStart = clampFrame(
		Math.min(readableWord?.startFrame ?? d * 0.19, d * 0.123),
		d
	);
	const titleEnd = clampFrame(Math.max(titleStart + 1, d * 0.247), d);
	const stableStart = clampFrame(accountWord?.startFrame ?? d * 0.397, d);
	const underlineStart = clampFrame(firstMomentWord?.startFrame ?? d * 0.589, d);
	const underlineEnd = clampFrame(firstMomentWord?.endFrame ?? d * 0.795, d);
	const finalStart = clampFrame(finalWord?.startFrame ?? d * 0.795, d);
	const settleStart = clampFrame(Math.max(finalStart + 1, d - 5), d);

	const blackFade = safeInterpolate(frame, [0, Math.min(9, d * 0.123)], [1, 0], {
		easing: Easing.out(Easing.cubic),
	});
	const glowIgnition = safeInterpolate(frame, [openingStart, openingEnd], [0, 1], {
		easing: Easing.out(Easing.cubic),
	});
	const assemble = safeInterpolate(frame, [0, Math.min(18, d * 0.247)], [0, 1], {
		easing: Easing.out(Easing.cubic),
	});
	const titleIn = safeInterpolate(frame, [titleStart, titleEnd], [0, 1], {
		easing: Easing.out(Easing.cubic),
	});
	const capsuleIn = safeInterpolate(
		frame,
		[Math.max(0, titleStart - 4), Math.max(1, titleEnd - 2)],
		[0, 1],
		{easing: Easing.out(Easing.cubic)}
	);
	const underline = safeInterpolate(frame, [underlineStart, underlineEnd], [0, 1], {
		easing: Easing.out(Easing.cubic),
	});
	const finalLock = safeInterpolate(frame, [finalStart, settleStart], [0, 1], {
		easing: Easing.out(Easing.cubic),
	});

	const titleSpring = spring({
		frame: frame - titleStart,
		fps,
		config: {damping: 190, stiffness: 130},
		durationInFrames: Math.max(8, titleEnd - titleStart + 8),
	});

	const breathe =
		0.5 +
		0.5 * Math.sin(frame * 0.075 + safeInterpolate(frame, [stableStart, d], [0, 0.8]));
	const titleScale = 0.96 + Math.min(1, titleSpring) * 0.04 + finalLock * 0.035;
	const titleY = (1 - titleIn) * 24 - finalLock * 2;
	const glowOpacity = 0.28 + glowIgnition * 0.5 + finalLock * 0.22;
	const emphasisSweep = underline * (1 - safeInterpolate(frame, [underlineEnd, underlineEnd + 8], [0, 1]));

	const containerStyle: React.CSSProperties = {
		background:
			'radial-gradient(circle at 50% 43%, rgba(91,124,255,0.18) 0%, rgba(91,124,255,0.05) 25%, transparent 48%), linear-gradient(115deg, #0B1B3D 0%, #070A16 46%, #1A0F35 100%)',
		overflow: 'hidden',
		color: '#F5F7FF',
		fontFamily: FONT_STACK,
	};

	return (
		<AbsoluteFill style={containerStyle}>
			<div
				style={{
					position: 'absolute',
					inset: 0,
					background:
						'radial-gradient(circle at 18% 38%, rgba(51,214,255,0.11), transparent 34%), radial-gradient(circle at 82% 34%, rgba(154,92,255,0.13), transparent 36%), #070A16',
				}}
			/>
			<div
				style={{
					position: 'absolute',
					left: '50%',
					top: '42%',
					width: 620 + glowIgnition * 260 + finalLock * 120,
					height: 360 + glowIgnition * 150 + finalLock * 80,
					transform: `translate(-50%, -50%) scale(${0.82 + glowIgnition * 0.26})`,
					borderRadius: '50%',
					opacity: glowOpacity,
					background:
						'radial-gradient(ellipse at center, rgba(51,214,255,0.38) 0%, rgba(91,124,255,0.24) 25%, rgba(154,92,255,0.13) 52%, transparent 72%)',
					filter: 'blur(28px)',
				}}
			/>
			<TechTexture
				frame={frame}
				width={width}
				height={height}
				assemble={assemble}
				emphasis={underline}
			/>
			<LaunchPanels
				frame={frame}
				width={width}
				height={height}
				assemble={assemble}
				emphasis={emphasisSweep}
			/>

			<div
				style={{
					position: 'absolute',
					left: '50%',
					top: '34%',
					transform: `translate(-50%, ${12 - capsuleIn * 12}px) scale(${
						0.96 + capsuleIn * 0.04
					})`,
					opacity: capsuleIn,
					padding: '9px 22px 10px',
					borderRadius: 999,
					background:
						'linear-gradient(90deg, rgba(91,124,255,0.16), rgba(154,92,255,0.14))',
					border: '1px solid rgba(142,162,255,0.34)',
					boxShadow: '0 0 30px rgba(91,124,255,0.18), inset 0 0 18px rgba(51,214,255,0.08)',
					color: '#8EA2FF',
					fontSize: 20,
					fontWeight: 750,
					letterSpacing: '0.18em',
					lineHeight: 1,
				}}
			>
				FIRST VIDEO
			</div>

			<div
				style={{
					position: 'absolute',
					left: '50%',
					top: '42%',
					width: '92%',
					transform: `translate(-50%, calc(-50% + ${titleY}px)) scale(${titleScale})`,
					opacity: titleIn,
					textAlign: 'center',
					fontSize: Math.min(76, Math.max(58, width * 0.048)),
					fontWeight: 760,
					lineHeight: 1.16,
					letterSpacing: '0.035em',
					color: '#F5F7FF',
					textShadow: `0 0 ${18 + breathe * 12 + finalLock * 18}px rgba(91,124,255,${
						0.28 + breathe * 0.12 + finalLock * 0.12
					}), 0 0 ${46 + finalLock * 30}px rgba(154,92,255,${
						0.18 + finalLock * 0.12
					})`,
				}}
			>
				{headline}
			</div>

			<div
				style={{
					position: 'absolute',
					left: '50%',
					top: '49.7%',
					width: `${underline * 42}%`,
					maxWidth: 540,
					height: 3,
					transform: 'translateX(-50%)',
					opacity: underline * 0.86,
					borderRadius: 999,
					background:
						'linear-gradient(90deg, transparent 0%, #5B7CFF 17%, #33D6FF 50%, #9A5CFF 83%, transparent 100%)',
					boxShadow: `0 0 ${18 + underline * 22}px rgba(91,124,255,0.58), 0 0 ${
						32 + underline * 30
					}px rgba(51,214,255,0.26)`,
				}}
			/>
			<div
				style={{
					position: 'absolute',
					left: `${-15 + emphasisSweep * 130}%`,
					top: '24%',
					width: '16%',
					height: '40%',
					opacity: emphasisSweep * 0.42,
					transform: 'skewX(-18deg)',
					background:
						'linear-gradient(90deg, transparent, rgba(51,214,255,0.22), rgba(255,255,255,0.16), transparent)',
					filter: 'blur(8px)',
				}}
			/>

			<div
				style={{
					position: 'absolute',
					inset: 0,
					background:
						'linear-gradient(180deg, rgba(7,10,22,0.18) 0%, transparent 34%, transparent 66%, rgba(7,10,22,0.34) 100%)',
					pointerEvents: 'none',
				}}
			/>
			<WordSubtitle cues={cues} frame={frame} />

			<div
				style={{
					position: 'absolute',
					inset: 0,
					background: '#000000',
					opacity: blackFade,
					pointerEvents: 'none',
				}}
			/>
			<div
				style={{
					position: 'absolute',
					inset: 0,
					opacity: 0.06 + progress * 0.02,
					background:
						'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.18) 50%, transparent 100%)',
					transform: `translateX(${-70 + progress * 140}%) skewX(-18deg)`,
					pointerEvents: 'none',
				}}
			/>
		</AbsoluteFill>
	);
};
