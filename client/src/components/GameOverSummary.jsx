const ROLES = ['retailer', 'wholesaler', 'distributor', 'factory'];
const ROLE_LABELS = { retailer: 'Retailer', wholesaler: 'Wholesaler', distributor: 'Distributor', factory: 'Factory' };
const ROLE_COLORS = {
  retailer: '#3b82f6',
  wholesaler: '#22c55e',
  distributor: '#f59e0b',
  factory: '#ef4444'
};

export default function GameOverSummary({ summary, selectedTeam, onClose }) {
  const teamData = summary.teams[selectedTeam];
  if (!teamData) return null;

  return (
    <div className="game-over-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="game-over-card">
        <h2>Game Over — {selectedTeam}</h2>

        <div className="summary-grid">
          <div className="summary-stat">
            <div className="label">Total Team Cost</div>
            <div className="value">${teamData.totalCost.toFixed(2)}</div>
          </div>
          <div className="summary-stat">
            <div className="label">Optimal Cost</div>
            <div className="value">${teamData.optimalCost.toFixed(2)}</div>
          </div>
          <div className="summary-stat">
            <div className="label">Bullwhip Ratio</div>
            <div className="value" style={{ color: Number(teamData.bullwhipRatio) > 2 ? 'var(--danger)' : 'var(--success)' }}>
              {teamData.bullwhipRatio}x
            </div>
          </div>
          <div className="summary-stat">
            <div className="label">Cost vs Optimal</div>
            <div className="value" style={{ color: 'var(--warning)' }}>
              {teamData.optimalCost > 0
                ? `${((teamData.totalCost / teamData.optimalCost) * 100).toFixed(0)}%`
                : 'N/A'}
            </div>
          </div>
        </div>

        <h3 style={{ fontSize: 16, marginBottom: 16 }}>Individual Results</h3>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>Role</th>
              <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>Player</th>
              <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>Cost</th>
              <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>Avg Inv</th>
              <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>Avg Backlog</th>
              <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>Max Order</th>
            </tr>
          </thead>
          <tbody>
            {ROLES.map(role => {
              const p = teamData.positions[role];
              return (
                <tr key={role} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px', color: ROLE_COLORS[role], fontWeight: 700 }}>
                    {ROLE_LABELS[role]}
                  </td>
                  <td style={{ padding: '10px 12px' }}>{p.playerName}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    ${p.cumulativeCost.toFixed(2)}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {p.avgInventory.toFixed(1)}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: p.avgBacklog > 0 ? 'var(--danger)' : 'inherit' }}>
                    {p.avgBacklog.toFixed(1)}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {p.maxOrder}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
