import React, {useMemo} from 'react';
import {
	AbsoluteFill,
	Easing,
	Img,
	interpolate,
	staticFile,
	useVideoConfig,
} from 'remotion';
import type {SceneAsset, SegmentCue, WordCue} from '../../types';
import {useSceneProgress} from '../../hooks/useSceneProgress';

const clampInterpolate = (
	frame: number,
	input: [number, number],
	output: [number, number],
	easing?: (value: number) => number,
) =>
	interpolate(frame, input, output, {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
		easing,
	});

const resolveAssetPath = (asset: SceneAsset) =>
	asset.file.replace(/^public[\\/]/, '').replace(/\\/g, '/');

const getAllWords = (cues: SegmentCue[]): WordCue[] =>
	cues.reduce<WordCue[]>((acc, cue) => {
		if (cue.words.length > 0) {
			return [...acc, ...cue.words];
		}
		return [
			...acc,
			{
				text: cue.text,
				startFrame: cue.startFrame,
				endFrame: cue.endFrame,
			},
		];
	}, []);

const ParticleField: React.FC<{
	opacity: number;
	durationInFrames: number;
}> = ({opacity, durationInFrames}) => {
	const {width, height} = useVideoConfig();
	const {frame} = useSceneProgress(durationInFrames);

	const particles = useMemo(
		() =>
			Array.from({length: 42}, (_, index) => {
				const a = Math.sin(index * 12.9898) * 43758.5453;
				const b = Math.sin(index * 78.233) * 24634.6345;
				const c = Math.sin(index * 37.719) * 9821.123;
				const randomA = a - Math.floor(a);
				const randomB = b - Math.floor(b);
				const randomC = c - Math.floor(c);
				return {
					x: randomA,
					y: randomB,
					size: 1.2 + randomC * 3.2,
					driftX: -0.16 + randomB * 0.32,
					driftY: -0.11 + randomA * 0.22,
					alpha: 0.16 + randomC * 0.42,
				};
			}),
		[],
	);

	return (
		<AbsoluteFill style={{opacity, pointerEvents: 'none'}}>
			{particles.map((particle, index) => {
				const left = (particle.x * width + frame * particle.driftX + width) % width;
				const top = (particle.y * height + frame * particle.driftY + height) % height;
				return (
					<div
						key={index}
						style={{
							position: 'absolute',
							left,
							top,
							width: particle.size,
							height: particle.size,
							borderRadius: '50%',
							background: 'rgba(125, 183, 255, 0.86)',
							opacity: particle.alpha,
							boxShadow: `0 0 ${particle.size * 7}px rgba(125, 183, 255, 0.45)`,
						}}
					/>
				);
			})}
		</AbsoluteFill>
	);
};

const TechGrid: React.FC<{opacity: number; durationInFrames: number}> = ({
	opacity,
	durationInFrames,
}) => {
	const {frame} = useSceneProgress(durationInFrames);
	const drift = frame * 0.055;

	return (
		<AbsoluteFill style={{opacity, pointerEvents: 'none'}}>
			<svg width="100%" height="100%" viewBox="0 0 1920 1080" preserveAspectRatio="none">
				<g transform={`translate(${drift % 72} ${(drift * 0.45) % 72})`}>
					{Array.from({length: 30}, (_, i) => (
						<line
							key={`v-${i}`}
							x1={i * 72 - 72}
							y1={0}
							x2={i * 72 - 72}
							y2={1080}
							stroke="rgba(125,183,255,0.12)"
							strokeWidth="1"
						/>
					))}
					{Array.from({length: 18}, (_, i) => (
						<line
							key={`h-${i}`}
							x1={0}
							y1={i * 72 - 72}
							x2={1920}
							y2={i * 72 - 72}
							stroke="rgba(125,183,255,0.09)"
							strokeWidth="1"
						/>
					))}
				</g>
				<path
					d="M210 820 C520 690 720 760 1040 620 C1270 520 1470 560 1730 430"
					fill="none"
					stroke="rgba(125,183,255,0.10)"
					strokeWidth="2"
				/>
				<path
					d="M70 310 C390 220 640 280 930 190 C1220 100 1450 180 1810 92"
					fill="none"
					stroke="rgba(166,95,255,0.08)"
					strokeWidth="2"
				/>
			</svg>
		</AbsoluteFill>
	);
};

