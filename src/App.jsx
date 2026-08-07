import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Component, useState } from 'react';
import { getMerchantSession } from './lib/db.js';

class Boundary extends Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err) {
      return (
        <div className="min-h-screen bg-paper flex items-center justify-center px-5">
          <div className="max-w-sm text-center">
            <div className="eyebrow mb-3">Something went wrong</div>
            <h1 className="luxe-title text-2xl mb-3">Please reload — or reset the demo data.</h1>
            <p className="text-sm text-steel mb-6">This is a prototype; a quick reload usually fixes it.</p>
            <button onClick={() => { try { localStorage.removeItem('loyaltyos85_v1'); } catch {} window.location.reload(); }} className="btn-ink w-full">Reload with fresh data</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
import Lookbook from './pages/Lookbook.jsx';
import AccessDenied from './pages/AccessDenied.jsx';
import Login from './pages/Login.jsx';
import Join from './pages/Join.jsx';
import Shell from './components/merchant/Shell.jsx';
import Dashboard from './pages/merchant/Dashboard.jsx';
import Customers from './pages/merchant/Customers.jsx';
import Campaigns from './pages/merchant/Campaigns.jsx';
import Catalogue from './pages/merchant/Catalogue.jsx';
import Settings from './pages/merchant/Settings.jsx';
import Onboarding from './pages/merchant/Onboarding.jsx';

function MerchantGuard({ children }) {
  const [session, setSession] = useState(getMerchantSession);
  const location = useLocation();
  if (!session) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Boundary>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/join" element={<Join />} />
        <Route path="/lookbook" element={<Lookbook />} />
        <Route
          path="/merchant/dashboard"
          element={<MerchantGuard><Shell><Dashboard /></Shell></MerchantGuard>}
        />
        <Route
          path="/merchant/customers"
          element={<MerchantGuard><Shell><Customers /></Shell></MerchantGuard>}
        />
        <Route
          path="/merchant/onboarding"
          element={<MerchantGuard><Shell><Onboarding /></Shell></MerchantGuard>}
        />
        <Route
          path="/merchant/campaigns"
          element={<MerchantGuard><Shell><Campaigns /></Shell></MerchantGuard>}
        />
        <Route
          path="/merchant/catalogue"
          element={<MerchantGuard><Shell><Catalogue /></Shell></MerchantGuard>}
        />
        <Route
          path="/merchant/settings"
          element={<MerchantGuard><Shell><Settings /></Shell></MerchantGuard>}
        />
        <Route path="/" element={<Navigate to="/lookbook" replace />} />
        <Route path="*" element={<Navigate to="/lookbook" replace />} />
      </Routes>
      </Boundary>
    </BrowserRouter>
  );
}
