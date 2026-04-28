import React, {useMemo} from 'react';
import {
	AbsoluteFill,
	Easing,
	Img,
	interpolate,
	spring,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion';
import type {SceneAsset, SegmentCue, WordCue} from '../../types';
import {useSceneProgress} from '../../hooks/useSceneProgress';

const clamp = (
	frame: number,
	input: [number, number],
	output: [number, number],
	easing?: (t: number) => number,
) =>
	interpolate(frame, input, output, {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
		easing,
	});

const useFlattenedWords = (cues: SegmentCue[]) => {
	return useMemo(() => {
		return cues
			.reduce<WordCue[]>((acc, cue) => {
				if (cue.words && cue.words.length > 0) {
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
			}, [])
			.sort((a, b) => a.startFrame - b.startFrame);
	}, [cues]);
};

const Cursor: React.FC<{size: number; color?: string}> = ({size, color = '#ffffff'}) => {
	return (
		<svg width={size} height={size} viewBox="0 0 120 120" style={{display: 'block'}}>
			<path
				d="M22 12L95 83L61 88L46 116L22 12Z"
				fill="rgba(0,0,0,0.42)"
				transform="translate(6 8)"
			/>
			<path
				d="M22 12L95 83L61 88L46 116L22 12Z"
				fill={color}
				stroke="rgba(4,8,20,0.72)"
				strokeWidth="5"
				strokeLinejoin="round"
			/>
			<path
				d="M58 86L74 116"
				stroke="rgba(4,8,20,0.72)"
				strokeWidth="8"
				strokeLinecap="round"
			/>
			<path
				d="M57 86L72 114"
				stroke="#ffffff"
				strokeWidth="5"
				strokeLinecap="round"
			/>
		</svg>
	);
};

const WordCaption: React.FC<{cues: SegmentCue[]; bottom: number}> = ({cues, bottom}) => {
	const frame = useCurrentFrame();
	const activeCue = cues.find((cue) => frame >= cue.startFrame && frame < cue.endFrame);

	if (!activeCue) {
		return null;
	}

	const words =
		activeCue.words && activeCue.words.length > 0
			? activeCue.words
			: [
					{
						text: activeCue.text,
						startFrame: activeCue.startFrame,
						endFrame: activeCue.endFrame,
					},
				];

	return (
		<div
			style={{
				position: 'absolute',
				left: '50%',
				bottom,
				transform: 'translateX(-50%)',
				maxWidth: '78%',
				padding: '16px 30px',
				borderRadius: 18,
				background: 'rgba(5,10,25,0.50)',
				backdropFilter: 'blur(12px)',
				boxShadow: '0 10px 30px rgba(0,0,0,0.30), inset 0 0 0 1px rgba(255,255,255,0.08)',
				zIndex: 60,
				textAlign: 'center',
				whiteSpace: 'nowrap',
			}}
		>
			<div
				style={{
					fontFamily:
						'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
					fontSize: 46,
					fontWeight: 600,
					lineHeight: 1.2,
					letterSpacing: '0.02em',
				}}
			>
				{words.map((word, index) => {
					const isActive = frame >= word.startFrame && frame < word.endFrame;
					const isPast = frame >= word.endFrame;
					const pop = isActive
						? 1 + 0.035 * Math.sin(((frame - word.startFrame) / Math.max(1, word.endFrame - word.startFrame)) * Math.PI)
						: 1;

					return (
						<span
							key={`${word.startFrame}-${word.endFrame}-${index}`}
							style={{
								display: 'inline-block',
								color: isActive ? '#7DB7FF' : isPast ? 'rgba(255,255,255,0.76)' : 'rgba(255,255,255,0.82)',
								fontWeight: isActive ? 800 : 600,
								textShadow: isActive ? '0 0 18px rgba(125,183,255,0.42)' : 'none',
								transform: `scale(${pop})`,
								transformOrigin: 'center bottom',
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

export const Scene1Generated: React.FC<{
	cues: SegmentCue[];
	durationInFrames: number;
	assets?: SceneAsset[];
}> = ({cues, durationInFrames, assets = []}) => {
	const frame = useCurrentFrame();
	const {fps, width, height} = useVideoConfig();
	const progress = useSceneProgress(durationInFrames);
	const words = useFlattenedWords(cues);

	const renderAsset = assets.find((asset) => asset.role === 'render' || asset.role === 'both');
	const productSrc = renderAsset
		? staticFile(renderAsset.file.replace(/^public[\\/]/, '').replace(/\\/g, '/'))
		: null;

	const activeWord = words.find((word) => frame >= word.startFrame && frame < word.endFrame);
	const clickWordActive = Boolean(activeWord && activeWord.text.includes('开发'));

	const screenIntro = clamp(frame, [0, Math.min(15, durationInFrames * 0.132)], [0, 1], Easing.out(Easing.cubic));
	const cursorTravel = clamp(frame, [15, 32], [0, 1], Easing.inOut(Easing.cubic));
	const clickProgress = clamp(frame, [32, 48], [0, 1], Easing.out(Easing.quad));
	const popSpring = spring({
		frame: frame - 48,
		fps,
		durationInFrames: 24,
		config: {stiffness: 120, damping: 14, mass: 0.85},
	});
	const popProgress = clamp(frame, [48, 72], [0, 1], Easing.out(Easing.cubic));
	const settle = clamp(frame, [72, 87], [0, 1], Easing.inOut(Easing.cubic));
	const sweep = clamp(frame, [87, 103], [0, 1], Easing.inOut(Easing.cubic));
	const finalHold = clamp(frame, [103, durationInFrames], [0, 1], Easing.out(Easing.quad));

	const bgGlowOpacity =
		clamp(frame, [0, 15], [0.18, 0.34]) +
		clamp(frame, [32, 48], [0, 0.18]) -
		clamp(frame, [103, durationInFrames], [0, 0.06]);

	const computerOpacityBase = screenIntro;
	const computerRecede = clamp(frame, [72, 87], [1, 0.88]);
	const computerFinal = clamp(frame, [103, durationInFrames], [1, 0.93]);
	const computerOpacity = computerOpacityBase * computerRecede * computerFinal;

	const screenY = clamp(frame, [0, 15], [42, 0], Easing.out(Easing.cubic));
	const screenScale = clamp(frame, [0, 15], [0.94, 1], Easing.out(Easing.cubic));

	const cursorX = clamp(frame, [15, 32], [1360, 1042], Easing.inOut(Easing.cubic));
	const cursorY = clamp(frame, [15, 32], [760, 512], Easing.inOut(Easing.cubic));
	const cursorOpacity =
		clamp(frame, [15, 24], [0, 1], Easing.out(Easing.quad)) *
		clamp(frame, [103, durationInFrames], [1, 0], Easing.out(Easing.quad));
	const clickSquash = clickWordActive
		? interpolate(clickProgress, [0, 0.45, 1], [1, 0.86, 1], {
				extrapolateLeft: 'clamp',
				extrapolateRight: 'clamp',
			})
		: 1;
	const cursorScale = clamp(frame, [15, 32], [0.88, 1], Easing.out(Easing.cubic)) * clickSquash;

	const rippleScale = clamp(frame, [32, 48], [0.18, 1.85], Easing.out(Easing.cubic));
	const rippleOpacity = clamp(frame, [32, 48], [0.72, 0], Easing.out(Easing.quad));
	const screenGlowClick = clickWordActive
		? interpolate(clickProgress, [0, 0.45, 1], [0.22, 0.78, 0.48], {
				extrapolateLeft: 'clamp',
				extrapolateRight: 'clamp',
			})
		: clamp(frame, [15, 32], [0.16, 0.26]);
	const screenGlowBlur = clickWordActive
		? interpolate(clickProgress, [0, 0.55, 1], [14, 38, 28], {
				extrapolateLeft: 'clamp',
				extrapolateRight: 'clamp',
			})
		: 18;

	const productOpacity = clamp(frame, [48, 57], [0, 1], Easing.out(Easing.quad));
	const popT = Math.min(1.08, Math.max(0, popSpring));
	const productPopScale = interpolate(popT, [0, 1], [0.36, 1.04], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'extend',
	});
	const productSettleScale = interpolate(settle, [0, 1], [1.04, 1.0], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	const productBreathe = interpolate(sweep, [0, 1], [1.0, 1.018], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	const productFinal = interpolate(finalHold, [0, 1], [1.018, 1.012], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	const productScale =
		frame < 72 ? productPopScale : frame < 87 ? productSettleScale : frame < 103 ? productBreathe : productFinal;

	const productYPop = interpolate(popT, [0, 1], [30, -72], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'extend',
	});
	const productYSettle = interpolate(settle, [0, 1], [-72, -58], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	const productTranslateY = frame < 72 ? productYPop : productYSettle;

	const rotateXPop = interpolate(popT, [0, 1], [0, 8], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'extend',
	});
	const rotateYPop = interpolate(popT, [0, 1], [0, -14], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'extend',
	});
	const rotateX = frame < 72 ? rotateXPop : interpolate(settle, [0, 1], [8, 7], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
	const rotateY = frame < 72 ? rotateYPop : interpolate(settle, [0, 1], [-14, -12], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
	const productBlur = clamp(frame, [48, 64], [8, 0], Easing.out(Easing.cubic));

	const captionBottom = clamp(frame, [68, 76], [86, 72], Easing.inOut(Easing.quad));

	const particles = useMemo(
		() =>
			Array.from({length: 46}, (_, i) => {
				const seedA = Math.sin(i * 91.7) * 10000;
				const seedB = Math.sin(i * 41.3 + 4) * 10000;
				const seedC = Math.sin(i * 23.9 + 7) * 10000;
				return {
					x: (seedA - Math.floor(seedA)) * width,
					y: (seedB - Math.floor(seedB)) * height,
					size: 1.2 + (seedC - Math.floor(seedC)) * 2.5,
					drift: 0.15 + ((seedA * 3) % 1) * 0.35,
					opacity: 0.12 + ((seedB * 5) % 1) * 0.18,
				};
			}),
		[width, height],
	);

	const cueCoverageGlow = cues.reduce((acc, cue) => {
		const cueLocal = frame >= cue.startFrame && frame < cue.endFrame ? 0.08 : 0;
		const wordPulse = cue.words.some((word) => frame >= word.startFrame && frame < word.endFrame) ? 0.05 : 0;
		return acc + cueLocal + wordPulse;
	}, 0);

	return (
		<AbsoluteFill
			style={{
				background:
					'radial-gradient(circle at 50% 42%, rgba(82,129,255,0.34) 0%, rgba(82,129,255,0.08) 34%, transparent 60%), radial-gradient(circle at 68% 30%, rgba(166,95,255,0.20) 0%, transparent 44%), linear-gradient(180deg, #071025 0%, #030511 100%)',
				overflow: 'hidden',
				fontFamily:
					'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
			}}
		>
			<div
				style={{
					position: 'absolute',
					inset: 0,
					opacity: bgGlowOpacity + cueCoverageGlow,
					background:
						'radial-gradient(circle at 50% 44%, rgba(82,129,255,0.40) 0%, rgba(82,129,255,0.12) 32%, transparent 58%), radial-gradient(circle at 38% 72%, rgba(125,183,255,0.12) 0%, transparent 36%)',
				}}
			/>
			<div
				style={{
					position: 'absolute',
					inset: 0,
					opacity: 0.075,
					backgroundImage:
						'linear-gradient(rgba(125,183,255,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(125,183,255,0.16) 1px, transparent 1px)',
					backgroundSize: '44px 44px',
					transform: `translateY(${progress.progress * -18}px)`,
				}}
			/>
			<div
				style={{
					position: 'absolute',
					inset: 0,
					opacity: clamp(frame, [87, 103], [0.22, 0.34]),
				}}
			>
				{particles.map((particle, index) => (
					<div
						key={index}
						style={{
							position: 'absolute',
							left: (particle.x + frame * particle.drift) % width,
							top: (particle.y - frame * particle.drift * 0.42 + height) % height,
							width: particle.size,
							height: particle.size,
							borderRadius: '50%',
							background: index % 3 === 0 ? 'rgba(166,95,255,0.55)' : 'rgba(125,183,255,0.55)',
							opacity: particle.opacity,
							boxShadow: '0 0 12px rgba(125,183,255,0.34)',
						}}
					/>
				))}
			</div>

			<div
				style={{
					position: 'absolute',
					left: '50%',
					top: 250,
					width: 980,
					height: 720,
					transform: `translateX(-50%) translateY(${screenY}px) scale(${screenScale})`,
					transformOrigin: 'center top',
					opacity: computerOpacity,
					zIndex: 10,
				}}
			>
				<div
					style={{
						position: 'absolute',
						left: '50%',
						top: 590,
						width: 180,
						height: 90,
						transform: 'translateX(-50%)',
						background: 'linear-gradient(180deg, #121a2d 0%, #090e1c 100%)',
						clipPath: 'polygon(28% 0, 72% 0, 88% 100%, 12% 100%)',
						boxShadow: '0 30px 70px rgba(0,0,0,0.48)',
					}}
				/>
				<div
					style={{
						position: 'absolute',
						left: '50%',
						top: 666,
						width: 440,
						height: 34,
						transform: 'translateX(-50%)',
						borderRadius: 999,
						background: 'linear-gradient(180deg, #141d34 0%, #0b1020 100%)',
						boxShadow: '0 22px 48px rgba(0,0,0,0.44), inset 0 1px 0 rgba(255,255,255,0.08)',
					}}
				/>
				<div
					style={{
						position: 'absolute',
						inset: '0 0 auto 0',
						width: 980,
						height: 590,
						borderRadius: 30,
						border: '10px solid #141B2F',
						background: 'linear-gradient(180deg, #10182d 0%, #070b18 100%)',
						boxShadow:
							'0 36px 100px rgba(0,0,0,0.45), inset 0 0 40px rgba(125,183,255,0.08), inset 0 1px 0 rgba(255,255,255,0.08)',
						overflow: 'hidden',
					}}
				>
					<div
						style={{
							position: 'absolute',
							inset: 24,
							borderRadius: 20,
							background:
								'linear-gradient(135deg, rgba(125,183,255,0.08), transparent 34%), radial-gradient(circle at 54% 45%, rgba(125,183,255,0.18), transparent 34%), #080D1C',
							boxShadow: 'inset 0 0 0 1px rgba(125,183,255,0.08)',
						}}
					/>
					<div
						style={{
							position: 'absolute',
							left: '50%',
							top: '46%',
							width: 360,
							height: 190,
							transform: 'translate(-50%, -50%)',
							borderRadius: '50%',
							background: 'rgba(125,183,255,0.48)',
							opacity: screenGlowClick,
							filter: `blur(${screenGlowBlur}px)`,
						}}
					/>
					{Array.from({length: 9}).map((_, i) => (
						<div
							key={i}
							style={{
								position: 'absolute',
								left: 74 + i * 92,
								top: 92 + Math.sin((frame + i * 7) * 0.045) * 8,
								width: 42,
								height: 4,
								borderRadius: 99,
								background: 'rgba(125,183,255,0.18)',
								opacity: 0.25,
							}}
						/>
					))}
				</div>
			</div>

			<div
				style={{
					position: 'absolute',
					left: 1042,
					top: 512,
					width: 132,
					height: 132,
					marginLeft: -66,
					marginTop: -66,
					borderRadius: '50%',
					border: '3px solid rgba(125,183,255,0.55)',
					background: 'radial-gradient(circle, rgba(125,183,255,0.26) 0%, rgba(125,183,255,0.08) 42%, transparent 70%)',
					transform: `scale(${rippleScale})`,
					opacity: rippleOpacity,
					boxShadow: '0 0 42px rgba(125,183,255,0.42)',
					zIndex: 44,
				}}
			/>

			<div
				style={{
					position: 'absolute',
					left: '50%',
					top: 500,
					width: 1240,
					transform: `translateX(-50%) translateY(${productTranslateY}px)`,
					perspective: 1400,
					zIndex: 30,
					opacity: productOpacity,
					pointerEvents: 'none',
				}}
			>
				<div
					style={{
						position: 'relative',
						width: 1240,
						borderRadius: 22,
						transform: `rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(${productScale})`,
						transformStyle: 'preserve-3d',
						filter: `blur(${productBlur}px)`,
						boxShadow:
							'0 46px 130px rgba(0,0,0,0.58), 0 0 70px rgba(80,140,255,0.30), -26px 20px 80px rgba(166,95,255,0.12)',
						outline: '1px solid rgba(255,255,255,0.16)',
						overflow: 'hidden',
						background: '#081026',
					}}
				>
					{productSrc ? (
						<Img
							src={productSrc}
							style={{
								display: 'block',
								width: '100%',
								height: 'auto',
								borderRadius: 22,
							}}
						/>
					) : (
						<div
							style={{
								width: 1240,
								height: 700,
								borderRadius: 22,
								background: 'linear-gradient(135deg, rgba(125,183,255,0.18), rgba(8,13,28,0.92))',
								color: 'rgba(255,255,255,0.82)',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								fontSize: 42,
								fontWeight: 700,
							}}
						>
							{cues.map((cue) => cue.text).join('')}
						</div>
					)}
					<div
						style={{
							position: 'absolute',
							inset: 0,
							borderRadius: 22,
							background:
								'linear-gradient(120deg, transparent 0%, rgba(255,255,255,0.08) 35%, transparent 70%)',
							pointerEvents: 'none',
						}}
					/>
					<div
						style={{
							position: 'absolute',
							top: '-18%',
							left: `${interpolate(sweep, [0, 1], [-28, 128], {
								extrapolateLeft: 'clamp',
								extrapolateRight: 'clamp',
							})}%`,
							width: 170,
							height: '145%',
							transform: 'rotate(24deg)',
							background:
								'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.55) 48%, rgba(125,183,255,0.20) 58%, transparent 100%)',
							mixBlendMode: 'screen',
							opacity: interpolate(sweep, [0, 0.5, 1], [0, 0.38, 0], {
								extrapolateLeft: 'clamp',
								extrapolateRight: 'clamp',
							}),
							filter: 'blur(2px)',
						}}
					/>
				</div>
			</div>

			<div
				style={{
					position: 'absolute',
					left: cursorX,
					top: cursorY,
					transform: `translate(-18px, -14px) scale(${cursorScale})`,
					transformOrigin: '22px 18px',
					opacity: cursorOpacity,
					filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.42))',
					zIndex: 50,
				}}
			>
				<Cursor size={108} />
			</div>

			<WordCaption cues={cues} bottom={captionBottom} />
		</AbsoluteFill>
	);
};