const WordPips: React.FC<{
	words: WordCue[];
	durationInFrames: number;
}> = ({words, durationInFrames}) => {
	const {frame} = useSceneProgress(durationInFrames);
	if (words.length === 0) {
		return null;
	}

	return (
		<div
			style={{
				position: 'absolute',
				left: 32,
				right: 32,
				top: 18,
				height: 4,
				display: 'flex',
				gap: 8,
				pointerEvents: 'none',
			}}
		>
			{words.map((word, index) => {
				const active =
					frame >= word.startFrame &&
					(frame < word.endFrame || (index === words.length - 1 && frame <= word.endFrame));
				const past = frame >= word.endFrame;
				const localPulse = active
					? clampInterpolate(
							frame,
							[word.startFrame, Math.max(word.startFrame + 1, word.endFrame)],
							[0.55, 1],
							Easing.out(Easing.quad),
						)
					: 0;
				return (
					<div
						key={`${word.text}-${word.startFrame}-${index}`}
						style={{
							flex: 1,
							borderRadius: 999,
							background: active
								? '#7DB7FF'
								: past
									? 'rgba(125,183,255,0.38)'
									: 'rgba(245,248,255,0.14)',
							opacity: active ? 0.95 : past ? 0.55 : 0.32,
							boxShadow: active
								? `0 0 ${10 + localPulse * 16}px rgba(125,183,255,0.70)`
								: 'none',
							transform: `scaleY(${active ? 1.7 : 1})`,
						}}
					/>
				);
			})}
		</div>
	);
};

const CustomCaption: React.FC<{
	cues: SegmentCue[];
	durationInFrames: number;
}> = ({cues, durationInFrames}) => {
	const {frame} = useSceneProgress(durationInFrames);
	const activeCue = cues.find(
		(cue) => frame >= cue.startFrame && (frame < cue.endFrame || frame === durationInFrames - 1),
	);

	if (!activeCue) {
		return null;
	}

	const words =
		activeCue.words.length > 0
			? activeCue.words
			: [
					{
						text: activeCue.text,
						startFrame: activeCue.startFrame,
						endFrame: activeCue.endFrame,
					},
				];

	return (
		<AbsoluteFill
			style={{
				justifyContent: 'flex-end',
				alignItems: 'center',
				paddingBottom: 90,
				pointerEvents: 'none',
			}}
		>
			<div
				style={{
					maxWidth: '78%',
					padding: '18px 30px',
					borderRadius: 18,
					background: 'rgba(5, 10, 25, 0.46)',
					backdropFilter: 'blur(12px)',
					boxShadow: '0 18px 44px rgba(0,0,0,0.28), inset 0 0 0 1px rgba(125,183,255,0.13)',
					textAlign: 'center',
					whiteSpace: 'nowrap',
				}}
			>
				<div
					style={{
						fontFamily:
							'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
						fontSize: 48,
						fontWeight: 600,
						lineHeight: 1.2,
						letterSpacing: '0.02em',
						color: '#FFFFFF',
					}}
				>
					{words.map((word, index) => {
						const isActive =
							frame >= word.startFrame &&
							(frame < word.endFrame || (index === words.length - 1 && frame <= word.endFrame));
						const activeBump = isActive
							? clampInterpolate(
									frame,
									[word.startFrame, Math.min(word.endFrame, word.startFrame + 5)],
									[1.04, 1],
									Easing.out(Easing.quad),
								)
							: 1;
						return (
							<span
								key={`${word.text}-${word.startFrame}-${index}`}
								style={{
									display: 'inline-block',
									color: isActive ? '#7DB7FF' : '#FFFFFF',
									textShadow: isActive ? '0 0 18px rgba(125,183,255,0.55)' : 'none',
									transform: `scale(${activeBump})`,
								}}
							>
								{word.text}
							</span>
						);
					})}
				</div>
			</div>
		</AbsoluteFill>
	);
};

