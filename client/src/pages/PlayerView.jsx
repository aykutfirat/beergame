import { useState, useEffect, useRef } from 'react';
import { socket } from '../socket';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

const SESSION_KEY = 'beergame_session';

function saveSession(data) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

export default function PlayerView() {
  const [phase, setPhase] = useState('join'); // join | rejoining | waiting | playing | finished
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [assignment, setAssignment] = useState(null);
  const [playerState, setPlayerState] = useState(null);
  const [orderQty, setOrderQty] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [summary, setSummary] = useState(null);
  const firstLoad = useRef(true);

  // Refs to avoid stale closures in socket handlers
  const codeRef = useRef(code);
  const nameRef = useRef(name);
  const assignmentRef = useRef(assignment);
  useEffect(() => { codeRef.current = code; }, [code]);
  useEffect(() => { nameRef.current = name; }, [name]);
  useEffect(() => { assignmentRef.current = assignment; }, [assignment]);

  useEffect(() => {
    if (!socket.connected) socket.connect();

    // Rejoin using sessionStorage (page reload) or current refs (auto-reconnect)
    const handleConnect = () => {
      // On auto-reconnect (not first load), re-register using current state
      const a = assignmentRef.current;
      const c = codeRef.current;
      const n = nameRef.current;
      if (!firstLoad.current && a && c && n) {
        socket.emit('rejoin-game', {
          code: c, name: n, teamName: a.teamName, role: a.role
        }, (res) => {
          if (res.success && res.playerState) {
            setPlayerState(res.playerState);
            setSubmitted(res.playerState.submitted);
          }
        });
        return;
      }
      firstLoad.current = false;

      // First load — try sessionStorage
      const saved = loadSession();
      if (!saved) return;

      if (saved.code && saved.name && saved.teamName && saved.role) {
        setPhase('rejoining');
        socket.emit('rejoin-game', {
          code: saved.code,
          name: saved.name,
          teamName: saved.teamName,
          role: saved.role
        }, (res) => {
          if (res.success) {
            setCode(saved.code);
            setName(saved.name);
            setAssignment({ teamName: res.teamName, role: res.role, roleLabel: res.roleLabel });
            if (res.playerState) {
              setPlayerState(res.playerState);
              setSubmitted(res.playerState.submitted);
            }
            setPhase(res.status === 'playing' ? 'playing' : res.status === 'finished' ? 'finished' : 'waiting');
          } else {
            clearSession();
            setCode(saved.code);
            setName(saved.name);
            setPhase('join');
          }
        });
      } else if (saved.code && saved.name) {
        setCode(saved.code);
        setName(saved.name);
        socket.emit('join-game', { code: saved.code, name: saved.name }, (res) => {
          if (res.success) {
            setPhase('waiting');
          } else {
            clearSession();
            setPhase('join');
          }
        });
      }
    };

    if (socket.connected) {
      handleConnect();
    }
    socket.on('connect', handleConnect);

    socket.on('assigned', (data) => {
      setAssignment(data);
      saveSession({ code: codeRef.current, name: nameRef.current, teamName: data.teamName, role: data.role });
      setPhase('waiting');
    });

    socket.on('unassigned', () => {
      setAssignment(null);
      saveSession({ code: codeRef.current, name: nameRef.current });
      setPhase('waiting');
    });

    socket.on('game-started', () => {
      setPhase('playing');
    });

    socket.on('player-state', (state) => {
      setPlayerState(state);
      setSubmitted(state.submitted);
      if (state.status === 'playing') {
        setPhase('playing');
      }
      if (!state.submitted) {
        setOrderQty('');
      }
    });

    socket.on('game-over', (data) => {
      setSummary(data);
      setPhase('finished');
    });

    socket.on('game-reset', () => {
      setPhase('waiting');
      setPlayerState(null);
      setSubmitted(false);
      setOrderQty('');
      setSummary(null);
    });

    socket.on('kicked', () => {
      clearSession();
      setPhase('join');
      setAssignment(null);
      setPlayerState(null);
    });

    socket.on('game-ended', () => {
      clearSession();
      setPhase('join');
      setAssignment(null);
      setPlayerState(null);
      setSubmitted(false);
      setOrderQty('');
      setSummary(null);
      setCode('');
    });

    return () => {
      socket.off('connect', handleConnect);
      socket.off('assigned');
      socket.off('unassigned');
      socket.off('game-started');
      socket.off('player-state');
      socket.off('game-over');
      socket.off('game-reset');
      socket.off('kicked');
      socket.off('game-ended');
    };
  }, []);

  // Keep session in sync when code/name/assignment change
  useEffect(() => {
    if (code && name && assignment) {
      saveSession({ code, name, teamName: assignment.teamName, role: assignment.role });
    } else if (code && name && phase !== 'join') {
      saveSession({ code, name });
    }
  }, [code, name, assignment, phase]);

  const leaveGame = () => {
    clearSession();
    setPhase('join');
    setAssignment(null);
    setPlayerState(null);
    setSubmitted(false);
    setOrderQty('');
    setSummary(null);
    setCode('');
    setName('');
    setError('');
  };

  const handleJoin = (e) => {
    e.preventDefault();
    setError('');
    if (!code.trim() || !name.trim()) {
      setError('Please enter both room code and name');
      return;
    }
    const trimmedCode = code.trim();
    const trimmedName = name.trim();
    socket.emit('join-game', { code: trimmedCode, name: trimmedName }, (res) => {
      if (res.success) {
        setCode(trimmedCode);
        setName(trimmedName);
        saveSession({ code: trimmedCode, name: trimmedName });
        setPhase('waiting');
      } else {
        setError(res.error || 'Failed to join');
      }
    });
  };

  const handleOrder = () => {
    const qty = Math.floor(Number(orderQty));
    if (isNaN(qty) || qty < 0) {
      setError('Please enter a valid non-negative number');
      return;
    }
    setError('');
    socket.emit('submit-order', { code, quantity: qty }, (res) => {
      if (res.success) {
        setSubmitted(true);
      } else {
        setError(res.error || 'Failed to submit order');
      }
    });
  };

  // ─── Rejoining ──────────────────────────────────────────────────────────────
  if (phase === 'rejoining') {
    return (
      <div className="join-form">
        <div className="join-card" style={{ textAlign: 'center' }}>
          <h2>Reconnecting...</h2>
          <p style={{ color: 'var(--text-muted)' }}>Rejoining your game session.</p>
        </div>
      </div>
    );
  }

  // ─── Join Form ──────────────────────────────────────────────────────────────
  if (phase === 'join') {
    return (
      <div className="join-form">
        <form className="join-card" onSubmit={handleJoin}>
          <h2>Join Game</h2>
          <div className="form-group">
            <label>Room Code</label>
            <input
              className="code-input"
              type="text"
              maxLength={4}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="0000"
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>Your Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
              maxLength={20}
            />
          </div>
          {error && <p className="error-msg">{error}</p>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: 8 }}>
            Join
          </button>
        </form>
      </div>
    );
  }

  // ─── Waiting for Assignment ─────────────────────────────────────────────────
  if (phase === 'waiting' && !assignment) {
    return (
      <div className="join-form">
        <div className="join-card" style={{ textAlign: 'center' }}>
          <h2>Waiting for Assignment</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
            You've joined room <strong>{code}</strong>
          </p>
          <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
            The teacher will assign you to a team and role.
          </p>
          <button className="btn btn-sm btn-secondary" onClick={leaveGame}>Leave Game</button>
        </div>
      </div>
    );
  }

  // ─── Assigned but game not started ──────────────────────────────────────────
  if (phase === 'waiting' && assignment) {
    return (
      <div className="join-form">
        <div className="join-card" style={{ textAlign: 'center', maxWidth: 400 }}>
          <div className={`role-badge role-${assignment.role}`}>{assignment.roleLabel}</div>
          <h2 style={{ marginTop: 12 }}>{assignment.teamName}</h2>
          <div className="info-banner" style={{ marginTop: 16, textAlign: 'left' }}>
            <div className="info-row"><span>Holding cost</span><span>$0.50/unit/week</span></div>
            <div className="info-row"><span>Backlog cost</span><span>$1.00/unit/week</span></div>
            <div className="info-row"><span>Shipping delay</span><span>2 weeks</span></div>
            <div className="info-row"><span>Order delay</span><span>Instant</span></div>
          </div>
          <p style={{ color: 'var(--text-muted)', marginTop: 12, marginBottom: 12, fontSize: 13 }}>
            Waiting for the teacher to start the game...
          </p>
          <button className="btn btn-sm btn-secondary" onClick={leaveGame}>Leave Game</button>
        </div>
      </div>
    );
  }

  // ─── Game Over ──────────────────────────────────────────────────────────────
  if (phase === 'finished') {
    const myTeam = assignment && summary?.teams?.[assignment.teamName];
    const myPos = myTeam?.positions?.[assignment.role];
    return (
      <div className="join-form">
        <div className="join-card" style={{ maxWidth: 420 }}>
          <h2 style={{ textAlign: 'center' }}>Game Over!</h2>
          {myPos && (
            <>
              <div className={`role-badge role-${assignment.role}`} style={{ display: 'block', textAlign: 'center', marginBottom: 16 }}>
                {assignment.roleLabel}
              </div>
              <div className="summary-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="summary-stat">
                  <div className="label">Your Cost</div>
                  <div className="value">${myPos.cumulativeCost.toFixed(2)}</div>
                </div>
                <div className="summary-stat">
                  <div className="label">Team Cost</div>
                  <div className="value">${myTeam.totalCost.toFixed(2)}</div>
                </div>
                <div className="summary-stat">
                  <div className="label">Max Order</div>
                  <div className="value">{myPos.maxOrder}</div>
                </div>
                <div className="summary-stat">
                  <div className="label">Bullwhip Ratio</div>
                  <div className="value">{myTeam.bullwhipRatio}</div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ─── Playing ────────────────────────────────────────────────────────────────
  const ps = playerState;
  const chartData = ps ? ps.history.inventory.map((inv, i) => ({
    week: i + 1,
    inventory: inv,
    backlog: -ps.history.backlog[i]
  })) : [];

  return (
    <div className="player-container">
      <div className="player-header">
        {assignment && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className={`role-badge role-${assignment.role}`}>{assignment.roleLabel}</div>
              <button className="btn btn-sm btn-secondary" onClick={leaveGame} style={{ fontSize: 11, padding: '4px 10px' }}>Leave</button>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
              {assignment.teamName} &middot; Week {ps?.week || 0}
            </div>
          </>
        )}
      </div>

      {/* Game rules info */}
      <div className="info-banner">
        <div className="info-row">
          <span>Holding cost</span><span>$0.50/unit/week</span>
        </div>
        <div className="info-row">
          <span>Backlog cost</span><span>$1.00/unit/week</span>
        </div>
        <div className="info-row">
          <span>Shipping delay</span><span>2 weeks</span>
        </div>
        <div className="info-row">
          <span>Order delay</span><span>Instant</span>
        </div>
      </div>

      {ps && (
        <>
          <div className="player-stats">
            <div className="stat-card">
              <div className="label">Inventory</div>
              <div className="value">{ps.inventory}</div>
            </div>
            <div className="stat-card">
              <div className="label">Incoming Order</div>
              <div className="value">{ps.incomingOrder}</div>
            </div>
            <div className="stat-card">
              <div className="label">You Shipped</div>
              <div className="value">{ps.lastShipment}</div>
            </div>
            <div className="stat-card">
              <div className="label">Cost So Far</div>
              <div className="value">${ps.cumulativeCost.toFixed(2)}</div>
            </div>
          </div>

          {/* Backlog warning */}
          {ps.backlog > 0 && (
            <div className="backlog-banner">
              <div className="backlog-icon">!</div>
              <div className="backlog-details">
                <div className="backlog-title">Unfulfilled Orders: {ps.backlog} units</div>
                <div className="backlog-desc">
                  You owe {ps.backlog} units from previous orders you couldn't ship due to insufficient inventory.
                  These will be shipped automatically when stock arrives. Costing $1.00/unit/week.
                </div>
              </div>
            </div>
          )}

          {/* Upstream backlog & pending orders */}
          {ps.week > 0 && (
            <div className="upstream-section">
              <div className="upstream-row">
                <span>Received this round</span>
                <span className={ps.lastReceived === 0 && ps.upstreamBacklog > 0 ? 'text-danger' : ''}>
                  {ps.lastReceived} units{ps.lastReceived === 0 && ps.upstreamBacklog > 0 ? ' (upstream out of stock!)' : ''}
                </span>
              </div>
              {assignment?.role !== 'factory' && ps.upstreamBacklog > 0 && (
                <div className="upstream-row">
                  <span>Upstream owes you</span>
                  <span className="text-danger">{ps.upstreamBacklog} units</span>
                </div>
              )}
            </div>
          )}

          {/* In-transit shipments */}
          <div className="transit-section">
            <div className="transit-header">Incoming Shipments</div>
            <div className="transit-slots">
              <div className="transit-slot">
                <div className="transit-units">{ps.shippingPipeline[0]}</div>
                <div className="transit-label">Arrives next week</div>
              </div>
              <div className="transit-arrow">&#8594;</div>
              <div className="transit-slot">
                <div className="transit-units">{ps.shippingPipeline[1]}</div>
                <div className="transit-label">Arrives in 2 weeks</div>
              </div>
            </div>
            <div className="transit-total">
              Total in transit: <strong>{ps.shippingPipeline[0] + ps.shippingPipeline[1]}</strong> units
            </div>
          </div>

          <div className="order-section">
            <h3>How many units to order?</h3>
            {submitted ? (
              <div className="waiting-badge">
                Order submitted! Waiting for other players...
              </div>
            ) : (
              <>
                <div className="order-input-group">
                  <input
                    type="number"
                    min="0"
                    value={orderQty}
                    onChange={(e) => setOrderQty(e.target.value)}
                    placeholder="0"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && handleOrder()}
                  />
                  <button className="btn btn-primary" onClick={handleOrder}>
                    Submit
                  </button>
                </div>
                {error && <p className="error-msg">{error}</p>}
              </>
            )}
          </div>

          {chartData.length > 0 && (
            <div className="player-chart">
              <h4>Your Inventory / Backlog Over Time</h4>
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={chartData}>
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#6b7080' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#6b7080' }} />
                  <Tooltip
                    contentStyle={{ background: '#1a1d27', border: '1px solid #2e3348', borderRadius: 8, fontSize: 12 }}
                  />
                  <ReferenceLine y={0} stroke="#2e3348" />
                  <Line type="monotone" dataKey="inventory" stroke="#22c55e" strokeWidth={2} dot={false} name="Inventory" />
                  <Line type="monotone" dataKey="backlog" stroke="#ef4444" strokeWidth={2} dot={false} name="Backlog" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  );
}
