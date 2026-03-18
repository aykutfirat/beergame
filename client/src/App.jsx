import { useNavigate } from 'react-router-dom';

export default function App() {
  const navigate = useNavigate();

  return (
    <div className="landing">
      <div className="landing-card">
        <h1>Beer Distribution Game</h1>
        <p className="subtitle">MIT Supply Chain Simulation</p>
        <div className="landing-buttons">
          <button className="btn btn-primary btn-lg" onClick={() => navigate('/play')}>
            Join as Student
          </button>
          <button className="btn btn-secondary btn-lg" onClick={() => navigate('/dashboard')}>
            Teacher Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