export const Scene1Generated: React.FC<{
	cues: SegmentCue[];
	durationInFrames: number;
	assets?: SceneAsset[];
}> = ({cues, durationInFrames, assets}) => {
	const {frame} = useSceneProgress(durationInFrames);

	const allWords = useMemo(() => getAllWords(cues), [cues]);
	const titleText = useMemo(() => {
		if (allWords.length > 1) {
			const start = Math.max(1, Math.floor(allWords.length * 0.24));
			return allWords
				.slice(start)
				.map((word) => word.text)
				.join('');
		}
		return cues.map((cue) => cue.text).join('');
	}, [allWords, cues]);

	const renderAsset = assets?.find((asset) => asset.role === 'render' || asset.role === 'both');

	const bgFade = clampInterpolate(frame, [0, (15 / 114) * durationInFrames], [0, 1]);
	const bgScale = clampInterpolate(frame, [0, (15 / 114) * durationInFrames], [1.04, 1]);
	const gridOpacity = clampInterpolate(frame, [0, (15 / 114) * durationInFrames], [0, 0.35]);

	const glowExpand = clampInterpolate(
		frame,
		[0, (15 / 114) * durationInFrames],
		[0.72, 1],
		Easing.out(Easing.quad),
	);
	const focusGlowBoost = clampInterpolate(
		frame,
		[(36 / 114) * durationInFrames, (66 / 114) * durationInFrames],
		[1, 1.1],
		Easing.out(Easing.quad),
	);
	const glowHold = clampInterpolate(
		frame,
		[(97 / 114) * durationInFrames, durationInFrames],
		[1, 0.72],
		Easing.out(Easing.quad),
	);

	const revealStart = (15 / 114) * durationInFrames;
	const revealEnd = (36 / 114) * durationInFrames;
	const productOpacity = clampInterpolate(frame, [revealStart, revealEnd], [0, 1], Easing.out(Easing.quad));
	const productTranslateY = clampInterpolate(
		frame,
		[revealStart, revealEnd],
		[42, 0],
		Easing.out(Easing.cubic),
	);
	const productRevealScale = clampInterpolate(
		frame,
		[revealStart, revealEnd],
		[0.94, 1],
		Easing.out(Easing.cubic),
	);
	const productBlur = clampInterpolate(frame, [revealStart, revealEnd], [12, 0], Easing.out(Easing.quad));

	const focusScale = clampInterpolate(
		frame,
		[(36 / 114) * durationInFrames, (66 / 114) * durationInFrames],
		[1, 1.025],
		Easing.inOut(Easing.sin),
	);
	const polishScale = clampInterpolate(
		frame,
		[(66 / 114) * durationInFrames, (97 / 114) * durationInFrames],
		[1.025, 1.035],
		Easing.inOut(Easing.sin),
	);
	const finalScale = clampInterpolate(
		frame,
		[(97 / 114) * durationInFrames, durationInFrames],
		[1.035, 1.02],
		Easing.out(Easing.quad),
	);
	const productScale =
		frame < (66 / 114) * durationInFrames
			? productRevealScale * focusScale
			: frame < (97 / 114) * durationInFrames
				? productRevealScale * polishScale
				: productRevealScale * finalScale;

	const floatY = Math.sin(frame * 0.045) * 3.5;

	const titleOpacity = clampInterpolate(
		frame,
		[(36 / 114) * durationInFrames, (52 / 114) * durationInFrames],
		[0, 1],
		Easing.out(Easing.quad),
	);
	const titleY = clampInterpolate(
		frame,
		[(36 / 114) * durationInFrames, (52 / 114) * durationInFrames],
		[-12, 0],
		Easing.out(Easing.quad),
	);

	const sweepProgress = clampInterpolate(
		frame,
		[(66 / 114) * durationInFrames, (97 / 114) * durationInFrames],
		[-20, 120],
		Easing.inOut(Easing.sin),
	);
	const sweepOpacityIn = clampInterpolate(
		frame,
		[(66 / 114) * durationInFrames, (78 / 114) * durationInFrames],
		[0, 0.35],
		Easing.out(Easing.quad),
	);
	const sweepOpacityOut = clampInterpolate(
		frame,
		[(84 / 114) * durationInFrames, (97 / 114) * durationInFrames],
		[0.35, 0],
		Easing.in(Easing.quad),
	);
	const sweepOpacity = Math.min(sweepOpacityIn, sweepOpacityOut);

	const productPath = renderAsset ? resolveAssetPath(renderAsset) : null;

	const rootStyle: React.CSSProperties = {
		background: '#000000',
		overflow: 'hidden',
		fontFamily:
			'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
	};

	return (
		<AbsoluteFill style={rootStyle}>
			<AbsoluteFill
				style={{
					opacity: bgFade,
					transform: `scale(${bgScale})`,
					background:
						'radial-gradient(ellipse at 50% 24%, #101B3F 0%, #070B18 42%, #050710 70%, #03020A 100%)',
				}}
			>
				<div
					style={{
						position: 'absolute',
						left: '50%',
						top: 70,
						width: 980,
						height: 420,
						transform: `translateX(-50%) scale(${glowExpand})`,
						borderRadius: '50%',
						background: 'rgba(82, 129, 255, 0.35)',
						filter: 'blur(92px)',
						opacity: 0.78 * focusGlowBoost * glowHold,
					}}
				/>
				<div
					style={{
						position: 'absolute',
						right: 210,
						top: 170,
						width: 520,
						height: 360,
						borderRadius: '50%',
						background: 'rgba(166, 95, 255, 0.25)',
						filter: 'blur(98px)',
						opacity: 0.62 * glowHold,
					}}
				/>
				<div
					style={{
						position: 'absolute',
						left: 140,
						bottom: 80,
						width: 470,
						height: 300,
						borderRadius: '50%',
						background: 'rgba(80, 140, 255, 0.14)',
						filter: 'blur(86px)',
						opacity: 0.45,
					}}
				/>
				<TechGrid opacity={gridOpacity} durationInFrames={durationInFrames} />
				<ParticleField opacity={gridOpacity * 0.95} durationInFrames={durationInFrames} />
			</AbsoluteFill>

			<div
				style={{
					position: 'absolute',
					top: 102,
					left: 0,
					right: 0,
					textAlign: 'center',
					opacity: titleOpacity,
					transform: `translateY(${titleY}px)`,
					color: '#F5F8FF',
					fontSize: 48,
					fontWeight: 600,
					letterSpacing: '0.04em',
					textShadow: '0 0 28px rgba(125,183,255,0.34)',
					pointerEvents: 'none',
				}}
			>
				{titleText}
			</div>

			{productPath ? (
				<>
			<div
				style={{
					position: 'absolute',
					left: '50%',
					top: 220,
					width: '71%',
					maxHeight: 620,
					transform: `translateX(-50%) translateY(${productTranslateY + floatY}px) scale(${productScale})`,
					opacity: productOpacity,
					filter: `blur(${productBlur}px)`,
					borderRadius: 26,
					boxShadow:
						'0 30px 80px rgba(0,0,0,0.45), 0 0 40px rgba(80,140,255,0.25), inset 0 0 0 1px rgba(125,183,255,0.20)',
					overflow: 'hidden',
					background: 'rgba(8, 15, 34, 0.72)',
				}}
			>
				<Img
					src={staticFile(productPath)}
					style={{
						display: 'block',
						width: '100%',
						maxHeight: 620,
						objectFit: 'contain',
						borderRadius: 26,
					}}
				/>
				<div
					style={{
						position: 'absolute',
						inset: 0,
						borderRadius: 26,
						boxShadow: 'inset 0 0 0 1px rgba(180,210,255,0.16)',
						pointerEvents: 'none',
					}}
				/>
				<WordPips words={allWords} durationInFrames={durationInFrames} />
				<div
					style={{
						position: 'absolute',
						top: '-36%',
						left: `${sweepProgress}%`,
						width: '18%',
						height: '175%',
						transform: 'rotate(24deg)',
						background:
							'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.58) 48%, rgba(125,183,255,0.22) 58%, rgba(255,255,255,0) 100%)',
						filter: 'blur(10px)',
						opacity: sweepOpacity,
						mixBlendMode: 'screen',
						pointerEvents: 'none',
					}}
				/>
			</div>

			<div
				style={{
					position: 'absolute',
					left: '50%',
					top: 190,
					width: 1050,
					height: 690,
					transform: `translateX(-50%) scale(${productScale * 1.02})`,
					borderRadius: 38,
					border: '1px solid rgba(125,183,255,0.10)',
					opacity: productOpacity * 0.5,
					boxShadow: '0 0 110px rgba(82,129,255,0.11)',
					pointerEvents: 'none',
				}}
			/>
				</>
			) : null}

			<CustomCaption cues={cues} durationInFrames={durationInFrames} />
		</AbsoluteFill>
	);
};
