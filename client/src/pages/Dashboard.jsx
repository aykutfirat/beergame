import { useState, useEffect, useCallback } from 'react';
import { socket } from '../socket';
import SupplyChainDiagram from '../components/SupplyChainDiagram';
import GameCharts from '../components/GameCharts';
import CostLeaderboard from '../components/CostLeaderboard';
import GameOverSummary from '../components/GameOverSummary';

const ROLES = ['retailer', 'wholesaler', 'distributor', 'factory'];
const ROLE_LABELS = { retailer: 'Retailer', wholesaler: 'Wholesaler', distributor: 'Distributor', factory: 'Factory' };

export default function Dashboard() {
  const [phase, setPhase] = useState('setup'); // setup | lobby | playing | finished
  const [gameState, setGameState] = useState(null);
  const [players, setPlayers] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [summary, setSummary] = useState(null);
  const [lightTheme, setLightTheme] = useState(false);
  const [showSummary, setShowSummary] = useState(false);

  // Setup form state
  const [totalWeeks, setTotalWeeks] = useState(35);
  const [demandType, setDemandType] = useState('step');
  const [demandBase, setDemandBase] = useState(4);
  const [demandStep, setDemandStep] = useState(8);
  const [demandStepWeek, setDemandStepWeek] = useState(5);
  const [demandCustom, setDemandCustom] = useState('');
  const [teamCount, setTeamCount] = useState(1);

  // Assignment state
  const [assigningPlayer, setAssigningPlayer] = useState(null);

  useEffect(() => {
    if (!socket.connected) socket.connect();

    socket.on('game-state', (state) => {
      setGameState(state);
      if (state.status === 'lobby') setPhase('lobby');
      else if (state.status === 'playing') setPhase('playing');
      else if (state.status === 'finished') setPhase('finished');

      if (!selectedTeam && state.teams) {
        setSelectedTeam(Object.keys(state.teams)[0]);
      }
    });

    socket.on('player-joined', () => {
      // Refresh player list
      if (gameState?.code) {
        socket.emit('get-players', gameState.code, (res) => {
          if (res.success) setPlayers(res.players);
        });
      }
    });

    socket.on('player-disconnected', () => {
      if (gameState?.code) {
        socket.emit('get-players', gameState.code, (res) => {
          if (res.success) setPlayers(res.players);
        });
      }
    });

    socket.on('game-over', (data) => {
      setSummary(data);
      setPhase('finished');
      setShowSummary(true);
    });

    socket.on('game-reset', () => {
      setPhase('lobby');
      setSummary(null);
      setShowSummary(false);
    });

    return () => {
      socket.off('game-state');
      socket.off('player-joined');
      socket.off('player-disconnected');
      socket.off('game-over');
      socket.off('game-reset');
    };
  }, [gameState?.code, selectedTeam]);

  // Refresh players when game state changes
  useEffect(() => {
    if (gameState?.code) {
      socket.emit('get-players', gameState.code, (res) => {
        if (res.success) setPlayers(res.players);
      });
    }
  }, [gameState?.code, gameState?.week]);

  const toggleTheme = () => {
    setLightTheme(!lightTheme);
    document.documentElement.classList.toggle('light-theme');
  };

  const createGame = () => {
    const demand = demandType === 'custom'
      ? { type: 'custom', values: demandCustom.split(',').map(Number), base: demandBase }
      : { type: 'step', base: demandBase, step: demandStep, stepWeek: demandStepWeek };

    // End previous game first (kicks all players)
    const prevCode = gameState?.code;
    const doCreate = () => {
      socket.emit('create-game', { totalWeeks, demand, teamCount }, (res) => {
        if (res.success) {
          setGameState(res.state);
          setPlayers([]);
          setPhase('lobby');
          setSelectedTeam(Object.keys(res.state.teams)[0]);
          setSummary(null);
          setShowSummary(false);
        }
      });
    };

    if (prevCode) {
      socket.emit('end-game', prevCode, doCreate);
    } else {
      doCreate();
    }
  };

  const [startError, setStartError] = useState('');

  const allRolesAssigned = gameState ? Object.values(gameState.teams).every(
    team => ROLES.every(role => team.positions[role]?.playerName)
  ) : false;

  const startGame = () => {
    setStartError('');
    socket.emit('start-game', gameState.code, (res) => {
      if (res.success) {
        setPhase('playing');
      } else {
        setStartError(res.error || 'Cannot start game');
      }
    });
  };

  const advanceRound = () => {
    socket.emit('advance-round', gameState.code, () => {});
  };

  const resetGame = () => {
    socket.emit('reset-game', gameState.code, () => {});
  };

  const addTeam = () => {
    socket.emit('add-team', gameState.code, () => {});
  };

  const assignPlayer = (socketId, teamName, role) => {
    socket.emit('assign-player', {
      code: gameState.code,
      socketId,
      teamName,
      role
    }, (res) => {
      if (res.success) {
        setAssigningPlayer(null);
        socket.emit('get-players', gameState.code, (res) => {
          if (res.success) setPlayers(res.players);
        });
      }
    });
  };

  const unassignedPlayers = players.filter(p => !p.teamName);
  const teamNames = gameState ? Object.keys(gameState.teams) : [];
  const currentTeam = gameState && selectedTeam ? gameState.teams[selectedTeam] : null;

  // ─── Setup Panel ────────────────────────────────────────────────────────────
  if (phase === 'setup') {
    return (
      <div className="setup-panel">
        <div className="setup-card">
          <h2>Create New Game</h2>
          <div className="form-group">
            <label>Number of Weeks</label>
            <input type="number" value={totalWeeks} onChange={(e) => setTotalWeeks(Number(e.target.value))} min={10} max={100} />
          </div>
          <div className="form-group">
            <label>Demand Pattern</label>
            <select value={demandType} onChange={(e) => setDemandType(e.target.value)}>
              <option value="step">Step Function</option>
              <option value="custom">Custom Sequence</option>
            </select>
          </div>
          {demandType === 'step' ? (
            <div className="setup-row">
              <div className="form-group">
                <label>Base Demand</label>
                <input type="number" value={demandBase} onChange={(e) => setDemandBase(Number(e.target.value))} min={0} />
              </div>
              <div className="form-group">
                <label>Step Demand</label>
                <input type="number" value={demandStep} onChange={(e) => setDemandStep(Number(e.target.value))} min={0} />
              </div>
              <div className="form-group">
                <label>Step at Week</label>
                <input type="number" value={demandStepWeek} onChange={(e) => setDemandStepWeek(Number(e.target.value))} min={1} />
              </div>
            </div>
          ) : (
            <div className="form-group">
              <label>Demand Values (comma separated)</label>
              <input
                type="text"
                value={demandCustom}
                onChange={(e) => setDemandCustom(e.target.value)}
                placeholder="4,4,4,4,8,8,8,8,..."
              />
            </div>
          )}
          <button className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: 16 }} onClick={createGame}>
            Create Game
          </button>
        </div>
      </div>
    );
  }

  // ─── Main Dashboard ─────────────────────────────────────────────────────────
  return (
    <div className="dashboard">
      {/* Top Bar */}
      <div className="dash-topbar">
        <div className="room-code-display">{gameState?.code}</div>
        <div className="week-display">
          {phase === 'lobby' ? 'Lobby' : phase === 'finished' ? 'Game Over' : `Week ${gameState?.week || 0}`}
        </div>
        <div className="dash-controls">
          {phase === 'lobby' && (
            <>
              <button className="btn btn-sm btn-secondary" onClick={addTeam}>+ Team</button>
              <button className="btn btn-success" onClick={startGame} disabled={!allRolesAssigned}>Start Game</button>
            </>
          )}
          {phase === 'playing' && (
            <>
              <button className="btn btn-primary" onClick={advanceRound}>
                Advance Round
              </button>
              <button className="btn btn-secondary" onClick={resetGame}>Reset</button>
            </>
          )}
          {phase === 'finished' && (
            <>
              <button className="btn btn-primary" onClick={() => setShowSummary(true)}>
                Show Summary
              </button>
              <button className="btn btn-secondary" onClick={resetGame}>New Game</button>
            </>
          )}
          <button className="theme-toggle" onClick={toggleTheme} title="Toggle theme">
            {lightTheme ? '\u263E' : '\u2600'}
          </button>
        </div>
      </div>

      <div className="dash-body">
        {/* Team Tabs */}
        {teamNames.length > 1 && (
          <div className="team-tabs">
            {teamNames.map(tn => (
              <button
                key={tn}
                className={`team-tab ${selectedTeam === tn ? 'active' : ''}`}
                onClick={() => setSelectedTeam(tn)}
              >
                {tn}
              </button>
            ))}
          </div>
        )}

        {/* Player Management (Lobby) */}
        {phase === 'lobby' && (
          <div className="players-panel">
            <h3>Players ({players.length} connected)</h3>
            {!allRolesAssigned && (
              <p style={{ fontSize: 13, color: 'var(--warning)', marginBottom: 12 }}>
                All roles must be assigned before starting the game.
              </p>
            )}
            {startError && (
              <p className="error-msg" style={{ marginBottom: 12 }}>{startError}</p>
            )}

            {unassignedPlayers.length > 0 && (
              <>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                  Click an unassigned player, then click a role slot to assign them.
                </p>
                <div className="unassigned-list">
                  {unassignedPlayers.map(p => (
                    <div
                      key={p.socketId}
                      className="unassigned-player"
                      style={{
                        outline: assigningPlayer?.socketId === p.socketId ? '2px solid var(--primary)' : 'none',
                      }}
                      onClick={() => setAssigningPlayer(p)}
                    >
                      <span className="dot" style={{ background: p.connected ? 'var(--success)' : 'var(--danger)' }} />
                      {p.name}
                    </div>
                  ))}
                </div>
              </>
            )}

            {teamNames.map(tn => (
              <div key={tn} style={{ marginBottom: 16 }}>
                <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>{tn}</h4>
                {ROLES.map(role => {
                  const pos = gameState.teams[tn]?.positions?.[role];
                  const assignedPlayer = players.find(p => p.teamName === tn && p.role === role);
                  return (
                    <div
                      key={role}
                      className="role-slot"
                      onClick={() => {
                        if (assigningPlayer) {
                          assignPlayer(assigningPlayer.socketId, tn, role);
                        }
                      }}
                    >
                      <span className={`slot-role role-${role}`}>{ROLE_LABELS[role]}</span>
                      <span className={`slot-player ${pos?.playerName ? 'filled' : ''}`}>
                        {pos?.playerName || (assigningPlayer ? 'Click to assign' : 'Empty')}
                      </span>
                      {assignedPlayer && (
                        <span className="dot" style={{
                          width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
                          background: assignedPlayer.connected ? 'var(--success)' : 'var(--danger)'
                        }} />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {/* Supply Chain + Charts (Playing / Finished) */}
        {(phase === 'playing' || phase === 'finished') && currentTeam && (
          <>
            <SupplyChainDiagram team={currentTeam} customerDemand={gameState.customerDemand} />

            <GameCharts team={currentTeam} week={gameState.week} />

            <CostLeaderboard team={currentTeam} />
          </>
        )}
      </div>

      {/* Game Over Overlay */}
      {showSummary && summary && (
        <GameOverSummary
          summary={summary}
          selectedTeam={selectedTeam}
          onClose={() => setShowSummary(false)}
        />
      )}
    </div>
  );
}
