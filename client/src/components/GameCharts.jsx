import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';

const ROLES = ['retailer', 'wholesaler', 'distributor', 'factory'];
const ROLE_LABELS = { retailer: 'Retailer', wholesaler: 'Wholesaler', distributor: 'Distributor', factory: 'Factory' };
const ROLE_COLORS = {
  retailer: '#3b82f6',
  wholesaler: '#22c55e',
  distributor: '#f59e0b',
  factory: '#ef4444'
};

const tooltipStyle = {
  contentStyle: {
    background: '#1a1d27',
    border: '1px solid #2e3348',
    borderRadius: 8,
    fontSize: 12
  }
};

export default function GameCharts({ team, week }) {
  if (week === 0) return null;

  const positions = team.positions;
  const weeks = Array.from({ length: week }, (_, i) => i + 1);

  // Build chart data
  const inventoryData = weeks.map((w, i) => {
    const row = { week: w };
    for (const role of ROLES) {
      row[role] = positions[role].history.effectiveInventory[i] ?? 0;
    }
    return row;
  });

  const orderData = weeks.map((w, i) => {
    const row = { week: w };
    for (const role of ROLES) {
      row[role] = positions[role].history.orders[i] ?? 0;
    }
    return row;
  });

  return (
    <div className="charts-grid">
      <div className="chart-card">
        <h3>Effective Inventory (Inventory - Backlog)</h3>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={inventoryData}>
            <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#6b7080' }} />
            <YAxis tick={{ fontSize: 11, fill: '#6b7080' }} />
            <Tooltip {...tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine y={0} stroke="#2e3348" strokeDasharray="3 3" />
            {ROLES.map(role => (
              <Line
                key={role}
                type="monotone"
                dataKey={role}
                name={ROLE_LABELS[role]}
                stroke={ROLE_COLORS[role]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-card">
        <h3>Orders Per Week (Bullwhip Effect)</h3>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={orderData}>
            <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#6b7080' }} />
            <YAxis tick={{ fontSize: 11, fill: '#6b7080' }} />
            <Tooltip {...tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {ROLES.map(role => (
              <Line
                key={role}
                type="monotone"
                dataKey={role}
                name={ROLE_LABELS[role]}
                stroke={ROLE_COLORS[role]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
