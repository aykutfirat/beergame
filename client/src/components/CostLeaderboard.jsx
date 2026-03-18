const ROLES = ['retailer', 'wholesaler', 'distributor', 'factory'];
const ROLE_LABELS = { retailer: 'Retailer', wholesaler: 'Wholesaler', distributor: 'Distributor', factory: 'Factory' };
const ROLE_COLORS = {
  retailer: '#3b82f6',
  wholesaler: '#22c55e',
  distributor: '#f59e0b',
  factory: '#ef4444'
};

export default function CostLeaderboard({ team }) {
  const positions = team.positions;
  const maxCost = Math.max(1, ...ROLES.map(r => positions[r].cumulativeCost));
  const totalCost = ROLES.reduce((sum, r) => sum + positions[r].cumulativeCost, 0);

  return (
    <div className="leaderboard">
      <h3>Cost Leaderboard &middot; Total: ${totalCost.toFixed(2)}</h3>
      {ROLES.map(role => {
        const p = positions[role];
        const pct = (p.cumulativeCost / maxCost) * 100;
        return (
          <div key={role} className="leaderboard-row" style={{ background: `${ROLE_COLORS[role]}08` }}>
            <span className={`lb-role role-${role}`} style={{ color: ROLE_COLORS[role] }}>
              {ROLE_LABELS[role]}
            </span>
            <span className="lb-name">{p.playerName || '—'}</span>
            <span className="lb-cost">${p.cumulativeCost.toFixed(2)}</span>
            <div className="lb-bar">
              <div className="fill" style={{ width: `${pct}%`, background: ROLE_COLORS[role] }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
