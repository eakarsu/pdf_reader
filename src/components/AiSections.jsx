// Readable labelled rendering for AI JSON (wave 15A). False, 0 and empty
// values are preserved as text instead of being dropped by falsy checks.
export function sectionTitle(key) {
  return String(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/^./, (s) => s.toUpperCase());
}

export default function AiSections({ value, depth = 0 }) {
  if (depth > 8) return <p>Further details omitted.</p>;
  if (value === null || value === undefined) return <span className="muted">Not supplied</span>;
  if (typeof value === 'boolean') return <p>{value ? 'Yes' : 'No'}</p>;
  if (typeof value === 'number') return <p>{String(value)}</p>;
  if (typeof value === 'string') return value === '' ? <p><em>Empty string</em></p> : <p>{value}</p>;
  if (Array.isArray(value)) {
    if (!value.length) return <p>No items returned.</p>;
    return (
      <ul>
        {value.map((item, index) => (
          <li key={index}><AiSections value={item} depth={depth + 1} /></li>
        ))}
      </ul>
    );
  }
  return (
    <div>
      {Object.entries(value).map(([key, item]) => (
        <section key={key} className="ai-section">
          <h3>{sectionTitle(key)}</h3>
          <AiSections value={item} depth={depth + 1} />
        </section>
      ))}
    </div>
  );
}
