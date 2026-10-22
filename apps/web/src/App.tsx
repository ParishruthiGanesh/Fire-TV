import React from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AlongsideProvider, useAlongside } from './state';
import Dashboard from './pages/Dashboard';
import Builder from './pages/Builder';
import Voice from './pages/Voice';
import TvPreview from './pages/TvPreview';
import Settings from './pages/Settings';
import Pair from './pages/Pair';
import { DemoClockBar, Notice } from './components/common';

/**
 * Two apps in one bundle, because they are two different products for two
 * different people:
 *
 *   /            the caregiver dashboard (Anna, on a phone or laptop)
 *   /voice       the Alexa+ experience simulation (Mary, paired as a device)
 *
 * They are deliberately separate trees with separate credentials: the voice
 * client holds a device token from a pairing code, never the caregiver's.
 */
export default function App() {
  const location = useLocation();
  if (location.pathname.startsWith('/voice')) {
    return (
      <AlongsideProvider tokenKey="alongside.voiceToken" defaultToken="">
        <VoiceShell />
      </AlongsideProvider>
    );
  }
  return (
    <AlongsideProvider tokenKey="alongside.caregiverToken" defaultToken="dev-caregiver-token">
      <CaregiverShell />
    </AlongsideProvider>
  );
}

function VoiceShell() {
  const { token, setToken, snapshot, connection } = useAlongside();
  if (!token) return <Pair onPaired={setToken} />;
  return (
    <div className="app">
      <header className="app-head">
        <div className="topbar">
          <span className="brand">
            <span className="dot" />
            Alongside
          </span>
          <span className="badge amber">Alexa+ experience simulation</span>
          <span className="spacer" />
          <span className="small" style={{ opacity: 0.8 }}>
            {connection === 'live'
              ? 'Connected to the household'
              : connection === 'offline'
                ? 'Not connected'
                : 'Connecting…'}
          </span>
        </div>
        {connection === 'offline' && (
          <div className="offline-bar">Offline — nothing said here is reaching the household</div>
        )}
        {snapshot?.demoClock.enabled && snapshot.demoClock.offsetMs !== 0 && (
          <DemoClockBar offsetMs={snapshot.demoClock.offsetMs} now={snapshot.now} timezone={snapshot.household.timezone} />
        )}
      </header>
      <Voice />
    </div>
  );
}

function CaregiverShell() {
  const { snapshot, connection, error, clearError } = useAlongside();
  const openHelp = snapshot?.helpRequests.filter((h) => h.status === 'open').length ?? 0;

  return (
    <div className="app">
      <header className="app-head">
        <div className="topbar">
          <span className="brand">
            <span className="dot" />
            Alongside
          </span>
          <nav>
            <NavLink to="/" end>
              Today
            </NavLink>
            <NavLink to="/builder">Routine builder</NavLink>
            <NavLink to="/tv">Television</NavLink>
            <NavLink to="/settings">Household</NavLink>
            <NavLink to="/voice">Voice client ↗</NavLink>
          </nav>
          <span className="spacer" />
          {openHelp > 0 && (
            <span className="badge amber">
              {openHelp} help request{openHelp > 1 ? 's' : ''}
            </span>
          )}
          <span className="small" style={{ opacity: 0.8 }}>
            {connection === 'live' ? '● live' : connection === 'offline' ? '○ offline' : '◌ connecting'}
          </span>
        </div>

        {connection === 'offline' && (
          <div className="offline-bar">
            Not connected to the backend. What you see may be out of date; changes will not be saved.
          </div>
        )}
        {snapshot?.demoClock.enabled && snapshot.demoClock.offsetMs !== 0 && (
          <DemoClockBar
            offsetMs={snapshot.demoClock.offsetMs}
            now={snapshot.now}
            timezone={snapshot.household.timezone}
          />
        )}
      </header>

      <div>
        {error && (
          <div className="page" style={{ paddingBottom: 0 }}>
            <Notice tone="bad">
              {error}{' '}
              <button className="btn ghost small" onClick={clearError}>
                Dismiss
              </button>
            </Notice>
          </div>
        )}
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/builder" element={<Builder />} />
          <Route path="/tv" element={<TvPreview />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}
