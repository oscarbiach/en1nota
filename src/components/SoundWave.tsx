export function SoundWave({ active = false }: { active?: boolean }) {
  return <div className={`sound-wave ${active ? 'active' : ''}`} aria-hidden="true">
    {Array.from({ length: 23 }, (_, i) => <i key={i} style={{ height: `${18 + ((i * 37 + 19) % 75)}%`, animationDelay: `${i * -0.09}s` }} />)}
  </div>;
}
