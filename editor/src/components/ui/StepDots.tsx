export function StepDots({progress}: {progress: number}) {
  return (
    <div style={{display: 'flex', gap: 4}}>
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: i <= progress ? '#50fa7b' : 'rgba(255,255,255,0.15)',
          }}
        />
      ))}
    </div>
  );
}
