const ROLES = ['retailer', 'wholesaler', 'distributor', 'factory'];
const ROLE_LABELS = { retailer: 'Retailer', wholesaler: 'Wholesaler', distributor: 'Distributor', factory: 'Factory' };

export default function SupplyChainDiagram({ team, customerDemand }) {
  const positions = team.positions;

  return (
    <div className="supply-chain">
      {/* Customer */}
      <div className="sc-customer">
        <div className="label">Customer</div>
        <div className="value">{customerDemand}</div>
        <div className="label" style={{ marginTop: 2 }}>demand</div>
      </div>

      {ROLES.map((role, i) => {
        const p = positions[role];
        const nextRole = ROLES[i + 1];
        const nextP = nextRole ? positions[nextRole] : null;

        return (
          <div key={role} style={{ display: 'flex', alignItems: 'center' }}>
            {/* Arrow from previous */}
            <div className="sc-arrow">
              <div className="arrow-label">shipped</div>
              <div className="arrow-value">{p.lastShipment}u</div>
              <div className="arrow-line">
                <svg width="100%" height="12" style={{ position: 'absolute', top: -5 }}>
                  <line x1="0" y1="6" x2="100%" y2="6" stroke="var(--border)" strokeWidth="2" />
                  <polygon points="8,1 8,11 0,6" fill="var(--text-muted)" />
                </svg>
              </div>
              <div className="arrow-label">orders</div>
              <div className="arrow-value">{p.lastOrder}u</div>
            </div>

            {/* Node */}
            <div className={`sc-node ${role}`}>
              <div className="node-role">{ROLE_LABELS[role]}</div>
              <div className="node-player">{p.playerName || '—'}</div>
              <div className="node-stats">
                <div className="node-stat">
                  <span className="ns-label">Inv</span>
                  <span className="ns-value">{p.inventory}</span>
                </div>
                <div className="node-stat">
                  <span className="ns-label">Backlog</span>
                  <span className="ns-value" style={{ color: p.backlog > 0 ? 'var(--danger)' : 'inherit' }}>
                    {p.backlog}
                  </span>
                </div>
                <div className="node-stat">
                  <span className="ns-label">Order</span>
                  <span className="ns-value">{p.lastOrder}</span>
                </div>
              </div>
              <div className={`submitted-badge ${p.submitted ? 'yes' : 'no'}`}>
                {p.submitted ? 'Submitted' : 'Pending'}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
